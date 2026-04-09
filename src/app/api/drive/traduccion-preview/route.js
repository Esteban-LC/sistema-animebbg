import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { getOAuthAccessToken } from '@/lib/google-oauth';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import { getProjectCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';

const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

async function findFolderByName(parentId, name) {
    const token = await getOAuthAccessToken();
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const params = new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1' });
    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return data?.files?.[0]?.id || null;
}

async function findDocxInFolder(folderId) {
    const token = await getOAuthAccessToken();
    const q = `'${folderId}' in parents and trashed = false and (name contains '.docx' or name contains '.doc')`;
    const params = new URLSearchParams({ q, fields: 'files(id,name,mimeType)', orderBy: 'createdTime desc', pageSize: '50' });
    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return data?.files || [];
}

function matchesChapter(filename, capNum) {
    const name = filename.toLowerCase();
    // Matches: "cap 1", "cap1", "cap 01", "cap01", "chapter 1", "chapter 1.1", etc.
    return (
        new RegExp(`\\bcap\\s*0*${capNum}\\b`, 'i').test(name) ||
        new RegExp(`\\bchapter\\s*0*${capNum}\\b`, 'i').test(name) ||
        new RegExp(`\\b0*${capNum}[._\\s-]`).test(name) ||
        new RegExp(`\\b0*${capNum}\\.docx$`, 'i').test(name)
    );
}

async function downloadFileById(fileId) {
    const token = await getOAuthAccessToken();
    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`No se pudo descargar el archivo de traduccion: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
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
            SELECT a.usuario_id, a.proyecto_id, a.capitulo, a.rol,
                   p.titulo AS proyecto_titulo,
                   p.traductor_folder_id,
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

        if (!asignacion.proyecto_id || asignacion.capitulo === null) {
            return NextResponse.json({ error: 'La asignacion no tiene proyecto o capitulo' }, { status: 400 });
        }

        const capNum = Number(asignacion.capitulo);

        // Usar la carpeta de traducciones configurada por proyecto en la BD
        // con fallback a la variable de entorno global (si existe)
        const extractFolderId = (val) => {
            if (!val) return '';
            const str = String(val).trim();
            const match = str.match(/[-\w]{25,}/);
            return match ? match[0] : str;
        };

        let proyectoFolderId = extractFolderId(asignacion.traductor_folder_id);

        if (!proyectoFolderId) {
            // Fallback: buscar por nombre en la carpeta global si está configurada
            const tradFolderId = process.env.TRADUCCIONES_FOLDER_ID;
            if (!tradFolderId) {
                return NextResponse.json({ error: 'Carpeta de traducciones no configurada para este proyecto. Configurala en la seccion de Proyectos.' }, { status: 404 });
            }
            const proyectoTitulo = String(asignacion.proyecto_titulo || `Proyecto_${asignacion.proyecto_id}`);
            proyectoFolderId = await findFolderByName(tradFolderId, proyectoTitulo);
            if (!proyectoFolderId) {
                return NextResponse.json({ error: 'No hay traduccion disponible para este proyecto' }, { status: 404 });
            }
        }

        // Buscar directamente en la carpeta del proyecto filtrando por número de capítulo
        let allFiles = await findDocxInFolder(proyectoFolderId);
        let matched = allFiles.filter(f => matchesChapter(f.name, capNum));

        // Fallback: buscar en la URL del catálogo para este capítulo específico
        if (matched.length === 0) {
            try {
                const catalog = await getProjectCatalogEntries(db, { id: asignacion.proyecto_id });
                const chapterEntry = (Array.isArray(catalog) ? catalog : []).find(
                    (e) => Number(e?.numero) === Number(capNum)
                );
                const catalogTraductorUrl = chapterEntry?.traductor_url || '';
                if (catalogTraductorUrl) {
                    const catalogFolderId = extractFolderId(catalogTraductorUrl);
                    if (catalogFolderId && catalogFolderId !== proyectoFolderId) {
                        const catalogFiles = await findDocxInFolder(catalogFolderId);
                        matched = catalogFiles.filter(f => matchesChapter(f.name, capNum));
                        // Si la carpeta del catálogo tampoco tiene archivos con número de capítulo,
                        // aceptar cualquier .docx en esa carpeta (puede ser el único archivo de ese cap)
                        if (matched.length === 0 && catalogFiles.length > 0) {
                            matched = catalogFiles;
                        }
                    }
                }
            } catch {
                // ignorar error del catálogo, continuar con lo que hay
            }
        }

        const targetFile = matched.length > 0 ? matched[0] : null;

        if (!targetFile) {
            return NextResponse.json({ error: 'No se encontro el archivo de traduccion para este capitulo' }, { status: 404 });
        }

        const fileBuffer = await downloadFileById(targetFile.id);
        const result = await mammoth.convertToHtml({ buffer: fileBuffer });

        const clean = sanitizeHtml(result.value, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
            allowedAttributes: {
                ...sanitizeHtml.defaults.allowedAttributes,
                img: ['src', 'alt', 'width', 'height'],
            },
            disallowedTagsMode: 'discard',
        });

        return NextResponse.json({ html: clean });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
