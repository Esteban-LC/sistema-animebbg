import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error || !code) {
        return NextResponse.redirect(
            new URL(`/configuracion?drive_oauth=error&reason=${error || 'no_code'}`, request.url)
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

        return NextResponse.redirect(new URL('/configuracion?drive_oauth=success', request.url));
    } catch (err) {
        return NextResponse.redirect(
            new URL(`/configuracion?drive_oauth=error&reason=${encodeURIComponent(err.message)}`, request.url)
        );
    }
}
