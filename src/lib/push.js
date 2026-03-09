import webpush from 'web-push';

let vapidConfigured = false;

function getVapidConfig() {
    const publicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
    const privateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = String(process.env.VAPID_SUBJECT || 'mailto:admin@animebbg.local').trim();
    if (!publicKey || !privateKey) return null;
    return { publicKey, privateKey, subject };
}

function ensureVapidConfigured() {
    if (vapidConfigured) return true;
    const config = getVapidConfig();
    if (!config) return false;
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidConfigured = true;
    return true;
}

export async function ensurePushSubscriptionsTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            active INTEGER DEFAULT 1,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `).run();
    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
        ON push_subscriptions(usuario_id, active, updated_at)
    `).run();
}

function normalizeSubscription(input) {
    const endpoint = String(input?.endpoint || '').trim();
    const p256dh = String(input?.keys?.p256dh || '').trim();
    const auth = String(input?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) return null;
    return { endpoint, p256dh, auth };
}

export async function savePushSubscription(db, userId, subscription, userAgent = '') {
    const normalized = normalizeSubscription(subscription);
    if (!normalized) throw new Error('Suscripcion push invalida');

    await ensurePushSubscriptionsTable(db);
    const existing = await db.prepare(`
        SELECT id
        FROM push_subscriptions
        WHERE endpoint = ?
        LIMIT 1
    `).get(normalized.endpoint);

    if (existing?.id) {
        await db.prepare(`
            UPDATE push_subscriptions
            SET usuario_id = ?, p256dh = ?, auth = ?, user_agent = ?, active = 1, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            Number(userId),
            normalized.p256dh,
            normalized.auth,
            userAgent || null,
            Number(existing.id)
        );
    } else {
        await db.prepare(`
            INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth, user_agent, active)
            VALUES (?, ?, ?, ?, ?, 1)
        `).run(
            Number(userId),
            normalized.endpoint,
            normalized.p256dh,
            normalized.auth,
            userAgent || null
        );
    }

    return normalized.endpoint;
}

export async function removePushSubscription(db, userId, endpoint) {
    await ensurePushSubscriptionsTable(db);
    await db.prepare(`
        DELETE FROM push_subscriptions
        WHERE usuario_id = ? AND endpoint = ?
    `).run(Number(userId), String(endpoint || '').trim());
}

export async function getUserPushSubscriptions(db, userId) {
    await ensurePushSubscriptionsTable(db);
    const rows = await db.prepare(`
        SELECT endpoint, p256dh, auth
        FROM push_subscriptions
        WHERE usuario_id = ? AND active = 1
    `).all(Number(userId));

    return (Array.isArray(rows) ? rows : []).map((row) => ({
        endpoint: String(row.endpoint || ''),
        keys: {
            p256dh: String(row.p256dh || ''),
            auth: String(row.auth || ''),
        },
    }));
}

export async function hasPushSubscription(db, userId) {
    await ensurePushSubscriptionsTable(db);
    const row = await db.prepare(`
        SELECT id
        FROM push_subscriptions
        WHERE usuario_id = ? AND active = 1
        LIMIT 1
    `).get(Number(userId));
    return Boolean(row?.id);
}

export function getPublicVapidKey() {
    const config = getVapidConfig();
    return config?.publicKey || '';
}

export function isPushConfigured() {
    return Boolean(getVapidConfig());
}

export async function sendPushToUser(db, userId, payload) {
    if (!ensureVapidConfigured()) return;
    const subscriptions = await getUserPushSubscriptions(db, userId);
    if (subscriptions.length === 0) return;

    const body = JSON.stringify({
        title: String(payload?.title || 'Nueva notificacion'),
        body: String(payload?.body || ''),
        url: String(payload?.url || '/notificaciones'),
        icon: String(payload?.icon || '/icon-192x192.png'),
        badge: String(payload?.badge || '/icon-192x192.png'),
        tag: String(payload?.tag || `notification-${Date.now()}`),
    });

    for (const subscription of subscriptions) {
        try {
            await webpush.sendNotification(subscription, body);
        } catch (error) {
            const statusCode = Number(error?.statusCode || 0);
            if (statusCode === 404 || statusCode === 410) {
                await removePushSubscription(db, userId, subscription.endpoint);
            }
        }
    }
}
