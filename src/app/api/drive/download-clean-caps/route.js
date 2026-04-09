import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { zipSync } from 'fflate';
import { getProjectCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function extractFolderId(input) {
    if (!input) return null;
    try {
        const url = new URL(input);
        const fromPath = url.pathname.match(/\/drive\/folders\/([^/?#]+)/)?.[1];
        if (fromPath) return fromPath;
        const fromQuery = url.searchParams.get('id');
        if (fromQuery) return fromQuery;
        return null;
    } catch {
        const fromRaw = String(input).match(/([A-Za-z0-9_-]{20,})/);
        return fromRaw?.[1] || null;
    }
}

function decodeEscapes(value) {
    if (!value) return '';
    return value
        .replace(/\\u003d/g, '=')
        .replace(/\\u0026/g, '&')
        .replace(/\\u002f/gi, '/')
        .replace(/\\u003c/gi, '<')
        .replace(/\\u003e/gi, '>')
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function parseImageFiles(html) {
    const unescaped = html.replace(/&quot;/g, '"');
    const regex = /null,"([A-Za-z0-9_-]{20,})"\],null,null,null,"(image\/[^"]+)".{0,1500}?\[\[\["([^"]+\.(?:jpe?g|png|webp|gif|bmp|avif))",null,true\]\]\]/gsi;
    const filesMap = new Map();
    let match;
    while ((match = regex.exec(unescaped)) !== null) {
        const id = match[1];
        const mimeType = decodeEscapes(match[2] || '');
        const name = decodeEscapes(match[3] || '');
        if (!id || !name || !mimeType.startsWith('image/')) continue;
        filesMap.set(id, { id, name });
    }
    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    return [...filesMap.values()].sort((a, b) => collator.compare(a.name, b.name));
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const assignmentId = Number(searchParams.get('id'));

        if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
            return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        }

        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;
        if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const db = getDb();
        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        let roles = [];
        try { roles = JSON.parse(session.roles || '[]'); } catch { roles = []; }
        const isAdmin = roles.includes('Administrador');
        const isLeader = roles.includes('Lider de Grupo');

        const asignacion = await db.prepare(`
            SELECT a.usuario_id, a.proyecto_id, a.capitulo, a.rol, a.estado,
                   p.titulo as proyecto_titulo,
                   COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) AS grupo_id
            FROM asignaciones a
            LEFT JOIN proyectos p ON p.id = a.proyecto_id
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            WHERE a.id = ?
        `).get(assignmentId);

        if (!asignacion) return NextResponse.json({ error: 'Asignacion no encontrada' }, { status: 404 });

        const isOwner = Number(asignacion.usuario_id) === Number(session.usuario_id);
        const canViewAsLeader = isLeader && session.grupo_id && Number(asignacion.grupo_id) === Number(session.grupo_id);
        if (!isAdmin && !canViewAsLeader && !isOwner) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const rol = String(asignacion.rol || '').toLowerCase();
        if (!isAdmin && !canViewAsLeader && rol !== 'typer') {
            return NextResponse.json({ error: 'Solo typers pueden descargar caps limpios' }, { status: 403 });
        }

        if (!asignacion.proyecto_id || asignacion.capitulo === null) {
            return NextResponse.json({ error: 'La asignacion no tiene proyecto o capitulo asignado' }, { status: 400 });
        }

        // Buscar la asignacion completada del redrawer del mismo proyecto/capitulo
        const redrawAssignment = await db.prepare(`
            SELECT drive_url FROM asignaciones
            WHERE proyecto_id = ? AND capitulo = ? AND rol = 'Redrawer' AND estado = 'Completado'
            ORDER BY completado_en DESC
            LIMIT 1
        `).get(asignacion.proyecto_id, asignacion.capitulo);

        let redrawFolderUrl = redrawAssignment?.drive_url || null;

        if (!redrawFolderUrl) {
            // Fallback 1: leer el catálogo almacenado en la BD directamente (sin sincronizar Drive)
            try {
                const proyecto = await db.prepare(`SELECT capitulos_catalogo FROM proyectos WHERE id = ?`).get(asignacion.proyecto_id);
                const catalog = JSON.parse(proyecto?.capitulos_catalogo || '[]');
                const chapterEntry = Array.isArray(catalog)
                    ? catalog.find((e) => Number(e?.numero) === Number(asignacion.capitulo))
                    : null;
                redrawFolderUrl = chapterEntry?.redraw_url || null;
            } catch {
                redrawFolderUrl = null;
            }
        }

        if (!redrawFolderUrl) {
            // Fallback 2: sincronizar catálogo completo con Drive
            try {
                const catalog = await getProjectCatalogEntries(db, { id: asignacion.proyecto_id });
                const chapterEntry = (Array.isArray(catalog) ? catalog : []).find(
                    (e) => Number(e?.numero) === Number(asignacion.capitulo)
                );
                redrawFolderUrl = chapterEntry?.redraw_url || null;
            } catch {
                redrawFolderUrl = null;
            }
        }

        if (!redrawFolderUrl) {
            return NextResponse.json({ error: 'No hay caps limpios disponibles para este capitulo (redraw no completado)' }, { status: 404 });
        }

        const folderId = extractFolderId(redrawFolderUrl);
        if (!folderId) {
            return NextResponse.json({ error: 'URL de la carpeta de caps limpios invalida' }, { status: 400 });
        }

        const folderRes = await fetch(`https://drive.google.com/drive/folders/${folderId}?usp=sharing`, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' },
            cache: 'no-store',
        });
        if (!folderRes.ok) {
            return NextResponse.json({ error: 'No se pudo leer la carpeta de caps limpios' }, { status: 400 });
        }

        const html = await folderRes.text();
        const imageFiles = parseImageFiles(html);

        if (imageFiles.length === 0) {
            return NextResponse.json({ error: 'No se encontraron imagenes en los caps limpios' }, { status: 404 });
        }

        // Descargar en paralelo
        const CONCURRENCY = 5;
        const zipEntries = {};
        const chunks = [];
        for (let i = 0; i < imageFiles.length; i += CONCURRENCY) {
            chunks.push(imageFiles.slice(i, i + CONCURRENCY));
        }
        for (const chunk of chunks) {
            await Promise.all(chunk.map(async (file) => {
                const imgRes = await fetch(`https://drive.google.com/uc?export=download&id=${file.id}`, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                });
                if (!imgRes.ok) return;
                const buffer = await imgRes.arrayBuffer();
                zipEntries[file.name] = new Uint8Array(buffer);
            }));
        }

        if (Object.keys(zipEntries).length === 0) {
            return NextResponse.json({ error: 'No se pudieron descargar los caps limpios' }, { status: 500 });
        }

        const zipped = zipSync(zipEntries, { level: 0 });
        const proyectoTitulo = String(asignacion.proyecto_titulo || 'proyecto').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '');
        const cap = String(asignacion.capitulo).padStart(3, '0');
        const filename = `${proyectoTitulo}_Cap${cap}_Clean.zip`;

        return new Response(zipped, {
            status: 200,
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Content-Length': String(zipped.byteLength),
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
