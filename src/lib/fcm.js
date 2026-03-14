import { readFileSync } from 'fs';
import { join } from 'path';

let adminApp = null;

function getAdmin() {
    if (adminApp) return adminApp;

    try {
        const admin = require('firebase-admin');
        if (admin.apps.length > 0) {
            adminApp = admin;
            return adminApp;
        }

        // Load service account from file or env
        let credential;
        const envJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        if (envJson) {
            const serviceAccount = JSON.parse(envJson);
            credential = admin.credential.cert(serviceAccount);
        } else {
            const filePath = join(process.cwd(), 'firebase-service-account.json');
            const serviceAccount = JSON.parse(readFileSync(filePath, 'utf8'));
            credential = admin.credential.cert(serviceAccount);
        }

        admin.initializeApp({ credential });
        adminApp = admin;
        return adminApp;
    } catch (e) {
        return null;
    }
}

export function isFcmConfigured() {
    return getAdmin() !== null;
}

export async function ensureFcmTokensTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS fcm_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `).run();
    await db.prepare(`
        CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user
        ON fcm_tokens(usuario_id)
    `).run();
}

export async function saveFcmToken(db, userId, token) {
    await ensureFcmTokensTable(db);
    const existing = await db.prepare('SELECT id FROM fcm_tokens WHERE token = ?').get(token);
    if (existing) {
        await db.prepare('UPDATE fcm_tokens SET usuario_id = ?, updated_at = CURRENT_TIMESTAMP WHERE token = ?').run(Number(userId), token);
    } else {
        await db.prepare('INSERT INTO fcm_tokens (usuario_id, token) VALUES (?, ?)').run(Number(userId), token);
    }
}

export async function removeFcmToken(db, userId, token) {
    await ensureFcmTokensTable(db);
    await db.prepare('DELETE FROM fcm_tokens WHERE usuario_id = ? AND token = ?').run(Number(userId), token);
}

export async function getUserFcmTokens(db, userId) {
    await ensureFcmTokensTable(db);
    const rows = await db.prepare('SELECT token FROM fcm_tokens WHERE usuario_id = ?').all(Number(userId));
    return rows.map(r => r.token);
}

export async function sendFcmToUser(db, userId, payload) {
    const admin = getAdmin();
    if (!admin) return;

    const tokens = await getUserFcmTokens(db, userId);
    if (tokens.length === 0) return;

    const message = {
        notification: {
            title: String(payload?.title || 'Nueva notificación'),
            body: String(payload?.body || ''),
        },
        data: {
            url: String(payload?.url || '/notificaciones'),
            tag: String(payload?.tag || 'general'),
        },
        android: {
            notification: {
                icon: 'ic_launcher',
                color: '#FF2E4D',
                sound: 'default',
            },
        },
    };

    for (const token of tokens) {
        try {
            await admin.messaging().send({ ...message, token });
        } catch (error) {
            const code = error?.code || '';
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                await db.prepare('DELETE FROM fcm_tokens WHERE token = ?').run(token);
            }
        }
    }
}
