import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { getProjectCatalogEntries } from '@/lib/project-catalog';

export const dynamic = 'force-dynamic';

function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
}

async function getAuth(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.grupo_id
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

    const isAdmin = roles.includes('Administrador');
    const isLeader = roles.includes('Lider de Grupo');
    return {
        userId: Number(session.usuario_id),
        isAdmin,
        isLeader,
        groupId: session.grupo_id ? Number(session.grupo_id) : null,
    };
}

export async function POST() {
    try {
        const db = getDb();
        const auth = await getAuth(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!auth.isAdmin && !auth.isLeader) {
            return NextResponse.json({ error: 'Solo administradores o lideres pueden sincronizar' }, { status: 403 });
        }

        let proyectos = [];
        if (auth.isAdmin) {
            proyectos = await db.prepare(`
                SELECT id, titulo, estado
                FROM proyectos
                ORDER BY id ASC
            `).all();
        } else if (auth.groupId) {
            proyectos = await db.prepare(`
                SELECT id, titulo, estado
                FROM proyectos
                WHERE grupo_id = ?
                ORDER BY id ASC
            `).all(auth.groupId);
        }

        const skipped = [];
        const success = [];
        const failed = [];

        for (const proyecto of Array.isArray(proyectos) ? proyectos : []) {
            const estado = normalizeStatus(proyecto?.estado);
            if (estado === 'cancelado') {
                skipped.push({
                    proyecto_id: Number(proyecto?.id || 0),
                    titulo: String(proyecto?.titulo || ''),
                    motivo: 'cancelado',
                });
                continue;
            }

            try {
                const catalog = await getProjectCatalogEntries(db, proyecto);
                success.push({
                    proyecto_id: Number(proyecto?.id || 0),
                    titulo: String(proyecto?.titulo || ''),
                    capitulos_detectados: Array.isArray(catalog) ? catalog.length : 0,
                });
            } catch (error) {
                failed.push({
                    proyecto_id: Number(proyecto?.id || 0),
                    titulo: String(proyecto?.titulo || ''),
                    error: error instanceof Error ? error.message : 'Error sincronizando',
                });
            }
        }

        return NextResponse.json({
            ok: true,
            summary: {
                total: Array.isArray(proyectos) ? proyectos.length : 0,
                sincronizados: success.length,
                omitidos: skipped.length,
                errores: failed.length,
            },
            sincronizados: success,
            omitidos: skipped,
            errores: failed,
        });
    } catch (error) {
        return NextResponse.json({ error: error?.message || 'Error en sincronizacion global' }, { status: 500 });
    }
}

