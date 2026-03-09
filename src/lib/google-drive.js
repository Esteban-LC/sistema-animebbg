import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';

let tokenCache = {
    accessToken: null,
    expiresAtMs: 0,
};

function toBase64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function getEnvConfig() {
    const envEmail = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const envPrivateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '';
    const envPrivateKey = envPrivateKeyRaw.replace(/\\n/g, '\n').trim();

    if (envEmail && envPrivateKey) {
        return { clientEmail: envEmail, privateKey: envPrivateKey };
    }

    const configuredPath = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH || '').trim();
    const fallbackPath = path.join(process.cwd(), 'gestorbbg-10a37b1cc6ad.json');
    const keyPath = configuredPath || fallbackPath;
    if (!fs.existsSync(keyPath)) {
        throw new Error('Faltan credenciales de Google: define GOOGLE_SERVICE_ACCOUNT_EMAIL/PRIVATE_KEY o GOOGLE_SERVICE_ACCOUNT_JSON_PATH');
    }

    const raw = fs.readFileSync(keyPath, 'utf-8');
    const json = JSON.parse(raw);
    const clientEmail = String(json?.client_email || '').trim();
    const privateKey = String(json?.private_key || '').replace(/\\n/g, '\n').trim();
    if (!clientEmail || !privateKey) {
        throw new Error('JSON de Service Account invalido: faltan client_email/private_key');
    }
    return { clientEmail, privateKey };
}

function createServiceAccountJwt({ clientEmail, privateKey }) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iss: clientEmail,
        scope: DRIVE_SCOPE,
        aud: GOOGLE_OAUTH_TOKEN_URL,
        iat: nowSec,
        exp: nowSec + 3600,
    };

    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
        .createSign('RSA-SHA256')
        .update(signingInput)
        .sign(privateKey)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    return `${signingInput}.${signature}`;
}

async function fetchAccessToken() {
    const now = Date.now();
    if (tokenCache.accessToken && tokenCache.expiresAtMs > now + 30_000) {
        return tokenCache.accessToken;
    }

    const jwt = createServiceAccountJwt(getEnvConfig());
    const body = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
    });

    const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
        const details = data?.error_description || data?.error || 'No se pudo obtener token de Google';
        throw new Error(`Google OAuth error: ${details}`);
    }

    const ttl = Number(data.expires_in || 3600);
    tokenCache = {
        accessToken: String(data.access_token),
        expiresAtMs: now + (ttl * 1000),
    };

    return tokenCache.accessToken;
}

function buildItemUrl(file) {
    const mimeType = String(file?.mimeType || '');
    const id = String(file?.id || '');
    if (!id) return '';

    if (mimeType === 'application/vnd.google-apps.folder') {
        return `https://drive.google.com/drive/folders/${id}`;
    }
    if (mimeType === 'application/vnd.google-apps.document') {
        return `https://docs.google.com/document/d/${id}/edit`;
    }
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        return `https://docs.google.com/spreadsheets/d/${id}/edit`;
    }
    if (mimeType === 'application/vnd.google-apps.presentation') {
        return `https://docs.google.com/presentation/d/${id}/edit`;
    }
    return String(file?.webViewLink || `https://drive.google.com/file/d/${id}/view`);
}

function normalizeKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function scoreProjectFolderMatch(folderName, projectTitle) {
    const folderKey = normalizeKey(folderName);
    const projectKey = normalizeKey(projectTitle);
    if (!folderKey || !projectKey) return 0;
    if (folderKey === projectKey) return 1000;
    if (folderKey.includes(projectKey)) return 800;
    if (projectKey.includes(folderKey)) return 700;

    const folderTokens = new Set(folderKey.split(' ').filter(Boolean));
    const projectTokens = new Set(projectKey.split(' ').filter(Boolean));
    let overlap = 0;
    for (const token of folderTokens) {
        if (projectTokens.has(token)) overlap += 1;
    }
    return overlap * 20;
}

function pickBestProjectFolder(folders, projectTitle) {
    const list = Array.isArray(folders) ? folders : [];
    if (list.length === 0) return null;
    if (list.length === 1) return list[0];
    if (!projectTitle) return null;

    let best = null;
    let bestScore = -1;
    for (const folder of list) {
        const score = scoreProjectFolderMatch(folder?.name, projectTitle);
        if (score > bestScore) {
            best = folder;
            bestScore = score;
        }
    }
    if (bestScore <= 0) return null;
    return best;
}

export function pickBestProjectFolderPublic(folders, projectTitle) {
    return pickBestProjectFolder(folders, projectTitle);
}

function detectRoleFolder(name) {
    const key = normalizeKey(name);
    if (!key) return null;

    if ((key.includes('ingles') || key.includes('english') || /\beng\b/.test(key)) && !key.includes('trad')) return 'raw_eng';
    if (key.includes('raw')) return 'raw';
    if (key.includes('traduccion') || key.includes('trad') || key.includes('translator')) return 'traductor';
    if (key.includes('redraw') || key.includes('redibujo')) return 'redraw';
    if (key.includes('tipeo') || key.includes('typer') || key.includes('typeo') || key.includes('typeset')) return 'typer';
    return null;
}

export function extractChapterFromName(name) {
    const text = String(name || '').trim();
    if (!text) return null;

    const patterns = [
        /(?:cap(?:itulo)?|chapter|ch|ep(?:isodio)?)\s*[-_:.#]?\s*(\d+(?:[.,]\d+)?)/i,
        /\b(\d+(?:[.,]\d+)?)\b/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match?.[1]) continue;
        const normalized = match[1].replace(',', '.');
        const number = Number(normalized);
        if (Number.isFinite(number) && number > 0 && number <= 10000) {
            return number;
        }
    }
    return null;
}

function scoreDriveItem(file) {
    const mimeType = String(file?.mimeType || '');
    const name = String(file?.name || '').toLowerCase();
    let score = 0;
    if (mimeType === 'application/vnd.google-apps.folder') score += 100;
    if (mimeType === 'application/vnd.google-apps.document') score += 60;
    if (name.includes('raw')) score += 25;
    if (name.includes('clean')) score += 10;
    return score;
}

function scoreDriveItemForRole(file, role) {
    const mimeType = String(file?.mimeType || '');
    const name = normalizeKey(file?.name || '');
    let score = scoreDriveItem(file);

    if (role === 'raw' || role === 'raw_eng') {
        if (mimeType === DRIVE_FOLDER_MIME) score += 90;
        if (name.includes('raw')) score += 30;
        if (role === 'raw_eng' && (name.includes('eng') || name.includes('ingles') || name.includes('english'))) score += 35;
    } else if (role === 'traductor') {
        if (mimeType === 'application/vnd.google-apps.document') score += 120;
        if (name.includes('trad') || name.includes('script')) score += 25;
    } else if (role === 'redraw') {
        if (mimeType === DRIVE_FOLDER_MIME) score += 120;
        if (name.includes('redraw')) score += 25;
    } else if (role === 'typer') {
        if (mimeType === DRIVE_FOLDER_MIME) score += 120;
        if (name.includes('tipeo') || name.includes('typer') || name.includes('typeset')) score += 25;
    }

    return score;
}

function getRoleField(role) {
    if (role === 'raw_eng') return 'raw_eng_url';
    if (role === 'traductor') return 'traductor_url';
    if (role === 'redraw') return 'redraw_url';
    if (role === 'typer') return 'typer_url';
    return 'url';
}

function normalizeRoleKey(role) {
    const key = String(role || '').toLowerCase();
    if (key === 'raw_eng' || key === 'raweng' || key === 'eng' || key === 'ingles' || key === 'english') return 'raw_eng';
    if (key === 'traductor' || key === 'translator' || key === 'traduccion') return 'traductor';
    if (key === 'redraw' || key === 'redrawer' || key === 'caps_limpios') return 'redraw';
    if (key === 'typer' || key === 'typeo' || key === 'tipeo' || key === 'typeset') return 'typer';
    if (key === 'raw') return 'raw';
    return '';
}

export async function listDriveItemsByFolder(folderId) {
    const normalizedFolderId = String(folderId || '').trim();
    if (!normalizedFolderId) {
        throw new Error('folderId es requerido');
    }

    const accessToken = await fetchAccessToken();
    const files = [];
    let pageToken = null;

    do {
        const query = new URLSearchParams({
            q: `'${normalizedFolderId}' in parents and trashed = false`,
            fields: 'nextPageToken,files(id,name,mimeType,webViewLink,owners(emailAddress,displayName))',
            pageSize: '1000',
            includeItemsFromAllDrives: 'true',
            supportsAllDrives: 'true',
            orderBy: 'name_natural',
        });
        if (pageToken) query.set('pageToken', pageToken);

        const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${query.toString()}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const message = data?.error?.message || 'Error listando carpeta de Drive';
            throw new Error(message);
        }

        if (Array.isArray(data?.files)) {
            files.push(...data.files);
        }
        pageToken = data?.nextPageToken || null;
    } while (pageToken);

    return files;
}

export async function findDriveFolderIdByName(folderName) {
    const normalizedName = String(folderName || '').trim();
    if (!normalizedName) return '';

    const accessToken = await fetchAccessToken();
    const escaped = normalizedName.replace(/'/g, "\\'");
    const query = new URLSearchParams({
        q: `name = '${escaped}' and mimeType = '${DRIVE_FOLDER_MIME}' and trashed = false`,
        fields: 'files(id,name,mimeType)',
        pageSize: '20',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
    });

    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.files) || data.files.length === 0) {
        return '';
    }
    const exact = data.files.find((f) => String(f?.name || '') === normalizedName);
    return String((exact || data.files[0])?.id || '').trim();
}

export async function getDriveItemById(itemId) {
    const normalizedId = String(itemId || '').trim();
    if (!normalizedId) return null;

    const accessToken = await fetchAccessToken();
    const query = new URLSearchParams({
        fields: 'id,name,mimeType,parents,webViewLink',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
    });

    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(normalizedId)}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) return null;
    return data;
}

export async function downloadDriveFileById(fileId) {
    const normalizedId = String(fileId || '').trim();
    if (!normalizedId) return null;

    const accessToken = await fetchAccessToken();
    const query = new URLSearchParams({
        alt: 'media',
        supportsAllDrives: 'true',
    });

    const res = await fetch(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(normalizedId)}?${query.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
    });

    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return {
        buffer: arrayBuffer,
        contentType: res.headers.get('content-type') || 'application/octet-stream',
    };
}

async function resolveRoleFoldersFromRawProjectFolder(rootFolderId, projectTitle) {
    const root = await getDriveItemById(rootFolderId);
    if (!root?.id || !Array.isArray(root.parents) || root.parents.length === 0) {
        return {};
    }

    const parentId = String(root.parents[0] || '');
    if (!parentId) return {};

    const parent = await getDriveItemById(parentId);
    if (!parent?.id || !Array.isArray(parent.parents) || parent.parents.length === 0) {
        return {};
    }

    const parentRole = detectRoleFolder(parent?.name);
    if (!parentRole) return {};

    const grandParentId = String(parent.parents[0] || '');
    if (!grandParentId) return {};

    const topFolders = (await listDriveItemsByFolder(grandParentId))
        .filter((item) => String(item?.mimeType || '') === DRIVE_FOLDER_MIME);

    const roleContainers = {};
    for (const folder of topFolders) {
        const role = detectRoleFolder(folder?.name);
        if (!role) continue;
        if (!roleContainers[role]) roleContainers[role] = folder;
    }

    const resolvedByRole = {};
    const projectNameHint = projectTitle || String(root?.name || '');
    const roles = ['raw', 'raw_eng', 'traductor', 'redraw', 'typer'];

    for (const role of roles) {
        const container = roleContainers[role];
        if (!container?.id) continue;
        const children = (await listDriveItemsByFolder(container.id))
            .filter((item) => String(item?.mimeType || '') === DRIVE_FOLDER_MIME);
        const projectFolder = pickBestProjectFolder(children, projectNameHint) ||
            (children.length === 1 ? children[0] : null);
        if (projectFolder?.id) {
            resolvedByRole[role] = projectFolder;
        }
    }

    if (!resolvedByRole.raw && parentRole === 'raw') {
        resolvedByRole.raw = root;
    }

    return resolvedByRole;
}

export function catalogFromDriveItems(files) {
    const byChapter = new Map();
    const ignored = [];

    for (const file of Array.isArray(files) ? files : []) {
        const numero = extractChapterFromName(file?.name);
        if (!numero) {
            ignored.push({
                id: String(file?.id || ''),
                name: String(file?.name || ''),
            });
            continue;
        }

        const current = byChapter.get(numero);
        const candidate = {
            numero,
            url: buildItemUrl(file),
            score: scoreDriveItem(file),
            source_name: String(file?.name || ''),
            source_mime: String(file?.mimeType || ''),
        };

        if (!current || candidate.score >= current.score) {
            byChapter.set(numero, candidate);
        }
    }

    const catalog = [...byChapter.values()]
        .map((entry) => ({ numero: entry.numero, url: entry.url }))
        .sort((a, b) => a.numero - b.numero);

    return {
        catalog,
        ignored,
    };
}

export async function catalogFromDriveByRoleFolders(rootFolderId, mode = 'auto') {
    return catalogFromDriveByRoleFoldersWithOptions(rootFolderId, mode, {});
}

export async function catalogFromDriveByRoleFoldersWithOptions(rootFolderId, mode = 'auto', options = {}) {
    const safeMode = ['auto', 'flat', 'role_folders'].includes(String(mode || '')) ? String(mode) : 'auto';
    const projectTitle = String(options?.projectTitle || '').trim();
    const rootItems = await listDriveItemsByFolder(rootFolderId);

    if (safeMode === 'flat') {
        const flat = catalogFromDriveItems(rootItems);
        return {
            mode: 'flat',
            catalog: flat.catalog,
            ignored: flat.ignored,
            role_folders: {},
            owners_preview: [],
            items_en_drive: rootItems.length,
        };
    }

    const roleFolders = {};
    for (const item of rootItems) {
        if (String(item?.mimeType || '') !== DRIVE_FOLDER_MIME) continue;
        const role = detectRoleFolder(item?.name);
        if (!role) continue;
        if (!roleFolders[role]) roleFolders[role] = item;
    }

    let hasRoleFolders = Object.keys(roleFolders).length > 0;
    if (!hasRoleFolders && safeMode !== 'flat') {
        const resolved = await resolveRoleFoldersFromRawProjectFolder(rootFolderId, projectTitle);
        if (Object.keys(resolved).length > 0) {
            Object.assign(roleFolders, resolved);
            hasRoleFolders = true;
        }
    }
    if (!hasRoleFolders && safeMode === 'auto') {
        const flat = catalogFromDriveItems(rootItems);
        return {
            mode: 'flat',
            catalog: flat.catalog,
            ignored: flat.ignored,
            role_folders: {},
            owners_preview: [],
            items_en_drive: rootItems.length,
        };
    }

    if (!hasRoleFolders && safeMode === 'role_folders') {
        return {
            mode: 'role_folders',
            catalog: [],
            ignored: rootItems.map((item) => ({
                id: String(item?.id || ''),
                name: String(item?.name || ''),
            })),
            role_folders: {},
            owners_preview: [],
            items_en_drive: rootItems.length,
        };
    }

    const chapterMap = new Map();
    const ignored = [];
    const owners = new Map();
    let totalItems = rootItems.length;

    const roles = ['raw', 'traductor', 'redraw', 'typer'];
    for (const role of roles) {
        const folder = roleFolders[role];
        if (!folder?.id) continue;
        let items = await listDriveItemsByFolder(folder.id);
        totalItems += items.length;

        const directHasChapters = items.some((item) => Number.isFinite(Number(extractChapterFromName(item?.name))));
        if (!directHasChapters) {
            const subfolders = items.filter((item) => String(item?.mimeType || '') === DRIVE_FOLDER_MIME);
            const projectFolder = pickBestProjectFolder(subfolders, projectTitle);
            const fallbackFolder = !projectFolder && subfolders.length === 1 ? subfolders[0] : null;
            const selectedFolder = projectFolder || fallbackFolder;
            if (selectedFolder?.id) {
                const nestedItems = await listDriveItemsByFolder(selectedFolder.id);
                totalItems += nestedItems.length;
                items = nestedItems;
            }
        }

        const bestByChapter = new Map();
        for (const item of items) {
            const numero = extractChapterFromName(item?.name);
            if (!numero) {
                ignored.push({ id: String(item?.id || ''), name: String(item?.name || ''), role });
                continue;
            }

            const candidate = {
                numero,
                url: buildItemUrl(item),
                score: scoreDriveItemForRole(item, role),
                owners: Array.isArray(item?.owners) ? item.owners : [],
            };
            const current = bestByChapter.get(numero);
            if (!current || candidate.score >= current.score) {
                bestByChapter.set(numero, candidate);
            }
        }

        for (const [numero, value] of bestByChapter.entries()) {
            if (!chapterMap.get(numero)) {
                chapterMap.set(numero, {
                    numero: Number(numero),
                    url: '',
                    raw_eng_url: '',
                    traductor_url: '',
                    redraw_url: '',
                    typer_url: '',
                });
            }
            const entry = chapterMap.get(numero);
            const field = getRoleField(role);
            entry[field] = value.url || '';
            chapterMap.set(numero, entry);

            for (const owner of value.owners) {
                const email = String(owner?.emailAddress || '').trim();
                if (!email) continue;
                const key = `${numero}|${role}|${email}`;
                if (owners.has(key)) continue;
                owners.set(key, {
                    numero: Number(numero),
                    role,
                    email,
                    name: String(owner?.displayName || ''),
                });
            }
        }
    }

    const catalog = [...chapterMap.values()]
        .sort((a, b) => Number(a.numero) - Number(b.numero));

    return {
        mode: 'role_folders',
        catalog,
        ignored,
        role_folders: Object.fromEntries(
            Object.entries(roleFolders).map(([role, folder]) => [role, {
                id: String(folder?.id || ''),
                name: String(folder?.name || ''),
            }])
        ),
        owners_preview: [...owners.values()].slice(0, 100),
        items_en_drive: totalItems,
    };
}

export async function catalogFromWorkspaceByProjectTitle(workspaceFolderId, projectTitle) {
    const workspaceId = String(workspaceFolderId || '').trim();
    const title = String(projectTitle || '').trim();
    if (!workspaceId || !title) {
        return {
            mode: 'workspace_title',
            catalog: [],
            ignored: [],
            role_folders: {},
            owners_preview: [],
            items_en_drive: 0,
        };
    }

    const topFolders = (await listDriveItemsByFolder(workspaceId))
        .filter((item) => String(item?.mimeType || '') === DRIVE_FOLDER_MIME);

    const roleContainers = {};
    for (const folder of topFolders) {
        const role = detectRoleFolder(folder?.name);
        if (!role) continue;
        if (!roleContainers[role]) roleContainers[role] = folder;
    }

    const roleProjectFolders = {};
    const roles = ['raw', 'raw_eng', 'traductor', 'redraw', 'typer'];
    for (const role of roles) {
        const container = roleContainers[role];
        if (!container?.id) continue;
        const children = (await listDriveItemsByFolder(container.id))
            .filter((item) => String(item?.mimeType || '') === DRIVE_FOLDER_MIME);
        const selected = pickBestProjectFolder(children, title) || (children.length === 1 ? children[0] : null);
        if (selected?.id) {
            roleProjectFolders[role] = selected;
        }
    }

    if (Object.keys(roleProjectFolders).length === 0) {
        return {
            mode: 'workspace_title',
            catalog: [],
            ignored: [],
            role_folders: {},
            owners_preview: [],
            items_en_drive: topFolders.length,
        };
    }

    const chapterMap = new Map();
    const owners = new Map();
    const ignored = [];
    let totalItems = topFolders.length;

    for (const role of roles) {
        const folder = roleProjectFolders[role];
        if (!folder?.id) continue;
        const items = await listDriveItemsByFolder(folder.id);
        totalItems += items.length;

        const bestByChapter = new Map();
        for (const item of items) {
            const numero = extractChapterFromName(item?.name);
            if (!numero) {
                ignored.push({ id: String(item?.id || ''), name: String(item?.name || ''), role });
                continue;
            }
            const candidate = {
                numero,
                url: buildItemUrl(item),
                score: scoreDriveItemForRole(item, role),
                owners: Array.isArray(item?.owners) ? item.owners : [],
            };
            const current = bestByChapter.get(numero);
            if (!current || candidate.score >= current.score) {
                bestByChapter.set(numero, candidate);
            }
        }

        for (const [numero, value] of bestByChapter.entries()) {
            if (!chapterMap.get(numero)) {
                chapterMap.set(numero, {
                    numero: Number(numero),
                    url: '',
                    raw_eng_url: '',
                    traductor_url: '',
                    redraw_url: '',
                    typer_url: '',
                });
            }
            const entry = chapterMap.get(numero);
            const field = getRoleField(role);
            entry[field] = value.url || '';
            chapterMap.set(numero, entry);

            for (const owner of value.owners) {
                const email = String(owner?.emailAddress || '').trim();
                if (!email) continue;
                const key = `${numero}|${role}|${email}`;
                if (owners.has(key)) continue;
                owners.set(key, {
                    numero: Number(numero),
                    role,
                    email,
                    name: String(owner?.displayName || ''),
                });
            }
        }
    }

    return {
        mode: 'workspace_title',
        catalog: [...chapterMap.values()].sort((a, b) => Number(a.numero) - Number(b.numero)),
        ignored,
        role_folders: Object.fromEntries(
            Object.entries(roleProjectFolders).map(([role, folder]) => [role, {
                id: String(folder?.id || ''),
                name: String(folder?.name || ''),
            }])
        ),
        owners_preview: [...owners.values()].slice(0, 100),
        items_en_drive: totalItems,
    };
}

export async function catalogFromRoleFolderIds(roleFolderIds = {}) {
    const roleMap = {};
    for (const [rawRole, value] of Object.entries(roleFolderIds || {})) {
        const role = normalizeRoleKey(rawRole);
        const id = String(value || '').trim();
        if (!role || !id) continue;
        roleMap[role] = id;
    }

    const roles = ['raw', 'raw_eng', 'traductor', 'redraw', 'typer'];
    const chapterMap = new Map();
    const owners = new Map();
    const ignored = [];
    let totalItems = 0;

    for (const role of roles) {
        const folderId = roleMap[role];
        if (!folderId) continue;
        const items = await listDriveItemsByFolder(folderId);
        totalItems += items.length;

        const bestByChapter = new Map();
        for (const item of items) {
            const numero = extractChapterFromName(item?.name);
            if (!numero) {
                ignored.push({ id: String(item?.id || ''), name: String(item?.name || ''), role });
                continue;
            }
            const candidate = {
                numero,
                url: buildItemUrl(item),
                score: scoreDriveItemForRole(item, role),
                owners: Array.isArray(item?.owners) ? item.owners : [],
            };
            const current = bestByChapter.get(numero);
            if (!current || candidate.score >= current.score) {
                bestByChapter.set(numero, candidate);
            }
        }

        for (const [numero, value] of bestByChapter.entries()) {
            if (!chapterMap.get(numero)) {
                chapterMap.set(numero, {
                    numero: Number(numero),
                    url: '',
                    raw_eng_url: '',
                    traductor_url: '',
                    redraw_url: '',
                    typer_url: '',
                });
            }
            const entry = chapterMap.get(numero);
            const field = getRoleField(role);
            entry[field] = value.url || '';
            chapterMap.set(numero, entry);

            for (const owner of value.owners) {
                const email = String(owner?.emailAddress || '').trim();
                if (!email) continue;
                const key = `${numero}|${role}|${email}`;
                if (owners.has(key)) continue;
                owners.set(key, {
                    numero: Number(numero),
                    role,
                    email,
                    name: String(owner?.displayName || ''),
                });
            }
        }
    }

    const catalog = [...chapterMap.values()].sort((a, b) => Number(a.numero) - Number(b.numero));

    return {
        mode: 'role_folder_ids',
        catalog,
        ignored,
        role_folders: Object.fromEntries(
            Object.entries(roleMap).map(([role, id]) => [role, { id, name: '' }])
        ),
        owners_preview: [...owners.values()].slice(0, 100),
        items_en_drive: totalItems,
    };
}
