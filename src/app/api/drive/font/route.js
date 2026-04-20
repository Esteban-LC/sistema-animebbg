import { NextResponse } from 'next/server';
import { downloadDriveFileById, getDriveItemById } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

function isValidDriveId(id) {
    return /^[A-Za-z0-9_-]{20,}$/.test(String(id || ''));
}

function inferFontContentType(name, fallback) {
    const low = String(name || '').toLowerCase();
    if (low.endsWith('.ttf')) return 'font/ttf';
    if (low.endsWith('.otf')) return 'font/otf';
    if (low.endsWith('.woff2')) return 'font/woff2';
    if (low.endsWith('.woff')) return 'font/woff';
    return fallback || 'application/octet-stream';
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!isValidDriveId(id)) {
            return NextResponse.json({ error: 'ID invalido' }, { status: 400 });
        }

        const [meta, content] = await Promise.all([
            getDriveItemById(id),
            downloadDriveFileById(id),
        ]);

        if (!content) {
            return NextResponse.json({ error: 'No se pudo obtener la fuente de Drive' }, { status: 404 });
        }

        const { searchParams: sp } = new URL(request.url);
        const forDownload = sp.get('download') === '1';
        const fileName = String(meta?.name || 'font').replace(/[^\w.\-]/g, '_');

        return new NextResponse(content.buffer, {
            status: 200,
            headers: {
                'Content-Type': inferFontContentType(meta?.name, content.contentType),
                'Cache-Control': 'private, max-age=300',
                ...(forDownload ? { 'Content-Disposition': `attachment; filename="${fileName}"` } : {}),
            },
        });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}

