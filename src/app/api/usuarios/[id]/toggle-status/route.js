import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const { activo } = await request.json();
        const db = getDb();
        const token = (await cookies()).get('auth_token')?.value;
        if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);
        if (!session) return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });

        let requesterRoles = [];
        try {
            requesterRoles = JSON.parse(session.roles || '[]');
        } catch {
            requesterRoles = [];
        }

        const isAdmin = requesterRoles.includes('Administrador');
        if (!isAdmin) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const targetUser = await db.prepare('SELECT grupo_id FROM usuarios WHERE id = ?').get(id);
        if (!targetUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

        const result = await db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo, id);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Estado actualizado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
