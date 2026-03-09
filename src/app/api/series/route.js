import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

async function getSessionContext(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT u.roles, u.grupo_id
        FROM sessions s
        JOIN usuarios u ON s.usuario_id = u.id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session) return null;

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch {
        roles = [];
    }

    return {
        roles,
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo') && !roles.some((roleName) => PRODUCTION_ROLES.includes(roleName)),
        groupId: session.grupo_id || null,
    };
}

export async function GET() {
    try {
        const db = getDb();
        const ctx = await getSessionContext(db);
        if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        let query = `
            SELECT
                p.id,
                p.titulo,
                p.tipo,
                p.genero,
                COALESCE(ac.capitulo_completado, 0) AS capitulos_actuales,
                p.capitulos_totales,
                p.estado,
                p.ultima_actualizacion,
                p.imagen_url,
                p.frecuencia,
                p.grupo_id
            FROM proyectos p
            LEFT JOIN (
                SELECT proyecto_id, MAX(capitulo) AS capitulo_completado
                FROM asignaciones
                WHERE estado = 'Completado'
                GROUP BY proyecto_id
            ) ac ON ac.proyecto_id = p.id
        `;
        const params = [];

        const restrictToOwnGroup = !ctx.isAdmin || ctx.isLeader;
        if (restrictToOwnGroup && ctx.groupId) {
            query += ` WHERE p.grupo_id = ? AND LOWER(TRIM(COALESCE(p.estado, 'Activo'))) != 'cancelado'`;
            params.push(ctx.groupId);
        } else if (restrictToOwnGroup) {
            return NextResponse.json([]);
        } else {
            query += ` WHERE LOWER(TRIM(COALESCE(p.estado, 'Activo'))) != 'cancelado'`;
        }

        query += ` ORDER BY p.ultima_actualizacion DESC`;
        const rows = await db.prepare(query).all(...params);
        return NextResponse.json(rows);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
