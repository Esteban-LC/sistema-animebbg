import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createNotification, notifyRoles } from '@/lib/notifications';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

async function getAuthContext(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.nombre
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
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
        userId: Number(session.usuario_id),
        name: session.nombre || 'Usuario',
        roles,
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo') && !roles.some((roleName) => PRODUCTION_ROLES.includes(roleName)),
    };
}

async function resolveAsignacionId(paramsSource) {
    const params = await paramsSource;
    const idNum = Number(params?.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return null;
    return idNum;
}

export async function GET(request, { params }) {
    try {
        const id = await resolveAsignacionId(params);
        if (!id) return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        const db = getDb();
        const auth = await getAuthContext(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const informes = await db.prepare('SELECT * FROM informes WHERE asignacion_id = ? ORDER BY creado_en DESC').all(id);
        return NextResponse.json(informes);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request, { params }) {
    try {
        const id = await resolveAsignacionId(params);
        if (!id) return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        const { mensaje } = await request.json();
        const db = getDb();
        const auth = await getAuthContext(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const stmt = db.prepare('INSERT INTO informes (asignacion_id, mensaje) VALUES (?, ?)');
        const result = await stmt.run(id, mensaje);
        const informeId = result.lastInsertRowid;

        const informe = await db.prepare('SELECT * FROM informes WHERE id = ?').get(informeId);

        const asignacion = await db.prepare(`
            SELECT a.id, a.usuario_id, a.rol, a.capitulo, p.titulo as proyecto_titulo, u.nombre as usuario_nombre
            FROM asignaciones a
            LEFT JOIN proyectos p ON p.id = a.proyecto_id
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            WHERE a.id = ?
        `).get(id);

        if (asignacion) {
            const targetUser = await db.prepare('SELECT grupo_id FROM usuarios WHERE id = ?').get(asignacion.usuario_id);
            await notifyRoles(
                db,
                ['Administrador', 'Lider de Grupo'],
                {
                    tipo: 'aviso',
                    titulo: 'Nuevo aviso',
                    mensaje: `${auth.name} envio un aviso en ${asignacion.proyecto_titulo || 'tarea'}${asignacion.capitulo ? ` (Cap. ${asignacion.capitulo})` : ''}`,
                    data: { asignacion_id: Number(id), informe_id: Number(informeId) },
                },
                { excludeUserIds: [auth.userId], groupId: targetUser?.grupo_id ?? null }
            );

            if (Number(asignacion.usuario_id) !== auth.userId) {
                await createNotification(db, {
                    usuarioId: Number(asignacion.usuario_id),
                    tipo: 'aviso',
                    titulo: 'Nuevo aviso en tu tarea',
                    mensaje: `${auth.name}: ${mensaje}`,
                    data: { asignacion_id: Number(id), informe_id: Number(informeId) },
                });
            }
        }

        return NextResponse.json(informe);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
