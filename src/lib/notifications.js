let ensured = false;
import { publishNotificationEvent } from '@/lib/realtime';
import { sendPushToUser } from '@/lib/push';
import { sendFcmToUser } from '@/lib/fcm';

export async function ensureNotificationsTable(db) {
    if (ensured) return;

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS notificaciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            tipo TEXT NOT NULL,
            titulo TEXT NOT NULL,
            mensaje TEXT NOT NULL,
            data_json TEXT,
            leida INTEGER DEFAULT 0,
            creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `).run();

    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_leida
        ON notificaciones(usuario_id, leida, creado_en)
    `).run();

    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_fecha
        ON notificaciones(usuario_id, creado_en DESC)
    `).run();

    ensured = true;
}

export async function createNotification(db, { usuarioId, tipo, titulo, mensaje, data = null }) {
    if (!usuarioId || !titulo || !mensaje) return;
    await ensureNotificationsTable(db);

    const result = await db.prepare(`
        INSERT INTO notificaciones (usuario_id, tipo, titulo, mensaje, data_json, leida)
        VALUES (?, ?, ?, ?, ?, 0)
    `).run(
        Number(usuarioId),
        tipo || 'general',
        titulo,
        mensaje,
        data ? JSON.stringify(data) : null
    );

    publishNotificationEvent({
        id: Number(result?.lastInsertRowid || 0),
        usuario_id: Number(usuarioId),
        tipo: tipo || 'general',
        titulo,
        mensaje,
        data_json: data ? JSON.stringify(data) : null,
    });

    try {
        const pushPayload = { title: titulo, body: mensaje, url: '/notificaciones', tag: tipo || 'general' };
        await Promise.allSettled([
            sendPushToUser(db, Number(usuarioId), pushPayload),
            sendFcmToUser(db, Number(usuarioId), pushPayload),
        ]);
    } catch {
        // keep in-app notification flow even if push fails
    }
}

export async function getUserIdsByRoles(db, roleNames = [], { groupId = null } = {}) {
    if (!Array.isArray(roleNames) || roleNames.length === 0) return [];
    const rows = await db.prepare(`
        SELECT id, roles, activo, grupo_id
        FROM usuarios
    `).all();

    return rows
        .filter((row) => Number(row.activo ?? 1) !== 0)
        .filter((row) => {
            if (groupId === null || groupId === undefined) return true;
            return Number(row.grupo_id) === Number(groupId);
        })
        .filter((row) => {
            try {
                const parsed = JSON.parse(row.roles || '[]');
                return Array.isArray(parsed) && parsed.some((r) => roleNames.includes(r));
            } catch {
                return false;
            }
        })
        .map((row) => Number(row.id));
}

export async function notifyRoles(db, roleNames, payload, { excludeUserIds = [], groupId = null } = {}) {
    const ids = await getUserIdsByRoles(db, roleNames, { groupId });
    const excluded = new Set((excludeUserIds || []).map((id) => Number(id)));

    for (const id of ids) {
        if (excluded.has(Number(id))) continue;
        await createNotification(db, { usuarioId: id, ...payload });
    }
}
