import { NextResponse } from 'next/server';
import { listDriveItemsByFolder } from '@/lib/google-drive';

export const dynamic = 'force-dynamic';

function extractFolderId(input) {
    if (!input) return '';
    const value = String(input).trim();
    if (!value) return '';
    if (/^[A-Za-z0-9_-]{20,}$/.test(value)) return value;
    try {
        const url = new URL(value);
        const fromPath = url.pathname.match(/\/drive\/folders\/([^/?#]+)/)?.[1];
        if (fromPath) return fromPath;
        const fromQuery = url.searchParams.get('id');
        return String(fromQuery || '').trim();
    } catch {
        const match = value.match(/([A-Za-z0-9_-]{20,})/);
        return String(match?.[1] || '');
    }
}

function isFontFile(file) {
    const mime = String(file?.mimeType || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.ttf') || name.endsWith('.otf') || name.endsWith('.woff') || name.endsWith('.woff2')) return true;
    return mime.startsWith('font/')
        || mime.includes('x-font')
        || mime.includes('font-sfnt');
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const rawUrl = searchParams.get('url');
        const folderId = extractFolderId(rawUrl);
        if (!folderId) {
            return NextResponse.json({ error: 'URL de carpeta invalida' }, { status: 400 });
        }

        const files = await listDriveItemsByFolder(folderId);
        const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
        const fonts = (Array.isArray(files) ? files : [])
            .filter(isFontFile)
            .map((file) => ({
                id: String(file.id || ''),
                name: String(file.name || ''),
                mimeType: String(file.mimeType || ''),
                view_url: `https://drive.google.com/file/d/${String(file.id || '')}/view`,
            }))
            .sort((a, b) => collator.compare(a.name, b.name));

        return NextResponse.json({ folder_id: folderId, fonts });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        );
    }
}

