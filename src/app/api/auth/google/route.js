import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const db = getDb();
    const session = await db.prepare(`
        SELECT u.roles FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    let roles = [];
    try { roles = JSON.parse(session?.roles || '[]'); } catch { roles = []; }
    if (!roles.includes('Administrador')) {
        return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive',
        access_type: 'offline',
        prompt: 'consent',
    });

    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
