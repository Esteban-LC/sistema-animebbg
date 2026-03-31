import { ensureAssignmentGroupSnapshotSchema, ensurePerformanceIndexes, getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createNotification, notifyRoles } from '@/lib/notifications';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { publishAssignmentEvent } from '@/lib/realtime';
import { getCachedValue, invalidateCacheByPrefix } from '@/lib/runtime-cache';

export const dynamic = 'force-dynamic';
const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];
const ACTIVE_ASSIGNMENT_STATES = ['Pendiente', 'En Proceso'];
const ASSIGNMENTS_CACHE_TTL_MS = process.env.NODE_ENV === 'production' ? 15000 : 3000;

async function hasAsignacionesColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(asignaciones)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

async function ensureTraductorTipoColumn(db) {
    const exists = await hasAsignacionesColumn(db, 'traductor_tipo');
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE asignaciones ADD COLUMN traductor_tipo TEXT CHECK(traductor_tipo IN ('CORE', 'ENG'))`).run();
    } catch {
        // verify below
    }
    return hasAsignacionesColumn(db, 'traductor_tipo');
}

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const values = rawCatalog
        .map((value) => {
            if (typeof value === 'number' || typeof value === 'string') return Number(value);
            if (value && typeof value === 'object') return Number(value.numero);
            return NaN;
        })
        .filter((value) => Number.isFinite(value) && value > 0);
    return [...new Set(values)].sort((a, b) => a - b);
}

function getCatalogDeliveryUrlForRole(entry, roleName) {
    if (!entry) return null;
    const role = String(roleName || '').toLowerCase();
    if (role === 'traductor') {
        return entry.traductor_url || null;
    }
    if (role === 'redrawer') {
        return entry.redraw_url || null;
    }
    if (role === 'typer') {
        return entry.typer_url || null;
    }
    return entry.traductor_url || entry.redraw_url || entry.typer_url || null;
}

function normalizeTraductorTipo(value) {
    return String(value || '').toUpperCase() === 'ENG' ? 'ENG' : 'CORE';
}

function normalizeUrlValue(value) {
    return String(value || '').trim();
}

function isSameUrl(a, b) {
    const left = normalizeUrlValue(a);
    const right = normalizeUrlValue(b);
    if (!left || !right) return false;
    return left === right;
}

function isRawCatalogSourceUrlForChapter(rawUrl, chapterEntry) {
    if (!chapterEntry) return false;
    return isSameUrl(rawUrl, chapterEntry?.url) || isSameUrl(rawUrl, chapterEntry?.raw_eng_url);
}

function isChapterAvailableForTraductorType(entry, traductorTipo) {
    if (!entry) return false;
    if (normalizeTraductorTipo(traductorTipo) === 'ENG') {
        return Boolean(String(entry.url || '').trim());
    }
    return Boolean(String(entry.raw_eng_url || '').trim());
}

function getCoreRawLanguageByProjectType(tipo) {
    const normalized = String(tipo || '').toLowerCase();
    if (normalized === 'manga') return 'JAP';
    if (normalized === 'manhwa') return 'KO';
    return 'KO/JAP';
}

async function hasTyperPrerequisites(db, proyectoId, capitulo) {
    if (!proyectoId || capitulo === null || capitulo === undefined) {
        return {
            ok: false,
            traductorDone: false,
            redrawDone: false,
        };
    }
    const rows = await db.prepare(`
        SELECT rol
        FROM asignaciones
        WHERE proyecto_id = ?
          AND capitulo = ?
          AND rol IN ('Traductor', 'Redrawer')
          AND estado = 'Completado'
          AND drive_url IS NOT NULL
          AND TRIM(drive_url) != ''
    `).all(proyectoId, capitulo);

    const done = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row?.rol || '')));
    const traductorByAssignment = done.has('Traductor');
    const redrawByAssignment = done.has('Redrawer');

    const proyecto = await db.prepare(`
        SELECT id, capitulos_catalogo
        FROM proyectos
        WHERE id = ?
    `).get(proyectoId);

    let chapterEntry = null;
    try {
        const catalog = await getProjectCatalogEntries(db, proyecto || { id: proyectoId });
        chapterEntry = (Array.isArray(catalog) ? catalog : []).find((entry) => Number(entry?.numero) === Number(capitulo)) || null;
    } catch {
        chapterEntry = null;
    }

    const traductorByCatalog = Boolean(String(getCatalogDeliveryUrlForRole(chapterEntry, 'Traductor') || '').trim());
    const redrawByCatalog = Boolean(String(getCatalogDeliveryUrlForRole(chapterEntry, 'Redrawer') || '').trim());

    const traductorDone = traductorByAssignment || traductorByCatalog;
    const redrawDone = redrawByAssignment || redrawByCatalog;
    return {
        ok: traductorDone && redrawDone,
        traductorDone,
        redrawDone,
    };
}

async function getProjectGroupId(db, projectId) {
    if (!projectId) return null;
    const row = await db.prepare('SELECT grupo_id FROM proyectos WHERE id = ?').get(projectId);
    return row?.grupo_id ?? null;
}

async function hasCatalogColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'capitulos_catalogo');
    } catch {
        return false;
    }
}

async function hasDriveFolderColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'drive_folder_id');
    } catch {
        return false;
    }
}

async function hasSecondaryRawColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'raw_secundario_activo');
    } catch {
        return false;
    }
}

async function countActiveAssignments(db, usuarioId, excludeAssignmentId = null) {
    if (!usuarioId) return 0;

    let query = `
        SELECT COUNT(*) as total
        FROM asignaciones
        WHERE usuario_id = ?
          AND estado IN (${ACTIVE_ASSIGNMENT_STATES.map(() => '?').join(', ')})
    `;
    const params = [usuarioId, ...ACTIVE_ASSIGNMENT_STATES];

    if (excludeAssignmentId) {
        query += ' AND id != ?';
        params.push(excludeAssignmentId);
    }

    const row = await db.prepare(query).get(...params);
    return Number(row?.total || 0);
}

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token');

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const db = getDb();
        await ensurePerformanceIndexes(db);
        await ensureAssignmentGroupSnapshotSchema(db);

        const session = await db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token.value);
        if (!session) {
            return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });
        }

        const user = await db.prepare('SELECT roles, grupo_id FROM usuarios WHERE id = ?').get(session.usuario_id);

        let roles = [];
        try {
            roles = user?.roles ? JSON.parse(user.roles) : [];
        } catch {
            roles = [];
        }

        const isAdmin = roles.includes('Administrador');
        const isLeader = roles.includes('Lider de Grupo');
        const userGroupId = user?.grupo_id || null;

        const cacheKey = [
            'assignments',
            session.usuario_id,
            isAdmin ? 'admin' : isLeader ? 'leader' : 'staff',
            userGroupId ?? 'none',
        ].join(':');

        const asignaciones = await getCachedValue(cacheKey, ASSIGNMENTS_CACHE_TTL_MS, async () => {
            let query = `
                SELECT a.*, u.nombre as usuario_nombre, p.titulo as proyecto_titulo, p.imagen_url as proyecto_imagen
                FROM asignaciones a
                JOIN usuarios u ON a.usuario_id = u.id
                LEFT JOIN proyectos p ON a.proyecto_id = p.id
            `;
            const params = [];

            if (isAdmin) {
                // Admin ve todo
            } else if (isLeader) {
                if (!userGroupId) {
                    query += ' WHERE a.usuario_id = ? ';
                    params.push(session.usuario_id);
                } else {
                    // Leader views are scoped to the leader's current group only.
                    query += ' WHERE COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ? ';
                    params.push(userGroupId);
                }
            } else {
                query += ' WHERE a.usuario_id = ? ';
                params.push(session.usuario_id);
            }

            query += ' ORDER BY a.asignado_en DESC';

            return db.prepare(query).all(...params);
        });
        return NextResponse.json(asignaciones);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: 'Internal Server Error', details: errorMessage }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { usuario_id, rol, descripcion, proyecto_id, capitulo, traductor_tipo } = await request.json();
        const db = getDb();
        await ensurePerformanceIndexes(db);
        await ensureAssignmentGroupSnapshotSchema(db);
        const traductorTipoColumnExists = await ensureTraductorTipoColumn(db);
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles
            FROM sessions s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);

        if (!session) {
            return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });
        }

        let requesterRoles = [];
        try {
            requesterRoles = JSON.parse(session.roles || '[]');
        } catch {
            requesterRoles = [];
        }

        const isAdmin = requesterRoles.includes('Administrador');
        const isLeader = requesterRoles.includes('Lider de Grupo');
        const isSelfAssign = Number(usuario_id) === Number(session.usuario_id);

        if (!isAdmin && !isLeader && !isSelfAssign) {
            return NextResponse.json({ error: 'Solo puedes asignarte tareas a ti mismo' }, { status: 403 });
        }

        const normalizedTraductorTipo = normalizeTraductorTipo(traductor_tipo);

        if (!usuario_id || !rol || !descripcion) {
            return NextResponse.json({ error: 'usuario_id, rol y descripcion son requeridos' }, { status: 400 });
        }

        const assignee = await db.prepare('SELECT roles, grupo_id FROM usuarios WHERE id = ?').get(usuario_id);
        if (!assignee) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }
        let assigneeRoles = [];
        try {
            assigneeRoles = JSON.parse(assignee.roles || '[]');
        } catch {
            assigneeRoles = [];
        }
        const hasTradCore = assigneeRoles.includes('Traductor')
            || assigneeRoles.includes('Traductor KO')
            || assigneeRoles.includes('Traductor JAP')
            || assigneeRoles.includes('Traductor KO/JAP');
        const hasTradEng = assigneeRoles.includes('Traductor ENG');
        if (String(rol) === 'Traductor') {
            if (normalizedTraductorTipo === 'ENG' && !hasTradEng) {
                return NextResponse.json({ error: 'El usuario no tiene el subrol Traductor ENG' }, { status: 400 });
            }
            if (normalizedTraductorTipo === 'CORE' && !hasTradCore) {
                return NextResponse.json({ error: 'El usuario no tiene el subrol Traductor KO' }, { status: 400 });
            }
        } else if (!assigneeRoles.includes(String(rol))) {
            return NextResponse.json({ error: `El usuario no tiene el rol ${rol}` }, { status: 400 });
        }

        const activeAssignmentsCount = await countActiveAssignments(db, usuario_id);
        const allowedActiveAssignments = isAdmin && !isSelfAssign ? 2 : 1;

        if (activeAssignmentsCount >= allowedActiveAssignments) {
            const errorMessage = allowedActiveAssignments === 1
                ? 'Ya tienes una asignacion activa. Completa o libera la actual antes de tomar otra.'
                : 'Este miembro ya tiene 2 asignaciones activas. Completa o libera una antes de agregar otra.';
            return NextResponse.json({ error: errorMessage }, { status: 400 });
        }

        let driveUrlFromCatalog = null;
        let assignmentGroupId = null;

        if (proyecto_id && capitulo !== null && capitulo !== undefined) {
            const catalogColumnExists = await hasCatalogColumn(db);
            const driveFolderColumnExists = await hasDriveFolderColumn(db);
            const secondaryRawColumnExists = await hasSecondaryRawColumn(db);
            const proyecto = await db.prepare(`
                SELECT estado, tipo, grupo_id, ${secondaryRawColumnExists ? 'raw_secundario_activo' : '0 as raw_secundario_activo'}, capitulos_totales, ${catalogColumnExists ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                       ${driveFolderColumnExists ? 'drive_folder_id' : 'NULL as drive_folder_id'}, id
                FROM proyectos WHERE id = ?
            `).get(proyecto_id);
            if (!proyecto) {
                return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
            }
            const normalizedProjectStatus = String(proyecto.estado || '').trim().toLowerCase();
            if (['pausado', 'cancelado'].includes(normalizedProjectStatus)) {
                return NextResponse.json({ error: 'No se puede asignar a un proyecto pausado o cancelado' }, { status: 400 });
            }

            if (String(rol) === 'Traductor' && normalizedTraductorTipo === 'CORE' && Number(proyecto?.raw_secundario_activo || 0) !== 1) {
                return NextResponse.json({
                    error: `Este proyecto no tiene RAW adicional activo para Traductor ${getCoreRawLanguageByProjectType(proyecto?.tipo)}`
                }, { status: 400 });
            }

            const catalogoEntries = await getProjectCatalogEntries(db, proyecto);
            const catalogo = normalizeCatalog(catalogoEntries);

            if (catalogo.length > 0) {
                if (!catalogo.includes(Number(capitulo))) {
                    return NextResponse.json({ error: 'Capitulo no disponible en el catalogo del proyecto' }, { status: 400 });
                }
            } else if (Number(capitulo) < 1 || Number(capitulo) > Number(proyecto.capitulos_totales || 0) + 0.9) {
                return NextResponse.json({
                    error: `El capitulo debe estar entre 1 y ${proyecto.capitulos_totales}`
                }, { status: 400 });
            }

            const asignacionExistente = await db.prepare(`
                SELECT id FROM asignaciones
                WHERE proyecto_id = ? AND capitulo = ? AND rol = ? AND estado != 'Completado'
            `).get(proyecto_id, capitulo, rol);

            if (asignacionExistente) {
                return NextResponse.json({
                    error: `Este capitulo ya tiene una asignacion activa para rol ${rol}`
                }, { status: 400 });
            }

            const activeUserShot = await db.prepare(`
                SELECT id
                FROM asignaciones
                WHERE usuario_id = ?
                  AND proyecto_id = ?
                  AND rol = ?
                  AND capitulo IS NOT NULL
                  AND estado IN ('Pendiente', 'En Proceso')
                LIMIT 1
            `).get(usuario_id, proyecto_id, rol);

            if (activeUserShot) {
                return NextResponse.json({ error: 'Ya tienes un tiro activo en este proyecto y rol' }, { status: 400 });
            }

            const matchedChapter = catalogoEntries.find((entry) => Number(entry.numero) === Number(capitulo));
            if (String(rol) === 'Traductor' && matchedChapter && !isChapterAvailableForTraductorType(matchedChapter, normalizedTraductorTipo)) {
                const chapterLabel = Number(capitulo);
                const tipoLabel = normalizedTraductorTipo === 'ENG'
                    ? 'ENG'
                    : getCoreRawLanguageByProjectType(proyecto?.tipo);
                return NextResponse.json({
                    error: `Capitulo ${chapterLabel} no esta disponible en RAW ${tipoLabel}`
                }, { status: 400 });
            }

            const completadoConEnlace = await db.prepare(`
                SELECT id, drive_url
                FROM asignaciones
                WHERE proyecto_id = ?
                  AND capitulo = ?
                  AND rol = ?
                  AND estado = 'Completado'
                  AND drive_url IS NOT NULL
                  AND TRIM(drive_url) != ''
                LIMIT 1
            `).get(proyecto_id, capitulo, rol);

            if (completadoConEnlace && !isRawCatalogSourceUrlForChapter(completadoConEnlace.drive_url, matchedChapter)) {
                return NextResponse.json({
                    error: `Capitulo ${capitulo} ya tiene enlace de entrega registrado para ${rol}`
                }, { status: 400 });
            }

            if (String(rol) === 'Typer') {
                const typerPrereq = await hasTyperPrerequisites(db, proyecto_id, capitulo);
                if (!typerPrereq?.ok) {
                    const faltantes = [];
                    if (!typerPrereq?.traductorDone) faltantes.push('Traduccion');
                    if (!typerPrereq?.redrawDone) faltantes.push('Redraw');
                    return NextResponse.json({
                        error: `Typer requiere prerrequisitos en capitulo ${capitulo}. Falta: ${faltantes.join(' y ')}. Si ya esta en Drive, sincroniza carpetas del proyecto.`
                    }, { status: 400 });
                }
            }

            const roleDeliveryUrlFromCatalog = getCatalogDeliveryUrlForRole(matchedChapter, rol);
            if (roleDeliveryUrlFromCatalog) {
                return NextResponse.json({
                    error: `Capitulo ${capitulo} ya tiene enlace en catalogo para ${rol}`
                }, { status: 400 });
            }
            driveUrlFromCatalog = roleDeliveryUrlFromCatalog;
            assignmentGroupId = proyecto?.grupo_id ?? null;
        }

        if (assignmentGroupId === null || assignmentGroupId === undefined) {
            assignmentGroupId = assignee?.grupo_id ?? null;
        }

        let result;
        if (traductorTipoColumnExists) {
            result = await db.prepare(`
                INSERT INTO asignaciones (usuario_id, rol, traductor_tipo, descripcion, proyecto_id, capitulo, drive_url, grupo_id_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                usuario_id,
                rol,
                String(rol) === 'Traductor' ? normalizedTraductorTipo : null,
                descripcion,
                proyecto_id || null,
                capitulo || null,
                driveUrlFromCatalog,
                assignmentGroupId
            );
        } else {
            result = await db.prepare(`
                INSERT INTO asignaciones (usuario_id, rol, descripcion, proyecto_id, capitulo, drive_url, grupo_id_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                usuario_id,
                rol,
                descripcion,
                proyecto_id || null,
                capitulo || null,
                driveUrlFromCatalog,
                assignmentGroupId
            );
        }

        const asignacion = await db.prepare(`
            SELECT
                a.id, a.usuario_id, a.rol, ${traductorTipoColumnExists ? 'a.traductor_tipo' : 'NULL as traductor_tipo'}, a.descripcion, a.estado,
                a.asignado_en, a.completado_en, a.informe, a.proyecto_id, a.capitulo,
                u.nombre as usuario_nombre,
                u.discord_username
            FROM asignaciones a
            JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.id = ?
        `).get(result.lastInsertRowid);
        const targetGroupId = assignmentGroupId ?? await getProjectGroupId(db, proyecto_id) ?? null;

        const actor = await db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(session.usuario_id);
        const actorName = actor?.nombre || 'Sistema';
        const chapterText = asignacion?.capitulo ? `Cap. ${asignacion.capitulo}` : 'sin capitulo';
        const titleText = asignacion?.descripcion || 'Nueva asignacion';

        await createNotification(db, {
            usuarioId: Number(usuario_id),
            tipo: 'asignacion_nueva',
            titulo: 'Nueva asignacion',
            mensaje: `${titleText} (${rol} - ${chapterText})`,
            data: { asignacion_id: Number(result.lastInsertRowid) },
        });

        await notifyRoles(
            db,
            ['Administrador'],
            {
                tipo: 'asignacion_evento',
                titulo: 'Asignacion creada',
                mensaje: `${actorName} asigno ${rol} a ${asignacion?.usuario_nombre || 'usuario'} (${chapterText})`,
                data: { asignacion_id: Number(result.lastInsertRowid) },
            },
            { excludeUserIds: [Number(session.usuario_id)], groupId: targetGroupId }
        );

        publishAssignmentEvent({
            action: 'created',
            assignment_id: Number(result.lastInsertRowid),
            usuario_id: Number(usuario_id),
            proyecto_id: asignacion?.proyecto_id ? Number(asignacion.proyecto_id) : null,
            group_id: targetGroupId ? Number(targetGroupId) : null,
            ts: Date.now(),
        });

        invalidateCacheByPrefix('assignments:');
        invalidateCacheByPrefix('stats:');

        return NextResponse.json(asignacion);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
