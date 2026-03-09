import { NextResponse } from 'next/server';

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
        const rawUrl = searchParams.get('url');
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
        return NextResponse.json({ folder_id: folderId, images });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
