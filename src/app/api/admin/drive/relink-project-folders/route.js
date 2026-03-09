import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import {
    findDriveFolderIdByName,
    listDriveItemsByFolder,
    pickBestProjectFolderPublic,
    catalogFromWorkspaceByProjectTitle,
} from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

function detectRoleFolder(name) {
    const key = String(name || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!key) return null;
    if ((key.includes('ingles') || key.includes('english') || /\beng\b/.test(key)) && !key.includes('trad')) return 'raw_eng';
    if (key.includes('raw')) return 'raw';
    if (key.includes('traduccion') || key.includes('trad') || key.includes('translator')) return 'traductor';
    if (key.includes('redraw') || key.includes('redibujo') || key.includes('caps limpios')) return 'redraw';
    if (key.includes('tipeo') || key.includes('typer') || key.includes('typeo') || key.includes('typeset')) return 'typer';
    return null;
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

async function ensureDriveFolderColumn(db) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(proyectos)').all();
        const exists = Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'drive_folder_id');
        if (exists) return true;
        await db.prepare('ALTER TABLE proyectos ADD COLUMN drive_folder_id TEXT').run();
        return true;
    } catch {
        return false;
    }
}

async function ensureCatalogColumn(db) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(proyectos)').all();
        const exists = Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'capitulos_catalogo');
        if (exists) return true;
        await db.prepare('ALTER TABLE proyectos ADD COLUMN capitulos_catalogo TEXT').run();
        return true;
    } catch {
        return false;
    }
}

export async function POST(request) {
    try {
        const db = getDb();
        const isAdmin = await requireAdmin(db);
        if (!isAdmin) {
            return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const dryRun = body?.dry_run !== false;
        const workspaceName = String(body?.workspace_name || process.env.DRIVE_WORKSPACE_FOLDER_NAME || 'AnimeBBG-C4').trim();
        const workspaceIdInput = String(body?.workspace_folder_id || process.env.DRIVE_WORKSPACE_FOLDER_ID || '').trim();
        const workspaceFolderId = workspaceIdInput || await findDriveFolderIdByName(workspaceName);
        if (!workspaceFolderId) {
            return NextResponse.json({ error: `No se encontro carpeta workspace: ${workspaceName}` }, { status: 404 });
        }

        const hasDriveFolderColumn = await ensureDriveFolderColumn(db);
        if (!hasDriveFolderColumn) {
            return NextResponse.json({ error: 'No se pudo habilitar drive_folder_id en proyectos' }, { status: 500 });
        }
        const hasCatalogColumn = await ensureCatalogColumn(db);
        if (!hasCatalogColumn) {
            return NextResponse.json({ error: 'No se pudo habilitar capitulos_catalogo en proyectos' }, { status: 500 });
        }

        const projects = await db.prepare(`
            SELECT id, titulo, drive_folder_id
            FROM proyectos
            ORDER BY id ASC
        `).all();

        const workspaceChildren = await listDriveItemsByFolder(workspaceFolderId);
        const roleContainers = {};
        for (const item of workspaceChildren) {
            const role = detectRoleFolder(item?.name);
            if (!role) continue;
            if (!roleContainers[role]) roleContainers[role] = item;
        }

        const report = [];
        let updated = 0;
        let matched = 0;
        let withoutMatch = 0;

        for (const project of Array.isArray(projects) ? projects : []) {
            const roleFolders = {};
            for (const role of ['raw', 'raw_eng', 'traductor', 'redraw', 'typer']) {
                const container = roleContainers[role];
                if (!container?.id) continue;
                const children = (await listDriveItemsByFolder(container.id))
                    .filter((item) => String(item?.mimeType || '').includes('folder'));
                const selected = pickBestProjectFolderPublic(children, project.titulo) ||
                    (children.length === 1 ? children[0] : null);
                if (selected?.id) {
                    roleFolders[role] = selected;
                }
            }

            let folderId = String(project.drive_folder_id || '').trim();
            if (!folderId) {
                folderId = String(roleFolders.raw?.id || roleFolders.raw_eng?.id || roleFolders.traductor?.id || roleFolders.redraw?.id || roleFolders.typer?.id || '').trim();
            }

            const catalogScan = folderId
                ? await catalogFromWorkspaceByProjectTitle(workspaceFolderId, project.titulo).catch(() => null)
                : null;
            const detectedCount = Array.isArray(catalogScan?.catalog) ? catalogScan.catalog.length : 0;
            const detectedCatalog = Array.isArray(catalogScan?.catalog) ? catalogScan.catalog : [];
            const sortedCatalog = [...detectedCatalog].sort((a, b) => Number(a.numero) - Number(b.numero));
            const linkPreview = sortedCatalog.slice(0, 5).map((chapter) => ({
                capitulo: Number(chapter?.numero),
                raw: String(chapter?.url || ''),
                raw_eng: String(chapter?.raw_eng_url || ''),
                traductor: String(chapter?.traductor_url || ''),
                redraw: String(chapter?.redraw_url || ''),
                typer: String(chapter?.typer_url || ''),
            }));

            if (folderId) matched += 1;
            else withoutMatch += 1;

            report.push({
                proyecto_id: Number(project.id),
                titulo: project.titulo,
                folder_id_actual: String(project.drive_folder_id || ''),
                folder_id_detectado: folderId,
                role_folders: Object.fromEntries(
                    Object.entries(roleFolders).map(([k, v]) => [k, { id: String(v?.id || ''), name: String(v?.name || '') }])
                ),
                capitulos_detectados: detectedCount,
                role_folder_urls: Object.fromEntries(
                    Object.entries(roleFolders).map(([k, v]) => [k, `https://drive.google.com/drive/folders/${String(v?.id || '')}`])
                ),
                capitulos_preview: linkPreview,
            });

            if (!dryRun && folderId) {
                const currentFolderId = String(project.drive_folder_id || '').trim();
                const maxChapter = sortedCatalog.length > 0 ? Number(sortedCatalog[sortedCatalog.length - 1].numero) : null;
                await db.prepare(`
                    UPDATE proyectos
                    SET drive_folder_id = ?,
                        capitulos_catalogo = ?,
                        capitulos_totales = COALESCE(?, capitulos_totales),
                        ultima_actualizacion = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    folderId,
                    JSON.stringify(sortedCatalog),
                    maxChapter,
                    project.id
                );
                if (folderId !== currentFolderId) {
                    updated += 1;
                }
            }
        }

        return NextResponse.json({
            ok: true,
            dry_run: dryRun,
            workspace_folder_id: workspaceFolderId,
            summary: {
                proyectos: report.length,
                matched,
                without_match: withoutMatch,
                updated,
            },
            preview: report.slice(0, 300),
        });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error relink masivo' }, { status: 500 });
    }
}
