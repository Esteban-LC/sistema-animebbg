import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { getOrCreateFolderOAuth, uploadFileToDriveOAuth } from '@/lib/google-oauth';
import { unzipSync } from 'fflate';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const DEST_FOLDERS = {
    redrawer: process.env.CAPS_LIMPIOS_FOLDER_ID || '',
    typer: process.env.TYPPEOS_FOLDER_ID || '',
    traductor: process.env.TRADUCCIONES_FOLDER_ID || '',
};

const ALLOWED_IMAGE_TYPES = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'avif': 'image/avif',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'psd': 'image/vnd.adobe.photoshop',
};

const ALLOWED_DOC_TYPES = {
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'doc': 'application/msword',
};

function getMimeType(filename, rol) {
    const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
    if (rol === 'traductor') return ALLOWED_DOC_TYPES[ext] || null;
    return ALLOWED_IMAGE_TYPES[ext] || null;
}

function isAllowedFile(filename, rol) {
    return getMimeType(filename, rol) !== null;
}

// Verifica magic bytes para asegurar que el archivo es realmente lo que dice ser
function hasValidMagicBytes(data, filename) {
    const ext = String(filename || '').split('.').pop()?.toLowerCase() || '';
    if (data.length < 4) return false;
    const b = data;
    if (ext === 'jpg' || ext === 'jpeg') return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    if (ext === 'png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    if (ext === 'gif') return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
    if (ext === 'webp') return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
    if (ext === 'bmp') return b[0] === 0x42 && b[1] === 0x4D;
    if (ext === 'psd') return b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53;
    if (ext === 'docx') return b[0] === 0x50 && b[1] === 0x4B; // ZIP-based (OOXML)
    if (ext === 'doc') return b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;
    // tiff/avif/bmp/tif: permisivos por ser menos comunes pero válidos
    return true;
}

const UPLOAD_ROLES = ['redrawer', 'typer', 'traductor'];

export async function POST(request) {
    try {
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

        const formData = await request.formData();
        const assignmentId = Number(formData.get('assignment_id'));
        const uploadFile = formData.get('zip_file');

        if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
            return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        }
        if (!uploadFile || typeof uploadFile === 'string') {
            return NextResponse.json({ error: 'No se recibio el archivo' }, { status: 400 });
        }

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
        if (!isAdmin && !canViewAsLeader && !UPLOAD_ROLES.includes(rol)) {
            return NextResponse.json({ error: 'Tu rol no tiene permitido subir entregables' }, { status: 403 });
        }

        const destFolderId = DEST_FOLDERS[rol] || '';
        if (!destFolderId) {
            return NextResponse.json({ error: `Carpeta destino no configurada para rol ${asignacion.rol}` }, { status: 500 });
        }

        if (!asignacion.proyecto_id || asignacion.capitulo === null || asignacion.capitulo === undefined) {
            return NextResponse.json({ error: 'La asignacion no tiene proyecto o capitulo asignado' }, { status: 400 });
        }

        const proyectoTitulo = String(asignacion.proyecto_titulo || `Proyecto_${asignacion.proyecto_id}`);
        const capFolderName = `Chapter ${Number(asignacion.capitulo)}`;
        const filename = uploadFile.name || 'entrega';

        // Traductores suben un solo archivo (docx/pdf), no un zip
        if (rol === 'traductor') {
            const mime = getMimeType(filename, rol);
            if (!mime) {
                return NextResponse.json({ error: 'Formato no valido. Sube un archivo .docx o .doc' }, { status: 400 });
            }
            const fileBuffer = Buffer.from(await uploadFile.arrayBuffer());
            if (!hasValidMagicBytes(fileBuffer, filename)) {
                return NextResponse.json({ error: 'El archivo no es un documento Word valido' }, { status: 400 });
            }
            const proyectoFolderId = await getOrCreateFolderOAuth(destFolderId, proyectoTitulo);
            const uploaded = await uploadFileToDriveOAuth(proyectoFolderId, filename, mime, fileBuffer);
            const fileUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;

            await db.prepare(`
                UPDATE asignaciones
                SET estado = 'Completado', drive_url = ?, completado_en = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(fileUrl, assignmentId);

            return NextResponse.json({ success: true, uploaded: 1, folder_url: fileUrl });
        }

        // Redrawer y Typer suben un zip con imagenes
        const zipBuffer = Buffer.from(await uploadFile.arrayBuffer());
        let entries;
        try {
            entries = unzipSync(new Uint8Array(zipBuffer));
        } catch {
            return NextResponse.json({ error: 'El archivo no es un zip valido' }, { status: 400 });
        }

        const imageEntries = Object.entries(entries).filter(([name, data]) => {
            const base = name.split('/').pop() || '';
            if (!base || base.startsWith('.') || base.startsWith('__MACOSX')) return false;
            if (!isAllowedFile(base, rol)) return false;
            return hasValidMagicBytes(data, base);
        });

        if (imageEntries.length === 0) {
            return NextResponse.json({ error: 'El zip no contiene imagenes validas' }, { status: 400 });
        }

        const proyectoFolderId = await getOrCreateFolderOAuth(destFolderId, proyectoTitulo);
        const capFolderId = await getOrCreateFolderOAuth(proyectoFolderId, capFolderName);

        const CONCURRENCY = 3;
        const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
        const sorted = imageEntries.sort(([a], [b]) => {
            const nameA = a.split('/').pop() || a;
            const nameB = b.split('/').pop() || b;
            return collator.compare(nameA, nameB);
        });

        let uploadedCount = 0;
        for (let i = 0; i < sorted.length; i += CONCURRENCY) {
            const chunk = sorted.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(async ([name, data]) => {
                const fname = name.split('/').pop() || name;
                const mime = getMimeType(fname, rol) || 'application/octet-stream';
                await uploadFileToDriveOAuth(capFolderId, fname, mime, data);
                uploadedCount++;
            }));
        }

        const folderUrl = `https://drive.google.com/drive/folders/${capFolderId}`;
        await db.prepare(`
            UPDATE asignaciones
            SET estado = 'Completado', drive_url = ?, completado_en = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(folderUrl, assignmentId);

        return NextResponse.json({ success: true, uploaded: uploadedCount, folder_url: folderUrl });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
