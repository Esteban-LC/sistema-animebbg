import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function isValidDriveId(id) {
    return /^[A-Za-z0-9_-]{20,}$/.test(String(id || ''));
}

async function tryFetch(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
        cache: 'no-store',
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;
    return response;
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!isValidDriveId(id)) {
            return NextResponse.json({ error: 'ID invalido' }, { status: 400 });
        }

        const candidates = [
            `https://drive.google.com/uc?export=view&id=${id}`,
            `https://drive.google.com/thumbnail?id=${id}&sz=w3000`,
        ];

        let imageResponse = null;
        for (const candidate of candidates) {
            imageResponse = await tryFetch(candidate);
            if (imageResponse) break;
        }

        if (!imageResponse) {
            return NextResponse.json({ error: 'No se pudo obtener la imagen de Drive' }, { status: 404 });
        }

        const buffer = await imageResponse.arrayBuffer();
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': imageResponse.headers.get('content-type') || 'image/jpeg',
                'Cache-Control': 'private, max-age=60',
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}
