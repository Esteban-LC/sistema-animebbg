import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { createNotification } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

async function getSessionUser(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const user = await db.prepare(`
        SELECT s.usuario_id, u.nombre
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!user?.usuario_id) return null;
    return {
        id: Number(user.usuario_id),
        nombre: String(user.nombre || 'Usuario'),
    };
}

export async function POST() {
    try {
        const db = getDb();
        const user = await getSessionUser(db);
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        await createNotification(db, {
            usuarioId: user.id,
            tipo: 'push_test',
            titulo: 'Prueba de notificacion',
            mensaje: `Hola ${user.nombre}, las notificaciones del sistema estan activas.`,
            data: { source: 'push_test' },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error' }, { status: 500 });
    }
}
