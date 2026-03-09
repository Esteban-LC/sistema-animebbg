import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { getProjectCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';

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

async function hasProjectColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

function getCatalogUrlForRole(entry, rol) {
    if (!entry) return '';
    const role = String(rol || '');
    if (role === 'Traductor') return String(entry.traductor_url || '').trim();
    if (role === 'Redrawer') return String(entry.redraw_url || '').trim();
    if (role === 'Typer') return String(entry.typer_url || '').trim();
    return '';
}

function isChapterAvailableForTraductorType(entry, traductorTipo) {
    if (!entry) return false;
    if (String(traductorTipo || 'CORE') === 'ENG') {
        return Boolean(String(entry.url || '').trim());
    }
    return Boolean(String(entry.raw_eng_url || '').trim());
}

function isSecondaryRawEnabledForProject(proyecto) {
    return Number(proyecto?.raw_secundario_activo || 0) === 1;
}

function hasCatalogRoleCompleted(entry, rol) {
    return Boolean(getCatalogUrlForRole(entry, rol));
}

async function ensureCatalogColumn(db) {
    const exists = await hasCatalogColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN capitulos_catalogo TEXT`).run();
    } catch {
        // verify below
    }
    return hasCatalogColumn(db);
}

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const chapterMap = new Map();

    for (const value of rawCatalog) {
        let numero = NaN;
        let url = '';
        let raw_eng_url = '';
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            numero = Number(value.numero);
            url = typeof value.url === 'string' ? value.url.trim() : '';
            raw_eng_url = typeof value.raw_eng_url === 'string' ? value.raw_eng_url.trim() : '';
            traductor_url = typeof value.traductor_url === 'string' ? value.traductor_url.trim() : '';
            redraw_url = typeof value.redraw_url === 'string' ? value.redraw_url.trim() : '';
            typer_url = typeof value.typer_url === 'string' ? value.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = chapterMap.get(numero);
        if (!existing) {
            chapterMap.set(numero, { numero, url, raw_eng_url, traductor_url, redraw_url, typer_url });
            continue;
        }

        chapterMap.set(numero, {
            numero,
            url: existing.url || url,
            raw_eng_url: existing.raw_eng_url || raw_eng_url,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...chapterMap.values()].sort((a, b) => a.numero - b.numero);
}

async function requireAdmin(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return false;

    const session = await db.prepare(`
        SELECT u.roles
        FROM sessions s
        JOIN usuarios u ON s.usuario_id = u.id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);
    if (!session) return false;

    try {
        const roles = JSON.parse(session.roles || '[]');
        return Array.isArray(roles) && roles.includes('Administrador');
    } catch {
        return false;
    }
}

export async function GET(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const { searchParams } = new URL(request.url);
        const rol = searchParams.get('rol');
        const mode = searchParams.get('mode');
        const traductorTipoParam = String(searchParams.get('traductor_tipo') || searchParams.get('variant') || 'CORE').toUpperCase();
        const traductorTipo = traductorTipoParam === 'ENG' ? 'ENG' : 'CORE';
        const roleFilter = rol && ['Traductor', 'Typer', 'Redrawer'].includes(rol) ? rol : null;
        const catalogColumnExists = await hasCatalogColumn(db);
        const driveFolderColumnExists = await hasDriveFolderColumn(db);
        const rawFolderColumnExists = await hasProjectColumn(db, 'raw_folder_id');
        const traductorFolderColumnExists = await hasProjectColumn(db, 'traductor_folder_id');
        const redrawFolderColumnExists = await hasProjectColumn(db, 'redraw_folder_id');
        const typerFolderColumnExists = await hasProjectColumn(db, 'typer_folder_id');
        const rawEngFolderColumnExists = await hasProjectColumn(db, 'raw_eng_folder_id');
        const secondaryRawColumnExists = await hasProjectColumn(db, 'raw_secundario_activo');
        const proyecto = await db.prepare(`
            SELECT id, titulo, capitulos_totales,
                   ${catalogColumnExists ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                   ${driveFolderColumnExists ? 'drive_folder_id' : 'NULL as drive_folder_id'},
                   ${rawFolderColumnExists ? 'raw_folder_id' : 'NULL as raw_folder_id'},
                   ${rawEngFolderColumnExists ? 'raw_eng_folder_id' : 'NULL as raw_eng_folder_id'},
                   ${secondaryRawColumnExists ? 'raw_secundario_activo' : '0 as raw_secundario_activo'},
                   ${traductorFolderColumnExists ? 'traductor_folder_id' : 'NULL as traductor_folder_id'},
                   ${redrawFolderColumnExists ? 'redraw_folder_id' : 'NULL as redraw_folder_id'},
                   ${typerFolderColumnExists ? 'typer_folder_id' : 'NULL as typer_folder_id'}
            FROM proyectos
            WHERE id = ?
        `).get(id);

        if (!proyecto) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }

        const catalogo = await getProjectCatalogEntries(db, proyecto);

        const chapterMap = new Map(catalogo.map((item) => [Number(item.numero), item]));
        let capitulosBase = catalogo
            .filter((item) => {
                if (roleFilter !== 'Traductor') return true;
                if (traductorTipo === 'CORE' && !isSecondaryRawEnabledForProject(proyecto)) return false;
                return isChapterAvailableForTraductorType(item, traductorTipo);
            })
            .map((item) => Number(item.numero));

        if (capitulosBase.length === 0) {
            const maxInt = Math.floor(Number(proyecto.capitulos_totales || 0));
            for (let i = 1; i <= maxInt; i += 1) {
                capitulosBase.push(i);
            }
            if (Number(proyecto.capitulos_totales) > maxInt) {
                capitulosBase.push(Number(proyecto.capitulos_totales));
            }
        }

        const todasAsignaciones = await db.prepare(`
            SELECT a.capitulo, a.rol, a.traductor_tipo, a.estado, a.asignado_en, a.drive_url, u.nombre as asignado_a
            FROM asignaciones a
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.proyecto_id = ? AND a.capitulo IS NOT NULL
            ORDER BY a.asignado_en DESC
        `).all(id);

        // If the project has an explicit chapter catalog, respect it strictly.
        // Historical assignments should not re-introduce chapters removed from the catalog.
        const hasExplicitCatalog = catalogo.length > 0;
        const capitulosSet = new Set(capitulosBase);
        if (!hasExplicitCatalog) {
            for (const item of todasAsignaciones) {
                if (Number.isFinite(Number(item.capitulo))) {
                    capitulosSet.add(Number(item.capitulo));
                }
            }
        }

        const now = Date.now();
        const capitulos = [...capitulosSet]
            .sort((a, b) => a - b)
            .map((numero) => {
                const chapterRows = todasAsignaciones.filter((row) => Number(row.capitulo) === Number(numero));
                const roleRows = roleFilter
                    ? chapterRows.filter((row) => row.rol === roleFilter)
                    : chapterRows;
                const latest = roleRows[0] || chapterRows[0];
                const hasActive = roleRows.some((row) => row.estado !== 'Completado');
                const chapterCatalog = chapterMap.get(Number(numero)) || null;
                const hasCompletedByAssignments = roleRows.some((row) => row.estado === 'Completado' && !!String(row.drive_url || '').trim());
                const hasCompletedByCatalog = roleFilter ? hasCatalogRoleCompleted(chapterCatalog, roleFilter) : false;
                const hasCompleted = hasCompletedByAssignments || hasCompletedByCatalog;

                let typerBlockedByPrereq = false;
                if (roleFilter === 'Typer') {
                    const tradDoneByAssignment = chapterRows.some((row) => row.rol === 'Traductor' && row.estado === 'Completado' && !!String(row.drive_url || '').trim());
                    const redrawDoneByAssignment = chapterRows.some((row) => row.rol === 'Redrawer' && row.estado === 'Completado' && !!String(row.drive_url || '').trim());
                    const tradDoneByCatalog = hasCatalogRoleCompleted(chapterCatalog, 'Traductor');
                    const redrawDoneByCatalog = hasCatalogRoleCompleted(chapterCatalog, 'Redrawer');
                    typerBlockedByPrereq = !(tradDoneByAssignment || tradDoneByCatalog) || !(redrawDoneByAssignment || redrawDoneByCatalog);
                }

                let status = 'disponible';
                if (hasActive) status = 'en_proceso';
                else if (hasCompleted) status = 'completado';
                else if (typerBlockedByPrereq) status = 'no_realizado';

                let dias_desde_asignacion = null;
                if (latest?.asignado_en) {
                    dias_desde_asignacion = Math.floor((now - new Date(latest.asignado_en).getTime()) / (1000 * 60 * 60 * 24));
                }

                return {
                    numero,
                    url: String(chapterCatalog?.url || ''),
                    raw_eng_url: String(chapterCatalog?.raw_eng_url || ''),
                    traductor_url: String(chapterCatalog?.traductor_url || ''),
                    redraw_url: String(chapterCatalog?.redraw_url || ''),
                    typer_url: String(chapterCatalog?.typer_url || ''),
                    status,
                    asignado_a: latest?.asignado_a || null,
                    fecha_asignacion: latest?.asignado_en || null,
                    dias_desde_asignacion
                };
            });

        if (mode === 'next' && roleFilter) {
            const nextAvailable = capitulos.find((chapter) => chapter.status === 'disponible');
            return NextResponse.json(nextAvailable ? [nextAvailable] : []);
        }

        return NextResponse.json(capitulos);
    } catch (error) {
        console.error('Error fetching chapters:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const isAdmin = await requireAdmin(db);
        if (!isAdmin) {
            return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const numero = Number(body?.numero);
        if (!Number.isFinite(numero) || numero <= 0) {
            return NextResponse.json({ error: 'numero es requerido y debe ser mayor a 0' }, { status: 400 });
        }

        const canUseCatalog = await ensureCatalogColumn(db);
        if (!canUseCatalog) {
            return NextResponse.json({ error: 'La base de datos no soporta capitulos_catalogo' }, { status: 500 });
        }

        const proyecto = await db.prepare(`
            SELECT id, titulo, capitulos_catalogo
            FROM proyectos
            WHERE id = ?
        `).get(id);

        if (!proyecto) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }

        let catalogo = [];
        try {
            catalogo = normalizeCatalog(JSON.parse(proyecto.capitulos_catalogo || '[]'));
        } catch {
            catalogo = [];
        }

        const merged = normalizeCatalog([
            ...catalogo,
            {
                numero,
                url: typeof body?.url === 'string' ? body.url : '',
                raw_eng_url: typeof body?.raw_eng_url === 'string' ? body.raw_eng_url : '',
                traductor_url: typeof body?.traductor_url === 'string' ? body.traductor_url : '',
                redraw_url: typeof body?.redraw_url === 'string' ? body.redraw_url : '',
                typer_url: typeof body?.typer_url === 'string' ? body.typer_url : '',
            },
        ]);

        const maxCatalog = merged.length > 0 ? merged[merged.length - 1].numero : null;
        await db.prepare(`
            UPDATE proyectos
            SET capitulos_catalogo = ?, capitulos_totales = ?, ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(JSON.stringify(merged), maxCatalog, id);

        return NextResponse.json({
            ok: true,
            proyecto_id: Number(id),
            proyecto_titulo: proyecto.titulo,
            capitulo: numero,
            total_capitulos_catalogo: merged.length,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
