import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { createNotification, notifyRoles } from '@/lib/notifications';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { publishAssignmentEvent } from '@/lib/realtime';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Typer', 'Redrawer'];
const ACTIVE_ASSIGNMENT_STATES = ['Pendiente', 'En Proceso'];

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

function buildTyperPrereqSet(rows) {
    const byChapter = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const cap = Number(row?.capitulo);
        const role = String(row?.rol || '');
        if (!Number.isFinite(cap) || cap <= 0) continue;
        if (!byChapter.get(cap)) byChapter.set(cap, new Set());
        byChapter.get(cap).add(role);
    }

    const ready = new Set();
    for (const [cap, roles] of byChapter.entries()) {
        if (roles.has('Traductor') && roles.has('Redrawer')) {
            ready.add(Number(cap));
        }
    }
    return ready;
}

function buildTyperCatalogPrereqSet(catalogEntries) {
    const ready = new Set();
    for (const entry of Array.isArray(catalogEntries) ? catalogEntries : []) {
        const cap = Number(entry?.numero);
        if (!Number.isFinite(cap) || cap <= 0) continue;
        const traductorReady = Boolean(String(getCatalogDeliveryUrlForRole(entry, 'Traductor') || '').trim());
        const redrawReady = Boolean(String(getCatalogDeliveryUrlForRole(entry, 'Redrawer') || '').trim());
        if (traductorReady && redrawReady) {
            ready.add(cap);
        }
    }
    return ready;
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

async function countActiveAssignments(db, usuarioId) {
    if (!usuarioId) return 0;
    const row = await db.prepare(`
        SELECT COUNT(*) as total
        FROM asignaciones
        WHERE usuario_id = ?
          AND estado IN (${ACTIVE_ASSIGNMENT_STATES.map(() => '?').join(', ')})
    `).get(usuarioId, ...ACTIVE_ASSIGNMENT_STATES);
    return Number(row?.total || 0);
}

export async function POST(request) {
    try {
        const { usuario_id, proyecto_id, rol, traductor_tipo } = await request.json();
        if (!usuario_id) {
            return NextResponse.json({ error: 'usuario_id es requerido' }, { status: 400 });
        }

        const db = getDb();
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
        const requesterHasProductionRole = requesterRoles.some((roleName) => PRODUCTION_ROLES.includes(roleName));
        const isLeader = requesterRoles.includes('Lider de Grupo') && !requesterHasProductionRole;
        const isSelfAssign = Number(session.usuario_id) === Number(usuario_id);
        const canAssign = isAdmin || isLeader || isSelfAssign;
        if (!canAssign) {
            return NextResponse.json({ error: 'No tienes permisos para autoasignar a ese usuario' }, { status: 403 });
        }

        const catalogColumnExists = await hasCatalogColumn(db);
        const driveFolderColumnExists = await hasDriveFolderColumn(db);
        const secondaryRawColumnExists = await hasSecondaryRawColumn(db);

        const usuario = await db.prepare('SELECT id, roles, grupo_id FROM usuarios WHERE id = ?').get(usuario_id);
        if (!usuario) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }

        let userRoles = [];
        try {
            userRoles = JSON.parse(usuario.roles || '[]');
        } catch {
            userRoles = [];
        }

        const hasTradCore = userRoles.includes('Traductor')
            || userRoles.includes('Traductor KO')
            || userRoles.includes('Traductor JAP')
            || userRoles.includes('Traductor KO/JAP');
        const hasTradEng = userRoles.includes('Traductor ENG');
        const eligibleRoles = [];
        if (hasTradCore || hasTradEng) eligibleRoles.push('Traductor');
        if (userRoles.includes('Redrawer')) eligibleRoles.push('Redrawer');
        if (userRoles.includes('Typer')) eligibleRoles.push('Typer');
        if (eligibleRoles.length === 0) {
            return NextResponse.json({ error: 'El usuario no tiene roles productivos para asignar' }, { status: 400 });
        }

        let finalRole = rol;
        if (!finalRole) {
            if (eligibleRoles.length > 1) {
                return NextResponse.json({
                    error: 'El usuario tiene multiples roles, selecciona uno',
                    requires_role_selection: true,
                    roles: eligibleRoles
                }, { status: 400 });
            }
            finalRole = eligibleRoles[0];
        }

        if (!eligibleRoles.includes(finalRole)) {
            return NextResponse.json({ error: `El usuario no tiene el rol ${finalRole}` }, { status: 400 });
        }
        let normalizedTraductorTipo = normalizeTraductorTipo(traductor_tipo);
        if (String(finalRole) === 'Traductor' && !traductor_tipo) {
            if (hasTradEng && !hasTradCore) normalizedTraductorTipo = 'ENG';
            if (!hasTradEng && hasTradCore) normalizedTraductorTipo = 'CORE';
        }

        if (String(finalRole) === 'Traductor') {
            if (normalizedTraductorTipo === 'ENG' && !hasTradEng) {
                return NextResponse.json({ error: 'El usuario no tiene el subrol Traductor ENG' }, { status: 400 });
            }
            if (normalizedTraductorTipo === 'CORE' && !hasTradCore) {
                return NextResponse.json({ error: 'El usuario no tiene el subrol Traductor KO' }, { status: 400 });
            }
        }

        const activeAssignmentsCount = await countActiveAssignments(db, usuario_id);
        if (activeAssignmentsCount >= 1) {
            return NextResponse.json({ error: 'Ya tienes una asignacion activa. Completa o libera la actual antes de tomar otra.' }, { status: 400 });
        }

        const proyectosBase = proyecto_id
            ? await db.prepare(`
                SELECT id, titulo, estado, tipo, ${secondaryRawColumnExists ? 'raw_secundario_activo' : '0 as raw_secundario_activo'}, capitulos_totales, ${catalogColumnExists ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                       ${driveFolderColumnExists ? 'drive_folder_id' : 'NULL as drive_folder_id'}
                FROM proyectos
                WHERE id = ?
                  AND LOWER(TRIM(COALESCE(estado, 'Activo'))) NOT IN ('pausado', 'cancelado')
            `).all(proyecto_id)
            : await db.prepare(`
                SELECT id, titulo, estado, tipo, ${secondaryRawColumnExists ? 'raw_secundario_activo' : '0 as raw_secundario_activo'}, capitulos_totales, ${catalogColumnExists ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                       ${driveFolderColumnExists ? 'drive_folder_id' : 'NULL as drive_folder_id'}
                FROM proyectos
                WHERE LOWER(TRIM(COALESCE(estado, 'Activo'))) NOT IN ('pausado', 'cancelado')
            `).all();

        if (!Array.isArray(proyectosBase) || proyectosBase.length === 0) {
            return NextResponse.json({ error: proyecto_id ? 'Proyecto no encontrado' : 'No hay proyectos disponibles' }, { status: 404 });
        }

        const opciones = [];
        for (const proyecto of proyectosBase) {
            const activeUserShot = await db.prepare(`
                SELECT id
                FROM asignaciones
                WHERE usuario_id = ?
                  AND proyecto_id = ?
                  AND rol = ?
                  AND capitulo IS NOT NULL
                  AND estado IN ('Pendiente', 'En Proceso')
                LIMIT 1
            `).get(usuario_id, proyecto.id, finalRole);

            if (activeUserShot) {
                continue;
            }

            const catalogoEntries = await getProjectCatalogEntries(db, proyecto);
            let catalogo = normalizeCatalog(catalogoEntries);

            if (catalogo.length === 0) {
                const maxInt = Math.floor(Number(proyecto.capitulos_totales || 0));
                for (let i = 1; i <= maxInt; i += 1) {
                    catalogo.push(i);
                }
                if (Number(proyecto.capitulos_totales) > maxInt) {
                    catalogo.push(Number(proyecto.capitulos_totales));
                }
            }

            if (catalogo.length === 0) {
                continue;
            }

            const usedChapters = await db.prepare(`
                SELECT capitulo, estado
                FROM asignaciones
                WHERE proyecto_id = ? AND rol = ? AND capitulo IS NOT NULL
            `).all(proyecto.id, finalRole);

            const completedWithLinkRows = await db.prepare(`
                SELECT capitulo, drive_url
                FROM asignaciones
                WHERE proyecto_id = ?
                  AND rol = ?
                  AND capitulo IS NOT NULL
                  AND estado = 'Completado'
                  AND drive_url IS NOT NULL
                  AND TRIM(drive_url) != ''
            `).all(proyecto.id, finalRole);

            const blocked = new Set(
                usedChapters
                    .filter((row) => row.estado === 'Completado' || row.estado === 'Pendiente' || row.estado === 'En Proceso')
                    .map((row) => Number(row.capitulo))
            );
            const chapterEntryByNumber = new Map(catalogoEntries.map((entry) => [Number(entry.numero), entry]));
            completedWithLinkRows.forEach((row) => {
                const chapterNumber = Number(row.capitulo);
                const chapterEntry = chapterEntryByNumber.get(chapterNumber);
                if (!isRawCatalogSourceUrlForChapter(row.drive_url, chapterEntry)) {
                    blocked.add(chapterNumber);
                }
            });
            catalogoEntries.forEach((entry) => {
                if (getCatalogDeliveryUrlForRole(entry, finalRole)) {
                    blocked.add(Number(entry.numero));
                }
            });

            let disponibles = catalogo
                .filter((chapter) => !blocked.has(Number(chapter)))
                .sort((a, b) => Number(a) - Number(b));

            if (String(finalRole) === 'Traductor') {
                if (normalizedTraductorTipo === 'CORE' && Number(proyecto?.raw_secundario_activo || 0) !== 1) {
                    continue;
                }
                const byChapter = new Map(catalogoEntries.map((entry) => [Number(entry.numero), entry]));
                const filteredByVariant = disponibles.filter((chapter) => {
                    const chapterEntry = byChapter.get(Number(chapter));
                    if (!chapterEntry) return true;
                    return isChapterAvailableForTraductorType(chapterEntry, normalizedTraductorTipo);
                });
                disponibles = filteredByVariant;
            }

            let elegibles = disponibles;
            if (String(finalRole) === 'Typer' && disponibles.length > 0) {
                const prereqRows = await db.prepare(`
                    SELECT capitulo, rol
                    FROM asignaciones
                    WHERE proyecto_id = ?
                      AND capitulo IS NOT NULL
                      AND rol IN ('Traductor', 'Redrawer')
                      AND estado = 'Completado'
                      AND drive_url IS NOT NULL
                      AND TRIM(drive_url) != ''
                `).all(proyecto.id);
                const typerReadyChapters = buildTyperPrereqSet(prereqRows);
                const typerReadyByCatalog = buildTyperCatalogPrereqSet(catalogoEntries);
                elegibles = disponibles.filter((chapter) => {
                    const chapterNumber = Number(chapter);
                    return typerReadyChapters.has(chapterNumber) || typerReadyByCatalog.has(chapterNumber);
                });
            }

            if (elegibles.length === 0) {
                continue;
            }

            const nextChapter = Number(elegibles[0]);
            opciones.push({
                proyecto,
                capitulo: nextChapter,
                driveUrlFromCatalog: getCatalogDeliveryUrlForRole(
                    catalogoEntries.find((entry) => Number(entry.numero) === nextChapter),
                    finalRole
                ),
            });
        }

        if (opciones.length === 0) {
            return NextResponse.json({ error: 'No hay proyectos/capitulos disponibles para autoasignar en este rol' }, { status: 400 });
        }

        const opcionElegida = opciones[Math.floor(Math.random() * opciones.length)];
        const proyectoElegido = opcionElegida.proyecto;
        const capitulo = Number(opcionElegida.capitulo);
        const driveUrlFromCatalog = opcionElegida.driveUrlFromCatalog || null;
        const descripcion = `${proyectoElegido.titulo} - Capitulo ${capitulo}`;

        let result;
        if (traductorTipoColumnExists) {
            result = await db.prepare(`
                INSERT INTO asignaciones (usuario_id, rol, traductor_tipo, descripcion, proyecto_id, capitulo, drive_url)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                usuario_id,
                finalRole,
                String(finalRole) === 'Traductor' ? normalizedTraductorTipo : null,
                descripcion,
                proyectoElegido.id,
                capitulo,
                driveUrlFromCatalog
            );
        } else {
            result = await db.prepare(`
                INSERT INTO asignaciones (usuario_id, rol, descripcion, proyecto_id, capitulo, drive_url)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(
                usuario_id,
                finalRole,
                descripcion,
                proyectoElegido.id,
                capitulo,
                driveUrlFromCatalog
            );
        }

        const asignacion = await db.prepare(`
            SELECT
                a.id, a.usuario_id, a.rol, ${traductorTipoColumnExists ? 'a.traductor_tipo' : 'NULL as traductor_tipo'}, a.descripcion, a.estado, a.asignado_en, a.capitulo,
                u.nombre as usuario_nombre,
                p.titulo as proyecto_titulo
            FROM asignaciones a
            JOIN usuarios u ON u.id = a.usuario_id
            LEFT JOIN proyectos p ON p.id = a.proyecto_id
            WHERE a.id = ?
        `).get(result.lastInsertRowid);

        const actor = await db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(session.usuario_id);
        const actorName = actor?.nombre || 'Sistema';

        await createNotification(db, {
            usuarioId: Number(usuario_id),
            tipo: 'autoasignacion',
            titulo: 'Autoasignacion completada',
            mensaje: `${asignacion?.proyecto_titulo || 'Proyecto'} - Cap. ${asignacion?.capitulo} (${finalRole})`,
            data: { asignacion_id: Number(result.lastInsertRowid) },
        });

        await notifyRoles(
            db,
            ['Administrador', 'Lider de Grupo'],
            {
                tipo: 'asignacion_evento',
                titulo: 'Autoasignacion',
                mensaje: `${actorName} genero autoasignacion para ${asignacion?.usuario_nombre || 'usuario'} (${asignacion?.proyecto_titulo || 'Proyecto'} - Cap. ${asignacion?.capitulo})`,
                data: { asignacion_id: Number(result.lastInsertRowid) },
            },
            { excludeUserIds: [Number(session.usuario_id)], groupId: usuario?.grupo_id ?? null }
        );

        publishAssignmentEvent({
            action: 'created',
            assignment_id: Number(result.lastInsertRowid),
            usuario_id: Number(usuario_id),
            proyecto_id: proyectoElegido?.id ? Number(proyectoElegido.id) : null,
            group_id: usuario?.grupo_id ? Number(usuario.grupo_id) : null,
            ts: Date.now(),
        });

        return NextResponse.json(asignacion);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
