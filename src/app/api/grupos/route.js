import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

async function ensureGroupVisibilityColumns(db) {
    const columns = await db.prepare('PRAGMA table_info(grupos)').all();
    const columnNames = new Set((Array.isArray(columns) ? columns : []).map((item) => String(item?.name || '')));

    if (!columnNames.has('mostrar_sugerencias')) {
        try {
            await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_sugerencias INTEGER DEFAULT 1').run();
        } catch { }
    }
    if (!columnNames.has('mostrar_ranking')) {
        try {
            await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_ranking INTEGER DEFAULT 1').run();
        } catch { }
    }
    if (!columnNames.has('mostrar_notificaciones')) {
        try {
            await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_notificaciones INTEGER DEFAULT 1').run();
        } catch { }
    }

    try { await db.prepare('UPDATE grupos SET mostrar_sugerencias = 1 WHERE mostrar_sugerencias IS NULL').run(); } catch { }
    try { await db.prepare('UPDATE grupos SET mostrar_ranking = 1 WHERE mostrar_ranking IS NULL').run(); } catch { }
    try { await db.prepare('UPDATE grupos SET mostrar_notificaciones = 1 WHERE mostrar_notificaciones IS NULL').run(); } catch { }
}

async function getSessionPermissions(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT u.roles, u.grupo_id
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
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo'),
        groupId: session.grupo_id ? Number(session.grupo_id) : null,
    };
}

export async function GET() {
    try {
        const db = getDb();
        await ensureGroupVisibilityColumns(db);
        const grupos = await db.prepare(`
            SELECT
                *,
                COALESCE(mostrar_sugerencias, 1) as mostrar_sugerencias,
                COALESCE(mostrar_ranking, 1) as mostrar_ranking,
                COALESCE(mostrar_notificaciones, 1) as mostrar_notificaciones
            FROM grupos
            ORDER BY nombre
        `).all();
        return NextResponse.json(grupos);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { nombre } = await request.json();
        const db = getDb();
        await ensureGroupVisibilityColumns(db);

        if (!nombre) {
            return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 });
        }

        const result = await db.prepare('INSERT INTO grupos (nombre) VALUES (?)').run(nombre);

        return NextResponse.json({ id: Number(result.lastInsertRowid), nombre });
    } catch (error) {
        // Check for unique constraint violation
        if (error.message.includes('UNIQUE constraint failed')) {
            return NextResponse.json({ error: 'El grupo ya existe' }, { status: 400 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request) {
    try {
        const db = getDb();
        await ensureGroupVisibilityColumns(db);
        const session = await getSessionPermissions(db);
        if (!session || (!session.isAdmin && !session.isLeader)) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const {
            id,
            mostrar_sugerencias,
            mostrar_ranking,
            mostrar_notificaciones,
        } = await request.json();

        if (!id) {
            return NextResponse.json({ error: 'ID de grupo requerido' }, { status: 400 });
        }

        if (session.isLeader && !session.isAdmin && Number(id) !== Number(session.groupId || 0)) {
            return NextResponse.json({ error: 'Solo puedes editar la visibilidad de tu grupo' }, { status: 403 });
        }

        const result = await db.prepare(`
            UPDATE grupos
            SET
                mostrar_sugerencias = COALESCE(?, mostrar_sugerencias),
                mostrar_ranking = COALESCE(?, mostrar_ranking),
                mostrar_notificaciones = COALESCE(?, mostrar_notificaciones)
            WHERE id = ?
        `).run(
            mostrar_sugerencias === undefined ? null : (mostrar_sugerencias ? 1 : 0),
            mostrar_ranking === undefined ? null : (mostrar_ranking ? 1 : 0),
            mostrar_notificaciones === undefined ? null : (mostrar_notificaciones ? 1 : 0),
            Number(id)
        );

        if (!result?.changes) {
            return NextResponse.json({ error: 'Grupo no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
