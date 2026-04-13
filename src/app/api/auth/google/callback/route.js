import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');
    const cookieStore = await cookies();
    const expectedState = cookieStore.get('google_oauth_state')?.value;

    // Usar el dominio del REDIRECT_URI configurado para evitar problemas con proxy inverso (nginx)
    const getBaseUrl = () => {
        const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
        if (redirectUri) {
            try {
                const url = new URL(redirectUri);
                return `${url.protocol}//${url.host}`;
            } catch { /* fallback */ }
        }
        return new URL(request.url).origin;
    };

    const baseUrl = getBaseUrl();
    cookieStore.delete('google_oauth_state');

    if (error || !code) {
        return NextResponse.redirect(
            `${baseUrl}/configuracion?drive_oauth=error&reason=${error || 'no_code'}`
        );
    }

    if (!state || !expectedState || state !== expectedState) {
        return NextResponse.redirect(
            `${baseUrl}/configuracion?drive_oauth=error&reason=invalid_state`
        );
    }

    try {
        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }).toString(),
        });

        const data = await res.json();
        if (!res.ok || !data.refresh_token) {
            throw new Error(data.error_description || 'No se obtuvo refresh_token');
        }

        const db = getDb();
        await db.prepare(`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ('google_oauth_refresh_token', ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(data.refresh_token);

        return NextResponse.redirect(`${baseUrl}/configuracion?drive_oauth=success`);
    } catch (err) {
        return NextResponse.redirect(
            `${baseUrl}/configuracion?drive_oauth=error&reason=${encodeURIComponent(err.message)}`
        );
    }
}
