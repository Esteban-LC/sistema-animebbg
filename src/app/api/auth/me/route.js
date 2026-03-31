import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

function normalizeRoles(rawRoles) {
    const list = Array.isArray(rawRoles) ? rawRoles : [];
    return list.map((role) => role === 'Traductor KO/JAP' ? 'Traductor KO' : role);
}

async function ensureGroupVisibilityColumns(db) {
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_sugerencias INTEGER DEFAULT 1').run(); } catch { }
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_ranking INTEGER DEFAULT 1').run(); } catch { }
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_notificaciones INTEGER DEFAULT 1').run(); } catch { }
}

function getPrimaryRole(roles) {
    if (roles.includes('Administrador')) return 'Administrador';
    if (roles.includes('Lider de Grupo')) return 'Lider de Grupo';
    return roles[0] || 'Staff';
}

export async function GET() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const db = getDb();
        await ensureGroupVisibilityColumns(db);

        // Find session
        const session = await db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
        // Fix: Add await b/c DB wrapper is async
        const user = await db.prepare(`
            SELECT
                u.*,
                g.nombre as grupo_nombre,
                COALESCE(g.mostrar_sugerencias, 1) as mostrar_sugerencias,
                COALESCE(g.mostrar_ranking, 1) as mostrar_ranking,
                COALESCE(g.mostrar_notificaciones, 1) as mostrar_notificaciones
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
            groupSettings: {
                showSuggestions: Number(user.mostrar_sugerencias ?? 1) === 1,
                showRanking: Number(user.mostrar_ranking ?? 1) === 1,
                showNotifications: Number(user.mostrar_notificaciones ?? 1) === 1,
            },
            roles,
            isAdmin: roles.includes('Administrador'),
            role: getPrimaryRole(roles)
        };

        return NextResponse.json(userData);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
