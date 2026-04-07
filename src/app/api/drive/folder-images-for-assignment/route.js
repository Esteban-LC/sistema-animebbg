import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';
import { getProjectCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';

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
        if (!id || !name) continue;
        if (!mimeType.startsWith('image/')) continue;
        filesMap.set(id, {
            id,
            name,
            mimeType,
            view_url: `https://drive.google.com/uc?export=view&id=${id}`,
            thumb_url: `https://drive.google.com/thumbnail?id=${id}&sz=w1200`,
        });
    }

    const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
    return [...filesMap.values()].sort((a, b) => collator.compare(a.name, b.name));
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const assignmentId = Number(searchParams.get('id'));
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
            SELECT a.usuario_id, a.proyecto_id, a.capitulo, a.rol,
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

        if (!rawUrl) {
            return NextResponse.json({ images: [] });
        }

        const folderId = extractFolderId(rawUrl);
        if (!folderId) {
            return NextResponse.json({ error: 'URL de carpeta invalida' }, { status: 400 });
        }

        const driveFolderUrl = `https://drive.google.com/drive/folders/${folderId}?usp=sharing`;
        const response = await fetch(driveFolderUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            },
            cache: 'no-store',
        });

        if (!response.ok) {
            return NextResponse.json({ error: 'No se pudo leer la carpeta de Drive' }, { status: 400 });
        }

        const html = await response.text();
        const images = parseImageFiles(html);
        return NextResponse.json({ images });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
