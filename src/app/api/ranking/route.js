import { ensureAssignmentGroupSnapshotSchema, getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getFinalTopForScope, refreshRankingRealtime } from '@/lib/ranking';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

function isISODate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(value);
}

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

function addDaysToISO(isoDate, days) {
    const dateOnly = String(isoDate).slice(0, 10);
    const date = new Date(`${dateOnly}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function getInclusiveDays(start, end) {
    const startDate = new Date(`${String(start).slice(0, 10)}T00:00:00.000Z`);
    const endDate = new Date(`${String(end).slice(0, 10)}T00:00:00.000Z`);
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
    return diff + 1;
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

async function ensureGroupVisibilityColumns(db) {
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_ranking INTEGER DEFAULT 1').run(); } catch { }
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

async function getOrCreateRankingConfig(db) {
    await ensureRankingConfigTable(db);
    const existing = await db.prepare(`
        SELECT start_date, end_date, is_hidden, force_finalize
        FROM ranking_config
        WHERE id = 1
    `).get();

    if (existing?.start_date && existing?.end_date) {
        return {
            start: String(existing.start_date),
            end: String(existing.end_date),
            isHidden: Number(existing.is_hidden || 0) === 1,
            forceFinalize: Number(existing.force_finalize || 0) === 1,
        };
    }

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

async function getSessionAndRoles(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

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

    return { session, roles };
}

export async function GET(request) {
    try {
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        await ensureGroupVisibilityColumns(db);
        const sessionData = await getSessionAndRoles(db);
        if (!sessionData) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const { session, roles } = sessionData;
        const isAdmin = roles.includes('Administrador');
        const isLeaderOnly = roles.includes('Lider de Grupo');
        const viewerGroupId = session.grupo_id || null;
        const groupRow = viewerGroupId
            ? await db.prepare('SELECT COALESCE(mostrar_ranking, 1) as mostrar_ranking FROM grupos WHERE id = ?').get(viewerGroupId)
            : null;
        const groupRankingHidden = Number(groupRow?.mostrar_ranking ?? 1) !== 1;

        const officialRange = await getOrCreateRankingConfig(db);
        const { searchParams } = new URL(request.url);
        const action = searchParams.get('action');
        const queryStart = searchParams.get('start');
        const queryEnd = searchParams.get('end');

        if (action === 'history') {
            try {
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
            } catch { /* already exists */ }

            const seasonKey = searchParams.get('season_key');
            if (seasonKey) {
                if (!isAdmin && !String(seasonKey).endsWith(`|${getScopeKey(viewerGroupId)}`)) {
                    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
                }
                const rows = await db.prepare(`
                    SELECT posicion, usuario_id, usuario_nombre, completados, traductor, redrawer, typer
                    FROM ranking_final_results
                    WHERE season_key = ?
                    ORDER BY posicion ASC
                    LIMIT 10
                `).all(seasonKey);
                return NextResponse.json({
                    ok: true,
                    entries: Array.isArray(rows) ? rows.map(row => ({
                        posicion: Number(row.posicion),
                        usuario_id: Number(row.usuario_id),
                        usuario_nombre: String(row.usuario_nombre || ''),
                        completados: Number(row.completados || 0),
                        traductor: Number(row.traductor || 0),
                        redrawer: Number(row.redrawer || 0),
                        typer: Number(row.typer || 0),
                    })) : [],
                });
            }

            const scopeKey = getScopeKey(isAdmin ? null : viewerGroupId);
            const currentSeasonKey = officialRange
                ? `${officialRange.start}|${officialRange.end}|${scopeKey}`
                : null;
            const rows = currentSeasonKey
                ? await db.prepare(`
                    SELECT season_key, MIN(finalized_at) as finalized_at
                    FROM ranking_final_results
                    WHERE season_key LIKE ? AND season_key != ?
                    GROUP BY season_key
                    ORDER BY season_key DESC
                `).all(`%|${scopeKey}`, currentSeasonKey)
                : await db.prepare(`
                    SELECT season_key, MIN(finalized_at) as finalized_at
                    FROM ranking_final_results
                    WHERE season_key LIKE ?
                    GROUP BY season_key
                    ORDER BY season_key DESC
                `).all(`%|${scopeKey}`);
            const seasons = Array.isArray(rows) ? rows.map(row => {
                const parts = String(row.season_key).split('|');
                return {
                    season_key: String(row.season_key),
                    start: parts[0] || '',
                    end: parts[1] || '',
                    finalized_at: String(row.finalized_at || ''),
                };
            }) : [];
            return NextResponse.json({ ok: true, seasons });
        }

        let start = officialRange?.start || null;
        let end = officialRange?.end || null;
        let isPreview = false;

        if (isAdmin && queryStart && queryEnd) {
            if (!isISODate(queryStart) || !isISODate(queryEnd)) {
                return NextResponse.json({ error: 'Fechas invalidas. Usa formato YYYY-MM-DD o YYYY-MM-DD HH:MM.' }, { status: 400 });
            }
            const normQ = (v) => String(v).replace('T', ' ');
            if (normQ(queryStart) > normQ(queryEnd)) {
                return NextResponse.json({ error: 'La fecha de inicio no puede ser mayor que la fecha de fin.' }, { status: 400 });
            }
            start = queryStart;
            end = queryEnd;
            isPreview = !officialRange || start !== officialRange.start || end !== officialRange.end;
        }

        if (!start || !end) {
            return NextResponse.json({
                canConfigure: isAdmin,
                isPreview: false,
                hasActiveSeason: false,
                seasonClosed: false,
                rankingHidden: false,
                forceFinalized: false,
                range: null,
                officialRange: null,
                total: 0,
                ranking: [],
                finalTop6: [],
            });
        }

        const rankingHidden = Boolean(officialRange?.isHidden) || groupRankingHidden;
        const forceFinalized = Boolean(officialRange?.forceFinalize);
        if (rankingHidden && !isAdmin && !isLeaderOnly) {
            return NextResponse.json({
                canConfigure: false,
                isPreview: false,
                hasActiveSeason: false,
                seasonClosed: forceFinalized || toDateEnd(String(end)) < getCurrentDatetime(),
                rankingHidden: true,
                forceFinalized,
                range: { start, end },
                officialRange: { start: officialRange.start, end: officialRange.end },
                total: 0,
                ranking: [],
                finalTop6: [],
            });
        }

        let visibilityClause = '';
        const visibilityParams = [];

        if (isAdmin) {
            visibilityClause = '';
        } else if (viewerGroupId) {
            visibilityClause = ' AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?';
            visibilityParams.push(viewerGroupId);
        } else {
            visibilityClause = ' AND u.id = ?';
            visibilityParams.push(session.usuario_id);
        }

        const rankingQuery = `
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
              ${visibilityClause}
            GROUP BY u.id, u.nombre, u.avatar_url, u.grupo_id
            HAVING completados > 0
            ORDER BY completados DESC, u.nombre ASC
            LIMIT 50
        `;

        const currentRows = await db.prepare(rankingQuery).all(
            toDateStart(start),
            toDateEnd(end),
            ...visibilityParams
        );

        const currentPayload = Array.isArray(currentRows)
            ? currentRows.map((row, index) => ({
                ...row,
                posicion: index + 1,
                completados: Number(row.completados || 0),
                traductor: Number(row.traductor || 0),
                redrawer: Number(row.redrawer || 0),
                typer: Number(row.typer || 0),
            }))
            : [];

        const rangeDays = getInclusiveDays(start, end);
        const previousEnd = addDaysToISO(start, -1);
        const previousStart = addDaysToISO(previousEnd, -(rangeDays - 1));
        const previousRows = await db.prepare(rankingQuery).all(
            toDateStart(previousStart),
            toDateEnd(previousEnd),
            ...visibilityParams
        );

        const previousPayload = Array.isArray(previousRows)
            ? previousRows.map((row, index) => ({
                usuario_id: Number(row.usuario_id),
                posicion: index + 1,
            }))
            : [];
        const previousPositionByUser = new Map(
            previousPayload.map((row) => [Number(row.usuario_id), Number(row.posicion)])
        );

        const payload = currentPayload.map((row) => {
            const prevPos = previousPositionByUser.get(Number(row.usuario_id));
            if (!prevPos) {
                return {
                    ...row,
                    trend_direction: 'new',
                    trend_delta: null,
                };
            }

            const delta = prevPos - Number(row.posicion);
            if (delta > 0) {
                return { ...row, trend_direction: 'up', trend_delta: delta };
            }
            if (delta < 0) {
                return { ...row, trend_direction: 'down', trend_delta: Math.abs(delta) };
            }
            return { ...row, trend_direction: 'same', trend_delta: 0 };
        });

        await refreshRankingRealtime(db, {
            groupIds: isAdmin ? null : (viewerGroupId ? [viewerGroupId] : []),
            notifyPositionChanges: false,
            runForAllGroups: Boolean(isAdmin),
            emitEvent: false,
        });

        const seasonClosed = forceFinalized || toDateEnd(String(end)) < getCurrentDatetime();
        let finalTop6 = [];
        if (seasonClosed && !isPreview) {
            if (isAdmin || viewerGroupId) {
                const scopeGroupId = isAdmin ? null : Number(viewerGroupId);
                finalTop6 = await getFinalTopForScope(db, { start, end, groupId: scopeGroupId }) || [];
            }
        }

        return NextResponse.json({
            canConfigure: isAdmin,
            isPreview,
            hasActiveSeason: true,
            seasonClosed,
            rankingHidden,
            forceFinalized,
            range: { start, end },
            officialRange: officialRange ? { start: officialRange.start, end: officialRange.end } : null,
            total: payload.length,
            ranking: payload,
            finalTop6,
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}

export async function PATCH(request) {
    try {
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        await ensureGroupVisibilityColumns(db);
        const sessionData = await getSessionAndRoles(db);
        if (!sessionData) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const { session, roles } = sessionData;
        const isAdmin = roles.includes('Administrador');
        const isLeader = roles.includes('Lider de Grupo');
        if (!isAdmin) {
            const body = await request.json();
            const action = String(body?.action || 'save_range');
            if (action !== 'set_visibility_group' || !isLeader) {
                return NextResponse.json({ error: 'No tienes permisos para configurar el ranking.' }, { status: 403 });
            }

            const hidden = Number(body?.hidden ? 1 : 0);
            const groupId = session.grupo_id ? Number(session.grupo_id) : null;
            if (!groupId) {
                return NextResponse.json({ error: 'No tienes grupo asignado.' }, { status: 400 });
            }
            await db.prepare(`
                UPDATE grupos
                SET mostrar_ranking = ?
                WHERE id = ?
            `).run(hidden ? 0 : 1, groupId);
            return NextResponse.json({ ok: true, hidden: hidden === 1 });
        }

        const body = await request.json();
        const action = String(body?.action || 'save_range');
        const start = body?.start;
        const end = body?.end;

        if (action === 'delete_season') {
            const seasonKey = String(body?.season_key || '');
            if (!seasonKey) {
                return NextResponse.json({ error: 'season_key requerido.' }, { status: 400 });
            }
            try {
                await db.prepare(`DELETE FROM ranking_final_results WHERE season_key = ?`).run(seasonKey);
                await db.prepare(`DELETE FROM ranking_live_positions WHERE season_key = ?`).run(seasonKey);
                await db.prepare(`DELETE FROM ranking_final_notified WHERE season_key = ?`).run(seasonKey);
            } catch {
                // ignore if tables don't exist
            }
            return NextResponse.json({ ok: true });
        }

        if (action === 'set_visibility') {
            const hidden = Number(body?.hidden ? 1 : 0);
            await ensureRankingConfigTable(db);
            const existing = await getOrCreateRankingConfig(db);
            if (!existing) {
                return NextResponse.json({ error: 'Primero define un periodo oficial para el ranking.' }, { status: 400 });
            }
            await db.prepare(`
                UPDATE ranking_config
                SET is_hidden = ?, updated_by = ?, updated_at = datetime('now')
                WHERE id = 1
            `).run(hidden, session.usuario_id);

            await refreshRankingRealtime(db, {
                notifyPositionChanges: false,
                emitEvent: true,
            });

            return NextResponse.json({
                ok: true,
                hidden: hidden === 1,
            });
        }

        if (action === 'set_visibility_group') {
            const hidden = Number(body?.hidden ? 1 : 0);
            const groupId = session.grupo_id ? Number(session.grupo_id) : null;
            if (!groupId) {
                return NextResponse.json({ error: 'No tienes grupo asignado.' }, { status: 400 });
            }
            await db.prepare(`
                UPDATE grupos
                SET mostrar_ranking = ?
                WHERE id = ?
            `).run(hidden ? 0 : 1, groupId);
            return NextResponse.json({ ok: true, hidden: hidden === 1 });
        }

        if (action === 'finalize') {
            await ensureRankingConfigTable(db);
            const existing = await getOrCreateRankingConfig(db);
            if (!existing) {
                return NextResponse.json({ error: 'Primero define un periodo oficial para el ranking.' }, { status: 400 });
            }
            await db.prepare(`
                UPDATE ranking_config
                SET force_finalize = 1, updated_by = ?, updated_at = datetime('now')
                WHERE id = 1
            `).run(session.usuario_id);

            await refreshRankingRealtime(db, {
                notifyPositionChanges: false,
                emitEvent: true,
            });

            return NextResponse.json({
                ok: true,
                forceFinalized: true,
            });
        }

        if (!isISODate(start) || !isISODate(end)) {
            return NextResponse.json({ error: 'Fechas invalidas. Usa formato YYYY-MM-DD o YYYY-MM-DD HH:MM.' }, { status: 400 });
        }
        const normalizeForCompare = (v) => String(v).replace('T', ' ');
        if (normalizeForCompare(start) > normalizeForCompare(end)) {
            return NextResponse.json({ error: 'La fecha de inicio no puede ser mayor que la fecha de fin.' }, { status: 400 });
        }

        await ensureRankingConfigTable(db);
        await db.prepare(`
            INSERT INTO ranking_config (id, start_date, end_date, is_hidden, force_finalize, updated_by)
            VALUES (1, ?, ?, 0, 0, ?)
            ON CONFLICT(id) DO UPDATE SET
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                updated_by = excluded.updated_by,
                updated_at = datetime('now')
        `).run(start, end, session.usuario_id);

        await refreshRankingRealtime(db, {
            notifyPositionChanges: false,
        });

        return NextResponse.json({
            ok: true,
            officialRange: { start, end },
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
