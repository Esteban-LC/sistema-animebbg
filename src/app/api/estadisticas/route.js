import { ensurePerformanceIndexes, getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getOfficialRankingRange } from '@/lib/ranking';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

function isISODate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toDateStart(value) {
    return `${value} 00:00:00`;
}

function toDateEnd(value) {
    return `${value} 23:59:59`;
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const scope = String(searchParams.get('scope') || '').toLowerCase();
        const queryStart = searchParams.get('start');
        const queryEnd = searchParams.get('end');

        const db = getDb();
        await ensurePerformanceIndexes(db);
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const session = await db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token);
        if (!session) {
            return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
        }

        const user = await db.prepare('SELECT roles, grupo_id FROM usuarios WHERE id = ?').get(session.usuario_id);
        const roles = user && user.roles ? JSON.parse(user.roles) : [];
        const isAdmin = roles.includes('Administrador');
        const hasProductionRole = roles.some((roleName) => PRODUCTION_ROLES.includes(roleName));
        const isLeader = roles.includes('Lider de Grupo') && !hasProductionRole;
        const groupId = user ? user.grupo_id : null;
        const usePeriodScope = scope === 'period' || scope === 'monthly';

        let start = null;
        let end = null;

        if (usePeriodScope) {
            if (queryStart || queryEnd) {
                if (!isISODate(queryStart) || !isISODate(queryEnd)) {
                    return NextResponse.json({ error: 'Fechas invalidas. Usa formato YYYY-MM-DD.' }, { status: 400 });
                }
                if (queryStart > queryEnd) {
                    return NextResponse.json({ error: 'La fecha de inicio no puede ser mayor que la fecha de fin.' }, { status: 400 });
                }
                start = queryStart;
                end = queryEnd;
            } else {
                const officialRange = await getOfficialRankingRange(db);
                start = officialRange?.start || null;
                end = officialRange?.end || null;
            }
        }

        let query = `
            SELECT 
                COUNT(*) as total_asignaciones,
                SUM(CASE WHEN estado = 'Completado' THEN 1 ELSE 0 END) as completadas,
                SUM(CASE WHEN estado = 'Pendiente' THEN 1 ELSE 0 END) as pendientes,
                SUM(CASE WHEN estado = 'En Proceso' THEN 1 ELSE 0 END) as en_proceso,
                SUM(CASE WHEN rol = 'Redrawer' THEN 1 ELSE 0 END) as redraw,
                SUM(CASE WHEN rol = 'Traductor' THEN 1 ELSE 0 END) as traduccion,
                SUM(CASE WHEN rol = 'Typer' THEN 1 ELSE 0 END) as typeo
            FROM asignaciones a
            JOIN usuarios u ON a.usuario_id = u.id
        `;

        const params = [];

        if (isAdmin) {
            // Admin sees all
        } else if (isLeader && groupId) {
            // Leader sees statistics for their group
            query += ' WHERE u.grupo_id = ?';
            params.push(groupId);
        } else {
            // Staff sees only their own
            query += ' WHERE a.usuario_id = ?';
            params.push(session.usuario_id);
        }

        if (usePeriodScope && start && end) {
            query += params.length === 0 ? ' WHERE ' : ' AND ';
            query += `
                COALESCE(a.completado_en, a.asignado_en) >= ?
                AND COALESCE(a.completado_en, a.asignado_en) <= ?
            `;
            params.push(toDateStart(start), toDateEnd(end));
        }

        const stats = await db.prepare(query).get(...params);
        let historicTotals = null;

        if (usePeriodScope && !isAdmin) {
            let historicalQuery = `
                SELECT
                    COUNT(*) as total_historico,
                    SUM(CASE WHEN estado = 'Completado' THEN 1 ELSE 0 END) as completadas_historico
                FROM asignaciones a
                JOIN usuarios u ON a.usuario_id = u.id
            `;
            const historicalParams = [];

            if (isLeader && groupId) {
                historicalQuery += ' WHERE u.grupo_id = ?';
                historicalParams.push(groupId);
            } else {
                historicalQuery += ' WHERE a.usuario_id = ?';
                historicalParams.push(session.usuario_id);
            }

            historicTotals = await db.prepare(historicalQuery).get(...historicalParams);
        }

        // Format to match frontend interface Stats
        const responseData = {
            total_asignaciones: stats.total_asignaciones || 0,
            pendientes: stats.pendientes || 0,
            en_proceso: stats.en_proceso || 0,
            completadas: stats.completadas || 0,
            por_rol: {
                redraw: stats.redraw || 0,
                traduccion: stats.traduccion || 0,
                typeo: stats.typeo || 0
            },
            range: usePeriodScope && start && end ? { start, end } : null,
            total_historico: historicTotals?.total_historico || null,
            completadas_historico: historicTotals?.completadas_historico || null,
        };

        return NextResponse.json(responseData);

    } catch (error) {
        console.error('Stats API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
