import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function normalizeRoles(rawRoles) {
    const list = Array.isArray(rawRoles) ? rawRoles : [];
    return list.map((role) => role === 'Traductor KO/JAP' ? 'Traductor KO' : role);
}

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const db = getDb();

        // Find session
        const session = await db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
        // Fix: Add await b/c DB wrapper is async
        const user = await db.prepare(`
            SELECT u.*, g.nombre as grupo_nombre
            FROM sessions s
            JOIN usuarios u ON s.usuario_id = u.id
            LEFT JOIN grupos g ON u.grupo_id = g.id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);

        if (!user) {
            return NextResponse.json({ error: 'Sesión inválida o expirada' }, { status: 401 });
        }

        const roles = normalizeRoles(user.roles ? JSON.parse(user.roles) : []);

        const userData = {
            id: user.id,
            nombre: user.nombre,
            discord_username: user.discord_username,
            avatar_url: user.avatar_url,
            grupo_nombre: user.grupo_nombre,
            grupo_id: user.grupo_id,
            roles,
            isAdmin: roles.includes('Administrador'),
            role: roles[0] || 'Staff'
        };

        return NextResponse.json(userData);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
