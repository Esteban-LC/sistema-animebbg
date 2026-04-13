import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { listDriveItemsByFolder } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

const IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/avif',
    'image/tiff',
]);

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

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const assignmentId = Number(searchParams.get('id'));
        const source = searchParams.get('source') === 'delivery' ? 'delivery' : 'raw';
        // variant ENG = raw_url (english), CORE = raw_eng_url (KO/JAP)
        const variant = searchParams.get('variant') === 'ENG' ? 'ENG' : 'CORE';

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
            SELECT a.usuario_id, a.proyecto_id, a.capitulo, a.rol, a.drive_url,
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

        if (source === 'delivery') {
            const deliveryUrl = String(asignacion.drive_url || '');
            if (!deliveryUrl) {
                return NextResponse.json({ images: [] });
            }

            const folderId = extractFolderId(deliveryUrl);
            if (!folderId) {
                return NextResponse.json({ images: [] });
            }

            const files = await listDriveItemsByFolder(folderId);
            const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
            const images = files
                .filter((file) => IMAGE_MIME_TYPES.has(String(file?.mimeType || '')))
                .map((file) => ({
                    id: String(file.id),
                    name: String(file.name),
                    mimeType: String(file.mimeType),
                    view_url: `https://drive.google.com/uc?export=view&id=${file.id}`,
                    thumb_url: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`,
                }))
                .sort((a, b) => collator.compare(a.name, b.name));

            return NextResponse.json({ images });
        }

        if (!asignacion.proyecto_id || asignacion.capitulo === null || asignacion.capitulo === undefined) {
            return NextResponse.json({ images: [] });
        }

        const proyecto = await db.prepare(`
            SELECT id, tipo, capitulos_catalogo, drive_folder_id
            FROM proyectos WHERE id = ?
        `).get(asignacion.proyecto_id);

        const entries = await getProjectCatalogEntries(db, proyecto || { id: asignacion.proyecto_id });
        const match = entries.find((item) => Number(item.numero) === Number(asignacion.capitulo));

        // raw_url = ENG variant, raw_eng_url = CORE (KO/JAP) variant
        const rawUrl = variant === 'ENG'
            ? String(match?.url || '')
            : String(match?.raw_eng_url || '');

        console.log(`[folder-images] asignacion=${assignmentId} capitulo=${asignacion.capitulo} variant=${variant}`);
        console.log(`[folder-images] match encontrado:`, match ? JSON.stringify(match) : 'null');
        console.log(`[folder-images] rawUrl resuelto: "${rawUrl}"`);

        if (!rawUrl) {
            console.log(`[folder-images] rawUrl vacio — retornando images:[]`);
            return NextResponse.json({ images: [], _debug: { reason: 'no_raw_url', capitulo: asignacion.capitulo, variant, match: match || null } });
        }

        const folderId = extractFolderId(rawUrl);
        console.log(`[folder-images] folderId extraido: "${folderId}" de rawUrl: "${rawUrl}"`);
        if (!folderId) {
            return NextResponse.json({ error: 'URL de carpeta invalida' }, { status: 400 });
        }

        // Usar la API oficial de Google Drive con Service Account
        const files = await listDriveItemsByFolder(folderId);
        console.log(`[folder-images] archivos en carpeta (${folderId}): ${files.length}`);
        if (files.length > 0) {
            const mimesSample = [...new Set(files.map(f => f.mimeType))].slice(0, 10);
            console.log(`[folder-images] mimeTypes en carpeta:`, mimesSample);
        }

        const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
        const images = files
            .filter((file) => IMAGE_MIME_TYPES.has(String(file?.mimeType || '')))
            .map((file) => ({
                id: String(file.id),
                name: String(file.name),
                mimeType: String(file.mimeType),
                view_url: `https://drive.google.com/uc?export=view&id=${file.id}`,
                thumb_url: `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`,
            }))
            .sort((a, b) => collator.compare(a.name, b.name));

        console.log(`[folder-images] imagenes filtradas: ${images.length}`);
        return NextResponse.json({ images });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
