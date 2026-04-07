import { getDb } from '@/lib/db';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

let oauthTokenCache = {
    accessToken: null,
    expiresAtMs: 0,
};

async function getRefreshToken() {
    const db = getDb();
    const row = await db.prepare(`SELECT value FROM app_settings WHERE key = 'google_oauth_refresh_token'`).get();
    if (!row?.value) throw new Error('Drive no conectado. Ve a Administración y conecta tu cuenta de Google.');
    return row.value;
}

export async function getOAuthAccessToken() {
    const now = Date.now();
    if (oauthTokenCache.accessToken && oauthTokenCache.expiresAtMs > now + 30_000) {
        return oauthTokenCache.accessToken;
    }

    const refreshToken = await getRefreshToken();
    const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
            client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        }).toString(),
        cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
        throw new Error(`Error al renovar token de Google: ${data.error_description || data.error || res.status}`);
    }

    const ttl = Number(data.expires_in || 3600);
    oauthTokenCache = {
        accessToken: String(data.access_token),
        expiresAtMs: now + ttl * 1000,
    };

    return oauthTokenCache.accessToken;
}

export async function isOAuthConnected() {
    try {
        const db = getDb();
        const row = await db.prepare(`SELECT value FROM app_settings WHERE key = 'google_oauth_refresh_token'`).get();
        return !!row?.value;
    } catch {
        return false;
    }
}

export async function findFolderInParentOAuth(parentId, name) {
    const token = await getOAuthAccessToken();
    const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `'${parentId}' in parents and name = '${escaped}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`;
    const params = new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '1' });
    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return data?.files?.[0]?.id || null;
}

export async function createFolderInParentOAuth(parentId, name) {
    const token = await getOAuthAccessToken();
    const res = await fetch(GOOGLE_DRIVE_FILES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: DRIVE_FOLDER_MIME, parents: [parentId] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) {
        throw new Error(`No se pudo crear la carpeta "${name}": ${data?.error?.message || res.status}`);
    }
    return data.id;
}

export async function getOrCreateFolderOAuth(parentId, name) {
    const existing = await findFolderInParentOAuth(parentId, name);
    if (existing) return existing;
    return createFolderInParentOAuth(parentId, name);
}

export async function downloadFileFromDrive(fileId) {
    const token = await getOAuthAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        throw new Error(`No se pudo descargar el archivo de Drive: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

export async function uploadFileToDriveOAuth(folderId, filename, mimeType, data) {
    const token = await getOAuthAccessToken();
    const metadata = JSON.stringify({ name: filename, parents: [folderId] });
    const boundary = '-------animebbg_boundary';

    const metaBytes = Buffer.from(`\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}`, 'utf-8');
    const dataPartBytes = Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf-8');
    const closeBytes = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
    const fileBytes = Buffer.isBuffer(data) ? data : Buffer.from(data);

    const body = Buffer.concat([metaBytes, dataPartBytes, fileBytes, closeBytes]);

    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,name`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary="${boundary}"`,
            'Content-Length': String(body.byteLength),
        },
        body,
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result?.id) {
        throw new Error(`No se pudo subir "${filename}": ${result?.error?.message || res.status}`);
    }
    return result;
}
