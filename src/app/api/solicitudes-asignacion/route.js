import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
const ACTIVE_ASSIGNMENT_STATES = ['Pendiente', 'En Proceso'];

async function getSession(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;
    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.grupo_id, COALESCE(u.rango, 2) AS rango, u.nombre
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);
    if (!session) return null;
    let roles = [];
    try { roles = JSON.parse(session.roles || '[]'); } catch { roles = []; }
    return { ...session, roles, isAdmin: roles.includes('Administrador'), isLeader: roles.includes('Lider de Grupo') };
}

async function countActiveAssignments(db, usuarioId) {
    if (!usuarioId) return 0;

    const row = await db.prepare(`
        SELECT COUNT(*) AS total
        FROM asignaciones
        WHERE usuario_id = ?
          AND estado IN (${ACTIVE_ASSIGNMENT_STATES.map(() => '?').join(', ')})
    `).get(usuarioId, ...ACTIVE_ASSIGNMENT_STATES);

    return Number(row?.total || 0);
}

// GET: Admin/Líder ve solicitudes pendientes de su grupo; staff Nuevo ve la suya propia
export async function GET() {
    try {
        const db = getDb();
        const session = await getSession(db);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        // Staff Nuevo: devolver solo si tiene solicitud pendiente propia
        if (!session.isAdmin && !session.isLeader) {
            const activeAssignments = await countActiveAssignments(db, session.usuario_id);
            const mine = await db.prepare(`
                SELECT id, rol, estado, creado_en FROM solicitudes_asignacion
                WHERE usuario_id = ? AND estado = 'Pendiente'
                LIMIT 1
            `).get(session.usuario_id);
            return NextResponse.json({
                pendiente: !!mine,
                solicitud: mine || null,
                active_assignment: activeAssignments > 0,
            });
        }

        // Admin/Líder: ver pendientes de su grupo (siempre filtrado por grupo)
        const solicitudes = await db.prepare(`
            SELECT sa.id, sa.rol, sa.estado, sa.creado_en,
                   u.id AS usuario_id, u.nombre AS usuario_nombre, u.roles AS usuario_roles,
                   COALESCE(u.grupo_id, 0) AS grupo_id
            FROM solicitudes_asignacion sa
            JOIN usuarios u ON u.id = sa.usuario_id
            WHERE sa.estado = 'Pendiente'
              AND u.grupo_id = ?
            ORDER BY sa.creado_en ASC
        `).all(session.grupo_id);

        return NextResponse.json(solicitudes);
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 });
    }
}

// POST: Staff Nuevo solicita una asignación
export async function POST(request) {
    try {
        const db = getDb();
        const session = await getSession(db);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        // Solo rango Nuevo puede usar esto (admin/leader tienen autoasignación directa)
        if (session.isAdmin || session.isLeader) {
            return NextResponse.json({ error: 'Usa autoasignacion directamente' }, { status: 400 });
        }
        if (Number(session.rango) >= 2) {
            return NextResponse.json({ error: 'Usa autoasignacion directamente' }, { status: 400 });
        }

        const { rol } = await request.json();
        if (!rol) return NextResponse.json({ error: 'Rol requerido' }, { status: 400 });

        // Verificar que el rol pedido sea uno de sus roles
        const userRoles = session.roles.map(r => r.toLowerCase());
        const rolLower = String(rol).toLowerCase();
        const staffRoles = ['traductor', 'traductor eng', 'traductor ko', 'traductor jap', 'traductor ko/jap', 'redrawer', 'typer'];
        // Para 'traductor' aceptar cualquier variante (Traductor ENG, KO, JAP, etc.)
        const userHasRole = rolLower === 'traductor'
            ? userRoles.some(r => r === 'traductor' || r.startsWith('traductor '))
            : userRoles.some(r => r === rolLower);
        if (!staffRoles.includes(rolLower) || !userHasRole) {
            return NextResponse.json({ error: 'Rol no valido para tu usuario' }, { status: 400 });
        }

        // No permitir solicitud duplicada pendiente
        const existing = await db.prepare(`
            SELECT id FROM solicitudes_asignacion
            WHERE usuario_id = ? AND estado = 'Pendiente'
        `).get(session.usuario_id);
        if (existing) {
            return NextResponse.json({ error: 'Ya tienes una solicitud pendiente. Espera a que sea atendida.' }, { status: 409 });
        }

        const activeAssignments = await countActiveAssignments(db, session.usuario_id);
        if (activeAssignments > 0) {
            return NextResponse.json({
                error: 'Ya tienes una asignacion activa. Completa o libera la actual antes de solicitar otra.'
            }, { status: 409 });
        }

        const result = await db.prepare(`
            INSERT INTO solicitudes_asignacion (usuario_id, rol) VALUES (?, ?)
        `).run(session.usuario_id, rol);

        // Notificar al admin/líder del mismo grupo
        try {
            const admins = await db.prepare(`
                SELECT id FROM usuarios
                WHERE COALESCE(activo, 1) = 1
                  AND grupo_id = ?
                  AND (
                      roles LIKE '%Administrador%' OR
                      roles LIKE '%Lider de Grupo%'
                  )
            `).all(session.grupo_id);

            for (const admin of admins) {
                await db.prepare(`
                    INSERT INTO notificaciones (usuario_id, tipo, mensaje, leida, creado_en)
                    VALUES (?, 'solicitud_asignacion', ?, 0, CURRENT_TIMESTAMP)
                `).run(admin.id, `${session.nombre} solicita asignacion como ${rol}`);
            }
        } catch { /* notificaciones opcionales */ }

        return NextResponse.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 });
    }
}

// PATCH: Marcar solicitud como atendida
export async function PATCH(request) {
    try {
        const db = getDb();
        const session = await getSession(db);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!session.isAdmin && !session.isLeader) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const { id } = await request.json();
        if (!id) return NextResponse.json({ error: 'ID requerido' }, { status: 400 });

        await db.prepare(`
            UPDATE solicitudes_asignacion
            SET estado = 'Atendida', atendido_por = ?, atendido_en = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(session.usuario_id, id);

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 });
    }
}
