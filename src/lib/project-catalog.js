import { catalogFromDriveByRoleFoldersWithOptions, catalogFromRoleFolderIds, catalogFromWorkspaceByProjectTitle } from '@/lib/google-drive';

const syncCache = new Map();
const DEFAULT_SYNC_TTL_MS = 2 * 60 * 1000;

function parseBoolEnv(value, fallback) {
    if (value === undefined) return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

export function normalizeCatalogEntries(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const map = new Map();

    for (const value of rawCatalog) {
        let numero = NaN;
        let url = '';
        let raw_eng_url = '';
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            numero = Number(value.numero);
            url = typeof value.url === 'string' ? value.url.trim() : '';
            raw_eng_url = typeof value.raw_eng_url === 'string' ? value.raw_eng_url.trim() : '';
            traductor_url = typeof value.traductor_url === 'string' ? value.traductor_url.trim() : '';
            redraw_url = typeof value.redraw_url === 'string' ? value.redraw_url.trim() : '';
            typer_url = typeof value.typer_url === 'string' ? value.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = map.get(numero);
        if (!existing) {
            map.set(numero, { numero, url, raw_eng_url, traductor_url, redraw_url, typer_url });
            continue;
        }

        map.set(numero, {
            numero,
            url: existing.url || url,
            raw_eng_url: existing.raw_eng_url || raw_eng_url,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...map.values()].sort((a, b) => a.numero - b.numero);
}

function mergeCatalogEntriesForPersistence(existingEntries, detectedEntries) {
    const merged = new Map();

    for (const entry of normalizeCatalogEntries(existingEntries || [])) {
        const chapter = Number(entry.numero);
        if (!Number.isFinite(chapter) || chapter <= 0) continue;
        merged.set(chapter, {
            numero: chapter,
            url: String(entry.url || '').trim(),
            raw_eng_url: String(entry.raw_eng_url || '').trim(),
            traductor_url: String(entry.traductor_url || '').trim(),
            redraw_url: String(entry.redraw_url || '').trim(),
            typer_url: String(entry.typer_url || '').trim(),
        });
    }

    for (const entry of normalizeCatalogEntries(detectedEntries || [])) {
        const chapter = Number(entry.numero);
        if (!Number.isFinite(chapter) || chapter <= 0) continue;

        const current = merged.get(chapter);
        if (!current) {
            merged.set(chapter, {
                numero: chapter,
                url: String(entry.url || '').trim(),
                raw_eng_url: String(entry.raw_eng_url || '').trim(),
                traductor_url: String(entry.traductor_url || '').trim(),
                redraw_url: String(entry.redraw_url || '').trim(),
                typer_url: String(entry.typer_url || '').trim(),
            });
            continue;
        }

        merged.set(chapter, {
            numero: chapter,
            url: current.url || String(entry.url || '').trim(),
            raw_eng_url: current.raw_eng_url || String(entry.raw_eng_url || '').trim(),
            traductor_url: current.traductor_url || String(entry.traductor_url || '').trim(),
            redraw_url: current.redraw_url || String(entry.redraw_url || '').trim(),
            typer_url: current.typer_url || String(entry.typer_url || '').trim(),
        });
    }

    return [...merged.values()].sort((a, b) => a.numero - b.numero);
}

async function hasProjectColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(proyectos)').all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

async function ensureProjectColumn(db, columnName, columnSql) {
    const exists = await hasProjectColumn(db, columnName);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN ${columnSql}`).run();
    } catch {
        // verify again below
    }
    return hasProjectColumn(db, columnName);
}

function extractFolderIdFromUrl(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
        const url = new URL(value);
        const host = String(url.hostname || '').toLowerCase();
        if (!host.includes('drive.google.com')) return '';
        const path = String(url.pathname || '');
        const pathMatch = path.match(/\/drive\/folders\/([^/?#]+)/i);
        if (pathMatch?.[1]) return String(pathMatch[1]).trim();
        const openId = url.searchParams.get('id');
        return String(openId || '').trim();
    } catch {
        return '';
    }
}

function normalizeFolderIdLike(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return extractFolderIdFromUrl(raw) || raw;
}

export async function getProjectCatalogEntries(db, projectRow) {
    const hasCatalogColumn = await ensureProjectColumn(db, 'capitulos_catalogo', 'capitulos_catalogo TEXT');
    const hasDriveFolderColumn = await ensureProjectColumn(db, 'drive_folder_id', 'drive_folder_id TEXT');
    const hasRawFolderColumn = await ensureProjectColumn(db, 'raw_folder_id', 'raw_folder_id TEXT');
    const hasRawEngFolderColumn = await ensureProjectColumn(db, 'raw_eng_folder_id', 'raw_eng_folder_id TEXT');
    const hasTraductorFolderColumn = await ensureProjectColumn(db, 'traductor_folder_id', 'traductor_folder_id TEXT');
    const hasRedrawFolderColumn = await ensureProjectColumn(db, 'redraw_folder_id', 'redraw_folder_id TEXT');
    const hasTyperFolderColumn = await ensureProjectColumn(db, 'typer_folder_id', 'typer_folder_id TEXT');

    let row = projectRow || {};
    const needsHydration = row?.id && (row.capitulos_catalogo === undefined || row.drive_folder_id === undefined);
    if (needsHydration) {
        try {
            const hydrated = await db.prepare(`
                SELECT
                    ${hasCatalogColumn ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                    ${hasDriveFolderColumn ? 'drive_folder_id' : 'NULL as drive_folder_id'},
                    ${hasRawFolderColumn ? 'raw_folder_id' : 'NULL as raw_folder_id'},
                    ${hasRawEngFolderColumn ? 'raw_eng_folder_id' : 'NULL as raw_eng_folder_id'},
                    ${hasTraductorFolderColumn ? 'traductor_folder_id' : 'NULL as traductor_folder_id'},
                    ${hasRedrawFolderColumn ? 'redraw_folder_id' : 'NULL as redraw_folder_id'},
                    ${hasTyperFolderColumn ? 'typer_folder_id' : 'NULL as typer_folder_id'}
                FROM proyectos
                WHERE id = ?
            `).get(row.id);
            if (hydrated) {
                row = { ...row, ...hydrated };
            }
        } catch {
            // keep original row
        }
    }

    const fallback = normalizeCatalogEntries(
        (() => {
            try {
                return JSON.parse(row?.capitulos_catalogo || '[]');
            } catch {
                return [];
            }
        })()
    );

    const autoSyncEnabled = parseBoolEnv(process.env.DRIVE_AUTO_SYNC, true);
    const explicitRoleFolders = {
        raw: normalizeFolderIdLike(row?.raw_folder_id),
        raw_eng: normalizeFolderIdLike(row?.raw_eng_folder_id),
        traductor: normalizeFolderIdLike(row?.traductor_folder_id),
        redraw: normalizeFolderIdLike(row?.redraw_folder_id),
        typer: normalizeFolderIdLike(row?.typer_folder_id),
    };
    const hasExplicitRoleFolders = Object.values(explicitRoleFolders).some((v) => Boolean(v));

    if (autoSyncEnabled && hasExplicitRoleFolders) {
        try {
            const scan = await catalogFromRoleFolderIds(explicitRoleFolders);
            const detected = normalizeCatalogEntries(scan?.catalog || []);
            if (detected.length > 0 && row?.id) {
                const merged = mergeCatalogEntriesForPersistence(fallback, detected);
                const maxChapter = merged[merged.length - 1]?.numero || null;
                const fields = [];
                const params = [];
                if (hasCatalogColumn) {
                    fields.push('capitulos_catalogo = ?');
                    params.push(JSON.stringify(merged));
                }
                fields.push('capitulos_totales = ?');
                params.push(maxChapter);
                fields.push('ultima_actualizacion = CURRENT_TIMESTAMP');
                params.push(row.id);
                await db.prepare(`
                    UPDATE proyectos
                    SET ${fields.join(', ')}
                    WHERE id = ?
                `).run(...params);
                return merged;
            }
        } catch {
            // continue with other strategies
        }
    }

    let folderId = normalizeFolderIdLike(row?.drive_folder_id);
    if (!folderId) {
        for (const entry of fallback) {
            folderId = extractFolderIdFromUrl(entry?.url);
            if (folderId) break;
        }
    }
    if (!autoSyncEnabled || !folderId) {
        const workspaceFolderId = String(process.env.DRIVE_WORKSPACE_FOLDER_ID || '').trim();
        if (!workspaceFolderId) return fallback;

        try {
            const scan = await catalogFromWorkspaceByProjectTitle(workspaceFolderId, String(row?.titulo || ''));
            const detected = normalizeCatalogEntries(scan?.catalog || []);
            if (detected.length === 0) return fallback;
            const merged = mergeCatalogEntriesForPersistence(fallback, detected);

            if (row?.id) {
                const maxChapter = merged[merged.length - 1]?.numero || null;
                const fields = [];
                const params = [];
                if (hasCatalogColumn) {
                    fields.push('capitulos_catalogo = ?');
                    params.push(JSON.stringify(merged));
                }
                fields.push('capitulos_totales = ?');
                params.push(maxChapter);
                fields.push('ultima_actualizacion = CURRENT_TIMESTAMP');
                params.push(row.id);
                await db.prepare(`
                    UPDATE proyectos
                    SET ${fields.join(', ')}
                    WHERE id = ?
                `).run(...params);
            }

            return merged;
        } catch {
            return fallback;
        }
    }

    const cacheKey = String(row?.id || '');
    const ttlMs = Number(process.env.DRIVE_AUTO_SYNC_TTL_MS || DEFAULT_SYNC_TTL_MS);
    const cacheEntry = syncCache.get(cacheKey);
    if (cacheEntry && (Date.now() - cacheEntry.atMs) < ttlMs) {
        return cacheEntry.entries;
    }

    try {
        const scan = await catalogFromDriveByRoleFoldersWithOptions(folderId, 'role_folders', {
            projectTitle: String(projectRow?.titulo || ''),
        });
        const detected = normalizeCatalogEntries(scan?.catalog || []);
        if (detected.length === 0) {
            syncCache.set(cacheKey, { atMs: Date.now(), entries: fallback });
            return fallback;
        }
        const merged = mergeCatalogEntriesForPersistence(fallback, detected);

        if (row?.id) {
            const maxChapter = merged[merged.length - 1]?.numero || null;
            const fields = [];
            const params = [];
            if (hasCatalogColumn) {
                fields.push('capitulos_catalogo = ?');
                params.push(JSON.stringify(merged));
            }
            fields.push('capitulos_totales = ?');
            params.push(maxChapter);
            if (hasDriveFolderColumn) {
                fields.push('drive_folder_id = COALESCE(NULLIF(TRIM(drive_folder_id), \'\'), ?)');
                params.push(folderId);
            }
            fields.push('ultima_actualizacion = CURRENT_TIMESTAMP');
            params.push(row.id);
            await db.prepare(`
                UPDATE proyectos
                SET ${fields.join(', ')}
                WHERE id = ?
            `).run(...params);
        }

        syncCache.set(cacheKey, { atMs: Date.now(), entries: merged });
        return merged;
    } catch {
        syncCache.set(cacheKey, { atMs: Date.now(), entries: fallback });
        return fallback;
    }
}
