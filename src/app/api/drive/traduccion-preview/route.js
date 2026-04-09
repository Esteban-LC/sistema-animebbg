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

// Exporta un Google Docs a buffer .docx
async function exportGoogleDocAsDocx(fileId) {
    const token = await getOAuthAccessToken();
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`No se pudo exportar el documento: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

// Extrae el file ID de una URL de Google Docs o Drive file
function extractGoogleFileId(url) {
    const str = String(url || '').trim();
    // Google Docs: docs.google.com/document/d/{id}/...
    const docsMatch = str.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]{20,})/);
    if (docsMatch) return { id: docsMatch[1], isGoogleDoc: true };
    // Drive file: drive.google.com/file/d/{id}/...
    const fileMatch = str.match(/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{20,})/);
    if (fileMatch) return { id: fileMatch[1], isGoogleDoc: false };
    return null;
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

        const extractFolderId = (val) => {
            if (!val) return '';
            const str = String(val).trim();
            const match = str.match(/[-\w]{25,}/);
            return match ? match[0] : str;
        };

        // Recopilar todas las carpetas candidatas donde buscar el .docx
        const candidateFolderIds = [];
        const seenFolderIds = new Set();
        // URLs directas a archivos (Google Docs o Drive files), en orden de preferencia
        const directFileUrls = [];
        const seenFileIds = new Set();

        const addFolder = (id) => {
            const fid = extractFolderId(id);
            if (fid && !seenFolderIds.has(fid)) {
                seenFolderIds.add(fid);
                candidateFolderIds.push(fid);
            }
        };

        const addDirectUrl = (url) => {
            const parsed = extractGoogleFileId(url);
            if (parsed && !seenFileIds.has(parsed.id)) {
                seenFileIds.add(parsed.id);
                directFileUrls.push(parsed);
            }
        };

        // Clasifica una URL: si es Google Docs/file directo la agrega como archivo directo,
        // si es carpeta de Drive la agrega como carpeta candidata
        const addUrl = (url) => {
            if (!url) return;
            const str = String(url).trim();
            if (str.includes('docs.google.com') || str.includes('drive.google.com/file/')) {
                addDirectUrl(str);
            } else {
                addFolder(str);
            }
        };

        // 1. Carpeta de traducciones configurada en el proyecto
        addFolder(asignacion.traductor_folder_id);

        // 2. Carpeta global de traducciones (env) → buscar subcarpeta del proyecto
        if (candidateFolderIds.length === 0) {
            const tradFolderId = process.env.TRADUCCIONES_FOLDER_ID;
            if (tradFolderId) {
                const proyectoTitulo = String(asignacion.proyecto_titulo || `Proyecto_${asignacion.proyecto_id}`);
                try {
                    const globalSubfolder = await findFolderByName(tradFolderId, proyectoTitulo);
                    addFolder(globalSubfolder);
                } catch { /* ignorar */ }
            }
        }

        // 3. drive_url de la asignación completada del Traductor para este capítulo
        try {
            const traductorAssignment = await db.prepare(`
                SELECT drive_url FROM asignaciones
                WHERE proyecto_id = ? AND capitulo = ? AND rol IN ('Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP')
                  AND estado = 'Completado' AND drive_url IS NOT NULL AND TRIM(drive_url) != ''
                ORDER BY completado_en DESC LIMIT 1
            `).get(asignacion.proyecto_id, asignacion.capitulo);
            addUrl(traductorAssignment?.drive_url);
        } catch { /* ignorar */ }

        // 4a. Catálogo almacenado en BD (sin sincronizar Drive, más rápido y confiable)
        try {
            const proyecto = await db.prepare(`SELECT capitulos_catalogo FROM proyectos WHERE id = ?`).get(asignacion.proyecto_id);
            const storedCatalog = JSON.parse(proyecto?.capitulos_catalogo || '[]');
            const storedEntry = Array.isArray(storedCatalog)
                ? storedCatalog.find((e) => Number(e?.numero) === Number(capNum))
                : null;
            addUrl(storedEntry?.traductor_url);
        } catch { /* ignorar */ }

        // 4b. Catálogo sincronizado con Drive (fallback más completo)
        try {
            const catalog = await getProjectCatalogEntries(db, { id: asignacion.proyecto_id });
            const chapterEntry = (Array.isArray(catalog) ? catalog : []).find(
                (e) => Number(e?.numero) === Number(capNum)
            );
            addUrl(chapterEntry?.traductor_url);
        } catch { /* ignorar */ }

        if (candidateFolderIds.length === 0 && directFileUrls.length === 0) {
            return NextResponse.json({ error: 'Carpeta de traducciones no configurada para este proyecto. Configurala en la seccion de Proyectos.' }, { status: 404 });
        }

        // Buscar el .docx en cada carpeta candidata
        let targetFile = null;
        for (const folderId of candidateFolderIds) {
            try {
                const files = await findDocxInFolder(folderId);
                const matched = files.filter(f => matchesChapter(f.name, capNum));
                if (matched.length > 0) {
                    targetFile = matched[0];
                    break;
                }
                // Si la carpeta tiene exactamente un .docx y no hay otros capítulos en juego,
                // asumirlo como el archivo correcto (carpeta específica del capítulo)
                if (files.length === 1 && candidateFolderIds.indexOf(folderId) > 0) {
                    targetFile = files[0];
                    break;
                }
            } catch { /* ignorar carpeta inaccesible */ }
        }

        // Si no se encontró en carpetas, intentar URLs directas (Google Docs o archivos Drive)
        if (!targetFile && directFileUrls.length > 0) {
            for (const { id, isGoogleDoc } of directFileUrls) {
                try {
                    const fileBuffer = isGoogleDoc
                        ? await exportGoogleDocAsDocx(id)
                        : await downloadFileById(id);
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
                } catch { /* intentar el siguiente */ }
            }
        }

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
