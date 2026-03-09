import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { ensureNotificationsTable } from '@/lib/notifications';

async function getSessionUserId(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT usuario_id
        FROM sessions
        WHERE token = ? AND expires_at > datetime('now')
    `).get(token);

    return session ? Number(session.usuario_id) : null;
}

export async function PATCH() {
    try {
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        await ensureNotificationsTable(db);

        await db.prepare(`
            UPDATE notificaciones
            SET leida = 1
            WHERE usuario_id = ? AND leida = 0
        `).run(userId);

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
    }
}

