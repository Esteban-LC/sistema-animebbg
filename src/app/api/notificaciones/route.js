import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ensurePerformanceIndexes, getDb } from '@/lib/db';
import { ensureNotificationsTable } from '@/lib/notifications';

async function getSessionUser(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.grupo_id
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
        roles,
        groupId: session.grupo_id ?? null,
    };
}

function extractAsignacionId(item) {
    if (!item?.data_json) return null;
    try {
        const data = JSON.parse(item.data_json);
        if (!data || data.asignacion_id === undefined || data.asignacion_id === null) return null;
        const id = Number(data.asignacion_id);
        return Number.isFinite(id) ? id : null;
    } catch {
        return null;
    }
}

async function getAssignmentGroupMap(db, asignacionIds) {
    if (!Array.isArray(asignacionIds) || asignacionIds.length === 0) return new Map();

    const placeholders = asignacionIds.map(() => '?').join(', ');
    const rows = await db.prepare(`
        SELECT a.id as asignacion_id, u.grupo_id
        FROM asignaciones a
        LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.id IN (${placeholders})
    `).all(...asignacionIds);

    const map = new Map();
    (rows || []).forEach((row) => {
        map.set(Number(row.asignacion_id), row.grupo_id ?? null);
    });
    return map;
}

export async function GET(request) {
    try {
        const db = getDb();
        await ensurePerformanceIndexes(db);
        const sessionUser = await getSessionUser(db);
        if (!sessionUser) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }
        const { userId, groupId } = sessionUser;

        await ensureNotificationsTable(db);

        const { searchParams } = new URL(request.url);
        const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200);
        const summaryOnly = searchParams.get('summary') === '1';

        if (summaryOnly) {
            const unreadRow = await db.prepare(`
                SELECT COUNT(*) as total
                FROM notificaciones
                WHERE usuario_id = ? AND leida = 0
            `).get(userId);

            return NextResponse.json({
                items: [],
                unread: Number(unreadRow?.total || 0),
            });
        }

        const fetchLimit = Math.min(Math.max(limit * 3, limit), 400);

        const rawItems = await db.prepare(`
            SELECT id, usuario_id, tipo, titulo, mensaje, data_json, leida, creado_en
            FROM notificaciones
            WHERE usuario_id = ?
            ORDER BY creado_en DESC, id DESC
            LIMIT ?
        `).all(userId, fetchLimit);

        const asignacionIds = [...new Set(
            (rawItems || [])
                .map((item) => extractAsignacionId(item))
                .filter((id) => id !== null)
        )];
        const assignmentGroupMap = await getAssignmentGroupMap(db, asignacionIds);

        const items = [];
        const removeIds = [];

        for (const item of rawItems || []) {
            const asignacionId = extractAsignacionId(item);
            if (asignacionId === null) {
                items.push(item);
                continue;
            }

            const assignmentGroupId = assignmentGroupMap.get(Number(asignacionId));
            const sameGroup = groupId === null || groupId === undefined
                ? true
                : Number(assignmentGroupId) === Number(groupId);
            if (sameGroup) {
                items.push(item);
            } else {
                removeIds.push(Number(item.id));
            }
        }

        if (removeIds.length > 0) {
            const placeholders = removeIds.map(() => '?').join(', ');
            await db.prepare(`
                DELETE FROM notificaciones
                WHERE usuario_id = ?
                  AND id IN (${placeholders})
            `).run(userId, ...removeIds);
        }

        const visibleItems = items.slice(0, limit);

        const unreadRow = await db.prepare(`
            SELECT COUNT(*) as total
            FROM notificaciones
            WHERE usuario_id = ? AND leida = 0
        `).get(userId);

        return NextResponse.json({
            items: Array.isArray(visibleItems) ? visibleItems : [],
            unread: Number(unreadRow?.total || 0),
        });
    } catch (error) {
        return NextResponse.json({ error: error.message || 'Error' }, { status: 500 });
    }
}
