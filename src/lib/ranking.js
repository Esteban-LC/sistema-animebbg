import { ensureAssignmentGroupSnapshotSchema } from '@/lib/db';
import { createNotification } from '@/lib/notifications';
import { publishRankingEvent } from '@/lib/realtime';

function hasTimeComponent(value) {
    return typeof value === 'string' && value.length > 10;
}

function toDateStart(value) {
    if (hasTimeComponent(value)) {
        const v = value.replace('T', ' ').trim();
        return v.length === 16 ? v + ':00' : v;
    }
    return `${value} 00:00:00`;
}

function toDateEnd(value) {
    if (hasTimeComponent(value)) {
        const v = value.replace('T', ' ').trim();
        return v.length === 16 ? v + ':00' : v;
    }
    return `${value} 23:59:59`;
}

function getCurrentDatetime() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function getCurrentMonthRange() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const last = new Date(Date.UTC(year, month + 1, 0));
    return {
        start: first.toISOString().slice(0, 10),
        end: last.toISOString().slice(0, 10),
    };
}

function getScopeKey(groupId) {
    return groupId === null || groupId === undefined ? 'all' : `g${Number(groupId)}`;
}

function getSeasonKey(start, end, groupId) {
    return `${String(start)}|${String(end)}|${getScopeKey(groupId)}`;
}

function normalizeRankingRows(rows) {
    return Array.isArray(rows)
        ? rows.map((row, index) => ({
            usuario_id: Number(row.usuario_id),
            usuario_nombre: String(row.usuario_nombre || ''),
            grupo_id: row.grupo_id === null || row.grupo_id === undefined ? null : Number(row.grupo_id),
            avatar_url: row.avatar_url || null,
            traductor: Number(row.traductor || 0),
            redrawer: Number(row.redrawer || 0),
            typer: Number(row.typer || 0),
            completados: Number(row.completados || 0),
            posicion: index + 1,
        }))
        : [];
}

async function ensureRankingConfigTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS ranking_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            is_hidden INTEGER NOT NULL DEFAULT 0,
            force_finalize INTEGER NOT NULL DEFAULT 0,
            updated_by INTEGER,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    try {
        await db.prepare(`ALTER TABLE ranking_config ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0`).run();
    } catch {
        // already exists
    }
    try {
        await db.prepare(`ALTER TABLE ranking_config ADD COLUMN force_finalize INTEGER NOT NULL DEFAULT 0`).run();
    } catch {
        // already exists
    }
}

async function ensureRankingStateTables(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS ranking_live_positions (
            season_key TEXT NOT NULL,
            usuario_id INTEGER NOT NULL,
            posicion INTEGER NOT NULL,
            completados INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (season_key, usuario_id)
        )
    `).run();

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS ranking_final_results (
            season_key TEXT NOT NULL,
            posicion INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            usuario_nombre TEXT NOT NULL,
            grupo_id INTEGER,
            completados INTEGER NOT NULL DEFAULT 0,
            traductor INTEGER NOT NULL DEFAULT 0,
            redrawer INTEGER NOT NULL DEFAULT 0,
            typer INTEGER NOT NULL DEFAULT 0,
            finalized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (season_key, posicion)
        )
    `).run();

    await db.prepare(`
        CREATE TABLE IF NOT EXISTS ranking_final_notified (
            season_key TEXT NOT NULL,
            usuario_id INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (season_key, usuario_id)
        )
    `).run();
}

export async function getOfficialRankingRange(db) {
    await ensureRankingConfigTable(db);
    const row = await db.prepare(`
        SELECT start_date, end_date, is_hidden, force_finalize
        FROM ranking_config
        WHERE id = 1
    `).get();
    if (!row?.start_date || !row?.end_date) {
        const monthRange = getCurrentMonthRange();
        await db.prepare(`
            INSERT INTO ranking_config (id, start_date, end_date, is_hidden, force_finalize)
            VALUES (1, ?, ?, 0, 0)
            ON CONFLICT(id) DO UPDATE SET
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                updated_at = datetime('now')
        `).run(monthRange.start, monthRange.end);
        return {
            start: monthRange.start,
            end: monthRange.end,
            isHidden: false,
            forceFinalize: false,
        };
    }
    return {
        start: String(row.start_date),
        end: String(row.end_date),
        isHidden: Number(row.is_hidden || 0) === 1,
        forceFinalize: Number(row.force_finalize || 0) === 1,
    };
}

export async function computeRankingForScope(db, { start, end, groupId = null, limit = 50 }) {
    await ensureAssignmentGroupSnapshotSchema(db);
    const useGroupFilter = groupId !== null && groupId !== undefined;
    const groupClause = useGroupFilter ? 'AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?' : '';
    const query = `
        SELECT
            u.id as usuario_id,
            u.nombre as usuario_nombre,
            u.avatar_url,
            u.grupo_id,
            SUM(CASE WHEN a.rol = 'Traductor' THEN 1 ELSE 0 END) as traductor,
            SUM(CASE WHEN a.rol = 'Redrawer' THEN 1 ELSE 0 END) as redrawer,
            SUM(CASE WHEN a.rol = 'Typer' THEN 1 ELSE 0 END) as typer,
            COUNT(a.id) as completados
        FROM usuarios u
        LEFT JOIN asignaciones a
          ON a.usuario_id = u.id
         AND a.estado = 'Completado'
         AND a.completado_en IS NOT NULL
         AND a.completado_en >= ?
         AND a.completado_en <= ?
        LEFT JOIN proyectos p
          ON p.id = a.proyecto_id
        WHERE u.activo = 1
          ${groupClause}
        GROUP BY u.id, u.nombre, u.avatar_url, u.grupo_id
        HAVING completados > 0
        ORDER BY completados DESC, u.nombre ASC
        LIMIT ?
    `;

    const params = [
        toDateStart(start),
        toDateEnd(end),
    ];
    if (useGroupFilter) params.push(Number(groupId));
    params.push(Number(limit));

    const rows = await db.prepare(query).all(...params);
    return normalizeRankingRows(rows);
}

async function loadPreviousPositions(db, seasonKey) {
    await ensureRankingStateTables(db);
    const rows = await db.prepare(`
        SELECT usuario_id, posicion
        FROM ranking_live_positions
        WHERE season_key = ?
    `).all(seasonKey);
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        map.set(Number(row.usuario_id), Number(row.posicion));
    }
    return map;
}

async function saveCurrentPositions(db, seasonKey, rankingRows) {
    await ensureRankingStateTables(db);
    await db.prepare(`
        DELETE FROM ranking_live_positions
        WHERE season_key = ?
    `).run(seasonKey);

    for (const row of rankingRows) {
        await db.prepare(`
            INSERT INTO ranking_live_positions (season_key, usuario_id, posicion, completados)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(season_key, usuario_id) DO UPDATE SET
                posicion = excluded.posicion,
                completados = excluded.completados,
                updated_at = datetime('now')
        `).run(
            seasonKey,
            Number(row.usuario_id),
            Number(row.posicion),
            Number(row.completados || 0)
        );
    }
}

function positionLabel(position) {
    if (position === 1) return 'Top 1';
    if (position === 2) return 'Top 2';
    if (position === 3) return 'Top 3';
    return `Top ${position}`;
}

async function notifyTopChanges(db, previousPositions, currentRows) {
    const currentPositions = new Map(
        currentRows.map((row) => [Number(row.usuario_id), Number(row.posicion)])
    );
    const allUserIds = new Set([
        ...previousPositions.keys(),
        ...currentPositions.keys(),
    ]);

    for (const userId of allUserIds) {
        const previousPos = previousPositions.get(Number(userId)) || null;
        const currentPos = currentPositions.get(Number(userId)) || null;
        const wasTop3 = previousPos !== null && previousPos <= 3;
        const isTop3 = currentPos !== null && currentPos <= 3;

        if (!wasTop3 && !isTop3) continue;

        let title = '';
        let message = '';
        if (!wasTop3 && isTop3) {
            title = `Entraste al ${positionLabel(Number(currentPos))}`;
            message = `Felicidades, subiste al ${positionLabel(Number(currentPos))} del ranking.`;
        } else if (wasTop3 && !isTop3) {
            title = 'Perdiste el Top 3';
            message = `Saliste del Top 3. Sigue avanzando para recuperar posicion.`;
        } else if (wasTop3 && isTop3 && Number(previousPos) !== Number(currentPos)) {
            if (Number(currentPos) < Number(previousPos)) {
                title = `Subiste al ${positionLabel(Number(currentPos))}`;
                message = `Excelente, subiste de ${positionLabel(Number(previousPos))} a ${positionLabel(Number(currentPos))}.`;
            } else {
                title = `Bajaste al ${positionLabel(Number(currentPos))}`;
                message = `Te moviste de ${positionLabel(Number(previousPos))} a ${positionLabel(Number(currentPos))}.`;
            }
        }

        if (!title || !message) continue;
        await createNotification(db, {
            usuarioId: Number(userId),
            tipo: 'ranking_movimiento',
            titulo: title,
            mensaje: message,
            data: {
                previous_pos: previousPos,
                current_pos: currentPos,
            },
        });
    }
}

async function finalizeSeasonIfClosed(db, { start, end, groupId, forceFinalize = false }) {
    const isClosed = forceFinalize || toDateEnd(end) < getCurrentDatetime();
    if (!isClosed) return null;

    await ensureRankingStateTables(db);
    const seasonKey = getSeasonKey(start, end, groupId);
    const existing = await db.prepare(`
        SELECT posicion, usuario_id, usuario_nombre, grupo_id, completados, traductor, redrawer, typer
        FROM ranking_final_results
        WHERE season_key = ?
        ORDER BY posicion ASC
    `).all(seasonKey);

    if (Array.isArray(existing) && existing.length > 0) {
        return existing.map((row) => ({
            posicion: Number(row.posicion),
            usuario_id: Number(row.usuario_id),
            usuario_nombre: String(row.usuario_nombre || ''),
            grupo_id: row.grupo_id === null || row.grupo_id === undefined ? null : Number(row.grupo_id),
            completados: Number(row.completados || 0),
            traductor: Number(row.traductor || 0),
            redrawer: Number(row.redrawer || 0),
            typer: Number(row.typer || 0),
        }));
    }

    const ranking = await computeRankingForScope(db, { start, end, groupId, limit: 10 });
    for (const row of ranking) {
        await db.prepare(`
            INSERT INTO ranking_final_results (
                season_key, posicion, usuario_id, usuario_nombre, grupo_id, completados, traductor, redrawer, typer
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(season_key, posicion) DO UPDATE SET
                usuario_id = excluded.usuario_id,
                usuario_nombre = excluded.usuario_nombre,
                grupo_id = excluded.grupo_id,
                completados = excluded.completados,
                traductor = excluded.traductor,
                redrawer = excluded.redrawer,
                typer = excluded.typer,
                finalized_at = datetime('now')
        `).run(
            seasonKey,
            Number(row.posicion),
            Number(row.usuario_id),
            String(row.usuario_nombre || ''),
            row.grupo_id === null || row.grupo_id === undefined ? null : Number(row.grupo_id),
            Number(row.completados || 0),
            Number(row.traductor || 0),
            Number(row.redrawer || 0),
            Number(row.typer || 0)
        );

        const notified = await db.prepare(`
            SELECT usuario_id
            FROM ranking_final_notified
            WHERE season_key = ? AND usuario_id = ?
        `).get(seasonKey, Number(row.usuario_id));
        if (!notified) {
            await createNotification(db, {
                usuarioId: Number(row.usuario_id),
                tipo: 'ranking_final',
                titulo: `Temporada finalizada: ${positionLabel(Number(row.posicion))}`,
                mensaje: `Felicidades, cerraste la temporada en ${positionLabel(Number(row.posicion))} con ${Number(row.completados)} capitulos.`,
                data: {
                    final_pos: Number(row.posicion),
                    completados: Number(row.completados || 0),
                    season_start: start,
                    season_end: end,
                },
            });
            await db.prepare(`
                INSERT OR IGNORE INTO ranking_final_notified (season_key, usuario_id)
                VALUES (?, ?)
            `).run(seasonKey, Number(row.usuario_id));
        }
    }

    return ranking;
}

export async function refreshRankingRealtime(db, { groupIds = null, notifyPositionChanges = true, runForAllGroups = true, emitEvent = true } = {}) {
    const range = await getOfficialRankingRange(db);
    if (!range) return { hasActiveSeason: false, range: null };

    await ensureRankingStateTables(db);
    const targetGroupIds = Array.isArray(groupIds)
        ? [...new Set(groupIds.filter((value) => value !== null && value !== undefined).map((value) => Number(value)))]
        : [];

    if (targetGroupIds.length === 0 && runForAllGroups) {
        const rows = await db.prepare(`
            SELECT DISTINCT grupo_id
            FROM usuarios
            WHERE activo = 1 AND grupo_id IS NOT NULL
        `).all();
        for (const row of Array.isArray(rows) ? rows : []) {
            targetGroupIds.push(Number(row.grupo_id));
        }
    }

    const seasonClosed = Boolean(range.forceFinalize) || toDateEnd(range.end) < getCurrentDatetime();
    for (const groupId of targetGroupIds) {
        const seasonKey = getSeasonKey(range.start, range.end, groupId);
        const previousMap = await loadPreviousPositions(db, seasonKey);
        const current = await computeRankingForScope(db, { start: range.start, end: range.end, groupId, limit: 10 });
        if (notifyPositionChanges) {
            await notifyTopChanges(db, previousMap, current);
        }
        await saveCurrentPositions(db, seasonKey, current);
        await finalizeSeasonIfClosed(db, { start: range.start, end: range.end, groupId, forceFinalize: Boolean(range.forceFinalize) });
    }

    // Keep a global "all groups" snapshot for admin/global ranking UI.
    const globalSeasonKey = getSeasonKey(range.start, range.end, null);
    const globalRanking = await computeRankingForScope(db, { start: range.start, end: range.end, groupId: null, limit: 10 });
    await saveCurrentPositions(db, globalSeasonKey, globalRanking);
    await finalizeSeasonIfClosed(db, { start: range.start, end: range.end, groupId: null, forceFinalize: Boolean(range.forceFinalize) });

    if (emitEvent) {
        publishRankingEvent({
            start: range.start,
            end: range.end,
            season_closed: seasonClosed,
            ts: Date.now(),
        });
    }

    return {
        hasActiveSeason: true,
        range,
        seasonClosed,
    };
}

export async function getFinalTopForScope(db, { start, end, groupId }) {
    await ensureRankingStateTables(db);
    const seasonKey = getSeasonKey(start, end, groupId);
    const rows = await db.prepare(`
        SELECT posicion, usuario_id, usuario_nombre, grupo_id, completados, traductor, redrawer, typer
        FROM ranking_final_results
        WHERE season_key = ?
        ORDER BY posicion ASC
    `).all(seasonKey);
    if (Array.isArray(rows) && rows.length > 0) {
        return rows.map((row) => ({
            posicion: Number(row.posicion),
            usuario_id: Number(row.usuario_id),
            usuario_nombre: String(row.usuario_nombre || ''),
            grupo_id: row.grupo_id === null || row.grupo_id === undefined ? null : Number(row.grupo_id),
            completados: Number(row.completados || 0),
            traductor: Number(row.traductor || 0),
            redrawer: Number(row.redrawer || 0),
            typer: Number(row.typer || 0),
        }));
    }

    const official = await getOfficialRankingRange(db);
    const forceFinalize = official?.start === start && official?.end === end ? Boolean(official?.forceFinalize) : false;
    return finalizeSeasonIfClosed(db, { start, end, groupId, forceFinalize });
}
