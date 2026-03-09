import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { hasPushSubscription, removePushSubscription, savePushSubscription } from '@/lib/push';

export const dynamic = 'force-dynamic';

async function getSessionUserId(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT usuario_id
        FROM sessions
        WHERE token = ? AND expires_at > datetime('now')
    `).get(token);

    return session?.usuario_id ? Number(session.usuario_id) : null;
}

export async function GET() {
    try {
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const enabled = await hasPushSubscription(db, userId);
        return NextResponse.json({ enabled });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error' }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const body = await request.json();
        await savePushSubscription(
            db,
            userId,
            body?.subscription,
            request.headers.get('user-agent') || ''
        );
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error' }, { status: 500 });
    }
}

export async function DELETE(request) {
    try {
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const body = await request.json().catch(() => ({}));
        const endpoint = String(body?.endpoint || '').trim();
        if (!endpoint) return NextResponse.json({ error: 'endpoint requerido' }, { status: 400 });

        await removePushSubscription(db, userId, endpoint);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error' }, { status: 500 });
    }
}
