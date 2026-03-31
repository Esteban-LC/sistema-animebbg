import { ensureAssignmentGroupSnapshotSchema, getDb } from '@/lib/db';
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
        const usuario_id = searchParams.get('usuario_id');
        const includeSummary = searchParams.get('include_summary') === '1';
        const queryStart = searchParams.get('start');
        const queryEnd = searchParams.get('end');
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON s.usuario_id = u.id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);

        if (!session) {
            return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });
        }

        let roles = [];
        try {
            roles = JSON.parse(session.roles || '[]');
        } catch {
            roles = [];
        }
        const isAdmin = roles.includes('Administrador');
        const isLeaderOnly = roles.includes('Lider de Grupo');
        const canViewAll = isAdmin || isLeaderOnly;
        const targetUserId = canViewAll
            ? (usuario_id || null)
            : session.usuario_id;
        const sessionGroupId = session?.grupo_id ? Number(session.grupo_id) : null;

        let start = null;
        let end = null;

        if (queryStart || queryEnd) {
            if (!isISODate(queryStart) || !isISODate(queryEnd)) {
                return NextResponse.json({ error: 'Fechas invalidas. Usa formato YYYY-MM-DD.' }, { status: 400 });
            }
            if (queryStart > queryEnd) {
                return NextResponse.json({ error: 'La fecha de inicio no puede ser mayor que la fecha de fin.' }, { status: 400 });
            }
            start = queryStart;
            end = queryEnd;
        } else if (includeSummary) {
            const officialRange = await getOfficialRankingRange(db);
            if (officialRange?.start && officialRange?.end) {
                start = String(officialRange.start).slice(0, 10);
                end = String(officialRange.end).slice(0, 10);
            }
        }

        if (isLeaderOnly && !sessionGroupId) {
            return includeSummary
                ? NextResponse.json({ historial: [], resumen: [], range: start && end ? { start, end } : null })
                : NextResponse.json([]);
        }

        let query = `
            SELECT a.*, p.titulo as proyecto_titulo, u.nombre as usuario, a.completado_en as fecha
            FROM asignaciones a
            LEFT JOIN proyectos p ON a.proyecto_id = p.id
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.estado = 'Completado'
        `;
        const params = [];

        if (targetUserId) {
            query += ' AND a.usuario_id = ?';
            params.push(targetUserId);
        }
        if (isLeaderOnly && !isAdmin) {
            query += ' AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?';
            params.push(sessionGroupId);
        }
        if (start && end) {
            query += ' AND a.completado_en >= ? AND a.completado_en <= ?';
            params.push(toDateStart(start), toDateEnd(end));
        }

        query += ' ORDER BY a.completado_en DESC LIMIT 50';

        const historial = await db.prepare(query).all(...params);
        if (!includeSummary) {
            return NextResponse.json(historial);
        }

        let summaryQuery = `
            SELECT
                a.usuario_id as usuario_id,
                COALESCE(NULLIF(TRIM(u.nombre), ''), 'Usuario eliminado') as usuario,
                COUNT(*) as trabajos,
                SUM(CASE WHEN a.rol = 'Traductor' THEN 1 ELSE 0 END) as traductor,
                SUM(CASE WHEN a.rol = 'Typer' THEN 1 ELSE 0 END) as typer,
                SUM(CASE WHEN a.rol = 'Redrawer' THEN 1 ELSE 0 END) as redrawer
            FROM asignaciones a
            LEFT JOIN proyectos p ON a.proyecto_id = p.id
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.estado = 'Completado'
        `;
        const summaryParams = [];

        if (targetUserId) {
            summaryQuery += ' AND a.usuario_id = ?';
            summaryParams.push(targetUserId);
        }
        if (isLeaderOnly && !isAdmin) {
            summaryQuery += ' AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?';
            summaryParams.push(sessionGroupId);
        }
        if (start && end) {
            summaryQuery += ' AND a.completado_en >= ? AND a.completado_en <= ?';
            summaryParams.push(toDateStart(start), toDateEnd(end));
        }

        summaryQuery += `
            GROUP BY a.usuario_id, COALESCE(NULLIF(TRIM(u.nombre), ''), 'Usuario eliminado')
            ORDER BY trabajos DESC, usuario ASC
            LIMIT 100
        `;

        const periodSummary = await db.prepare(summaryQuery).all(...summaryParams);

        let totalsQuery = `
            SELECT
                a.usuario_id as usuario_id,
                COALESCE(NULLIF(TRIM(u.nombre), ''), 'Usuario eliminado') as usuario,
                COUNT(*) as trabajos_total
            FROM asignaciones a
            LEFT JOIN proyectos p ON a.proyecto_id = p.id
            LEFT JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.estado = 'Completado'
        `;
        const totalsParams = [];

        if (targetUserId) {
            totalsQuery += ' AND a.usuario_id = ?';
            totalsParams.push(targetUserId);
        }
        if (isLeaderOnly && !isAdmin) {
            totalsQuery += ' AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?';
            totalsParams.push(sessionGroupId);
        }

        totalsQuery += `
            GROUP BY a.usuario_id, COALESCE(NULLIF(TRIM(u.nombre), ''), 'Usuario eliminado')
        `;

        const totalSummary = await db.prepare(totalsQuery).all(...totalsParams);
        const totalByUser = new Map(
            (Array.isArray(totalSummary) ? totalSummary : []).map((item) => [
                `${item.usuario_id ?? 'none'}-${String(item.usuario || '')}`,
                Number(item.trabajos_total || 0),
            ])
        );

        const resumen = (Array.isArray(periodSummary) ? periodSummary : []).map((item) => {
            const key = `${item.usuario_id ?? 'none'}-${String(item.usuario || '')}`;
            const trabajosPeriodo = Number(item.trabajos || 0);
            return {
                ...item,
                trabajos: trabajosPeriodo,
                trabajos_periodo: trabajosPeriodo,
                trabajos_total: Number(totalByUser.get(key) || 0),
            };
        });

        return NextResponse.json({
            historial,
            resumen,
            range: start && end ? { start, end } : null,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
