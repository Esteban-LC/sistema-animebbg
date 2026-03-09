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

export async function PATCH(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        await ensureNotificationsTable(db);

        const result = await db.prepare(`
            UPDATE notificaciones
            SET leida = 1
            WHERE id = ? AND usuario_id = ?
        `).run(id, userId);

        if (!result?.changes) {
            return NextResponse.json({ error: 'Notificacion no encontrada' }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
    }
}

export async function DELETE(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const userId = await getSessionUserId(db);
        if (!userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        await ensureNotificationsTable(db);

        const existing = await db.prepare(`
            SELECT id, leida
            FROM notificaciones
            WHERE id = ? AND usuario_id = ?
        `).get(id, userId);

        if (!existing) {
            return NextResponse.json({ error: 'Notificacion no encontrada' }, { status: 404 });
        }

        await db.prepare(`
            DELETE FROM notificaciones
            WHERE id = ? AND usuario_id = ?
        `).run(id, userId);

        return NextResponse.json({ ok: true, deletedId: Number(id), wasUnread: Number(existing.leida || 0) === 0 });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
    }
}
