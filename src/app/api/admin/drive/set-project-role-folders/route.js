import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { catalogFromRoleFolderIds } from '@/lib/google-drive';
import { normalizeCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';

function extractFolderId(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (!value.includes('http')) return value;
    try {
        const url = new URL(value);
        const path = String(url.pathname || '');
        const match = path.match(/\/drive\/folders\/([^/?#]+)/i);
        if (match?.[1]) return String(match[1]).trim();
        const id = url.searchParams.get('id');
        return String(id || '').trim();
    } catch {
        return '';
    }
}

async function requireAdmin(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return false;

    const session = await db.prepare(`
        SELECT u.roles
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
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

async function ensureColumns(db) {
    const columns = [
        ['drive_folder_id', 'drive_folder_id TEXT'],
        ['capitulos_catalogo', 'capitulos_catalogo TEXT'],
        ['raw_folder_id', 'raw_folder_id TEXT'],
        ['raw_eng_folder_id', 'raw_eng_folder_id TEXT'],
        ['traductor_folder_id', 'traductor_folder_id TEXT'],
        ['redraw_folder_id', 'redraw_folder_id TEXT'],
        ['typer_folder_id', 'typer_folder_id TEXT'],
    ];

    for (const [name, sql] of columns) {
        try {
            const info = await db.prepare('PRAGMA table_info(proyectos)').all();
            const exists = Array.isArray(info) && info.some((col) => col?.name === name);
            if (!exists) {
                await db.prepare(`ALTER TABLE proyectos ADD COLUMN ${sql}`).run();
            }
        } catch {
            return false;
        }
    }
    return true;
}

export async function POST(request) {
    try {
        const db = getDb();
        const isAdmin = await requireAdmin(db);
        if (!isAdmin) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

        const ok = await ensureColumns(db);
        if (!ok) return NextResponse.json({ error: 'No se pudo preparar columnas de proyecto' }, { status: 500 });

        const body = await request.json().catch(() => ({}));
        const proyectoId = Number(body?.proyecto_id || 0);
        if (!proyectoId) {
            return NextResponse.json({ error: 'proyecto_id es requerido' }, { status: 400 });
        }

        const roleFolders = {
            raw: extractFolderId(body?.raw || body?.raw_folder_id || ''),
            raw_eng: extractFolderId(body?.raw_eng || body?.raw_eng_folder_id || body?.ingles || body?.eng || ''),
            traductor: extractFolderId(body?.traduccion || body?.traductor || body?.traductor_folder_id || ''),
            redraw: extractFolderId(body?.redraw || body?.caps_limpios || body?.redraw_folder_id || ''),
            typer: extractFolderId(body?.typeo || body?.typer || body?.typer_folder_id || ''),
        };

        if (!roleFolders.raw && !roleFolders.raw_eng && !roleFolders.traductor && !roleFolders.redraw && !roleFolders.typer) {
            return NextResponse.json({ error: 'Debes enviar al menos un folder/link por rol' }, { status: 400 });
        }

        const proyecto = await db.prepare('SELECT id, titulo FROM proyectos WHERE id = ?').get(proyectoId);
        if (!proyecto) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });

        const scan = await catalogFromRoleFolderIds(roleFolders);
        const catalog = normalizeCatalogEntries(scan?.catalog || []);
        const maxChapter = catalog.length > 0 ? Number(catalog[catalog.length - 1].numero) : null;

        await db.prepare(`
            UPDATE proyectos
            SET raw_folder_id = ?,
                raw_eng_folder_id = ?,
                traductor_folder_id = ?,
                redraw_folder_id = ?,
                typer_folder_id = ?,
                drive_folder_id = COALESCE(NULLIF(TRIM(drive_folder_id), ''), ?),
                capitulos_catalogo = ?,
                capitulos_totales = COALESCE(?, capitulos_totales),
                ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            roleFolders.raw || null,
            roleFolders.raw_eng || null,
            roleFolders.traductor || null,
            roleFolders.redraw || null,
            roleFolders.typer || null,
            roleFolders.raw || roleFolders.raw_eng || roleFolders.traductor || roleFolders.redraw || roleFolders.typer || null,
            JSON.stringify(catalog),
            maxChapter,
            proyectoId
        );

        return NextResponse.json({
            ok: true,
            proyecto_id: proyectoId,
            proyecto_titulo: proyecto.titulo,
            role_folders: roleFolders,
            capitulos_detectados: catalog.length,
            catalog_preview: catalog.slice(0, 20),
            ignored_preview: Array.isArray(scan?.ignored) ? scan.ignored.slice(0, 20) : [],
        });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error guardando carpetas por rol' }, { status: 500 });
    }
}
