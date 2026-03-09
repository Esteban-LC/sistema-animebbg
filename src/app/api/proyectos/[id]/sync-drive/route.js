import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { catalogFromDriveByRoleFolders } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const chapterMap = new Map();

    for (const value of rawCatalog) {
        let numero = null;
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

async function hasDriveFolderColumn(db) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(proyectos)').all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'drive_folder_id');
    } catch {
        return false;
    }
}

async function ensureDriveFolderColumn(db) {
    const exists = await hasDriveFolderColumn(db);
    if (exists) return true;
    try {
        await db.prepare('ALTER TABLE proyectos ADD COLUMN drive_folder_id TEXT').run();
    } catch {
        // verify below
    }
    return hasDriveFolderColumn(db);
}

async function getAuth(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);
    if (!session) return null;

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch {
        roles = [];
    }

    return {
        userId: Number(session.usuario_id),
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo'),
    };
}

function mergeCatalog(existingCatalog, detectedCatalog, overwrite) {
    const merged = new Map();

    for (const entry of existingCatalog) {
            merged.set(Number(entry.numero), {
                numero: Number(entry.numero),
                url: String(entry.url || '').trim(),
                raw_eng_url: String(entry.raw_eng_url || '').trim(),
                traductor_url: String(entry.traductor_url || '').trim(),
                redraw_url: String(entry.redraw_url || '').trim(),
                typer_url: String(entry.typer_url || '').trim(),
        });
    }

    let created = 0;
    let updated = 0;
    for (const detected of detectedCatalog) {
        const chapter = Number(detected.numero);
        const url = String(detected.url || '').trim();
        const raw_eng_url = String(detected.raw_eng_url || '').trim();
        const traductor_url = String(detected.traductor_url || '').trim();
        const redraw_url = String(detected.redraw_url || '').trim();
        const typer_url = String(detected.typer_url || '').trim();
        if (!Number.isFinite(chapter) || chapter <= 0) continue;
        if (!url && !raw_eng_url && !traductor_url && !redraw_url && !typer_url) continue;

        const current = merged.get(chapter);
        if (!current) {
            merged.set(chapter, {
                numero: chapter,
                url,
                raw_eng_url,
                traductor_url,
                redraw_url,
                typer_url,
            });
            created += 1;
            continue;
        }

        if (overwrite || !current.url) {
            if (current.url !== url) {
                current.url = url;
                updated += 1;
            }
        }
        if (overwrite || !current.raw_eng_url) {
            if (raw_eng_url && current.raw_eng_url !== raw_eng_url) {
                current.raw_eng_url = raw_eng_url;
                updated += 1;
            }
        }
        if (overwrite || !current.traductor_url) {
            if (traductor_url && current.traductor_url !== traductor_url) {
                current.traductor_url = traductor_url;
                updated += 1;
            }
        }
        if (overwrite || !current.redraw_url) {
            if (redraw_url && current.redraw_url !== redraw_url) {
                current.redraw_url = redraw_url;
                updated += 1;
            }
        }
        if (overwrite || !current.typer_url) {
            if (typer_url && current.typer_url !== typer_url) {
                current.typer_url = typer_url;
                updated += 1;
            }
        }
        merged.set(chapter, current);
    }

    const catalog = [...merged.values()].sort((a, b) => a.numero - b.numero);
    return { catalog, created, updated };
}

export async function POST(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const auth = await getAuth(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!auth.isAdmin && !auth.isLeader) {
            return NextResponse.json({ error: 'Solo administradores o lideres pueden sincronizar con Drive' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const folderIdFromBody = String(body?.folderId || body?.drive_folder_id || '').trim();
        const overwrite = Boolean(body?.overwrite);
        const mode = String(body?.mode || 'auto');
        const saveFolderId = body?.saveFolderId !== false;

        const hasDriveFolderId = await ensureDriveFolderColumn(db);
        const proyecto = await db.prepare(`
            SELECT
                id,
                titulo,
                capitulos_catalogo,
                ${hasDriveFolderId ? 'drive_folder_id' : 'NULL as drive_folder_id'}
            FROM proyectos
            WHERE id = ?
        `).get(id);

        if (!proyecto) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }

        const folderId = folderIdFromBody || String(proyecto.drive_folder_id || '').trim();
        if (!folderId) {
            return NextResponse.json({ error: 'Debes enviar folderId o guardar drive_folder_id en el proyecto' }, { status: 400 });
        }

        const driveScan = await catalogFromDriveByRoleFolders(folderId, mode);
        const detectedCatalog = Array.isArray(driveScan?.catalog) ? driveScan.catalog : [];
        const ignored = Array.isArray(driveScan?.ignored) ? driveScan.ignored : [];

        let existingCatalog = [];
        try {
            existingCatalog = normalizeCatalog(JSON.parse(proyecto.capitulos_catalogo || '[]'));
        } catch {
            existingCatalog = [];
        }

        const beforeCount = existingCatalog.length;
        const { catalog, created, updated } = mergeCatalog(existingCatalog, detectedCatalog, overwrite);
        const total = catalog.length > 0 ? catalog[catalog.length - 1].numero : null;

        const updateFields = [
            'capitulos_catalogo = ?',
            'capitulos_totales = ?',
            'ultima_actualizacion = CURRENT_TIMESTAMP',
        ];
        const updateValues = [JSON.stringify(catalog), total];

        if (hasDriveFolderId && saveFolderId) {
            updateFields.push('drive_folder_id = ?');
            updateValues.push(folderId);
        }

        updateValues.push(id);
        await db.prepare(`
            UPDATE proyectos
            SET ${updateFields.join(', ')}
            WHERE id = ?
        `).run(...updateValues);

        return NextResponse.json({
            ok: true,
            proyecto_id: Number(id),
            proyecto_titulo: proyecto.titulo,
            folder_id: folderId,
            mode: driveScan?.mode || 'flat',
            role_folders: driveScan?.role_folders || {},
            overwrite,
            summary: {
                items_en_drive: Number(driveScan?.items_en_drive || 0),
                capitulos_detectados: detectedCatalog.length,
                capitulos_antes: beforeCount,
                capitulos_despues: catalog.length,
                nuevos: created,
                actualizados: updated,
                ignorados_por_nombre: ignored.length,
            },
            ignored_preview: ignored.slice(0, 20),
            owners_preview: Array.isArray(driveScan?.owners_preview) ? driveScan.owners_preview.slice(0, 20) : [],
            catalog_preview: catalog.slice(0, 20),
        });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error sincronizando con Drive' }, { status: 500 });
    }
}
