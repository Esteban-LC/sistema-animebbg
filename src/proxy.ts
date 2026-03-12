import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/api/auth/login', '/api/auth/logout'];
const CANONICAL_HOST = 'www.sistema-gestorbbg.linkpc.net';
const LEGACY_HOSTS = new Set(['sistema-gestorbbg.linkpc.net']);

export function proxy(request: NextRequest) {
    const token = request.cookies.get('auth_token')?.value;
    const { pathname } = request.nextUrl;
    const hostname = request.nextUrl.hostname;

    // Keep the verified TWA origin stable in production to reduce browser fallback UI.
    if (LEGACY_HOSTS.has(hostname)) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.hostname = CANONICAL_HOST;
        redirectUrl.protocol = 'https:';
        return NextResponse.redirect(redirectUrl, 308);
    }

    // Permite recursos estaticos y archivos servidos directamente.
    if (pathname.startsWith('/_next') || pathname.startsWith('/static') || pathname.includes('.')) {
        return NextResponse.next();
    }

    if (pathname === '/login' && token) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    if (PUBLIC_ROUTES.includes(pathname)) {
        return NextResponse.next();
    }

    if (!token) {
        if (pathname.startsWith('/api/')) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        return NextResponse.redirect(new URL('/login', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
    ],
};
