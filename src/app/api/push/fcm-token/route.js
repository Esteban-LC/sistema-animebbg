import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { saveFcmToken, removeFcmToken } from '@/lib/fcm';

export const dynamic = 'force-dynamic';

async function getSessionUserId(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;
    const session = db.prepare(
        `SELECT usuario_id FROM sessions WHERE token = ? AND expires_at > datetime('now')`
    ).get(token);
    return session?.usuario_id ? Number(session.usuario_id) : null;
}

export async function POST(request) {
    try {
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const { token } = await request.json();
        if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 });

        await saveFcmToken(db, userId, token);
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

        const { token } = await request.json();
        if (!token) return NextResponse.json({ error: 'token requerido' }, { status: 400 });

        await removeFcmToken(db, userId, token);
        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error' }, { status: 500 });
    }
}
