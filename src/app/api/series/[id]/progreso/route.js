import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const ROLES = ['Traductor', 'Typer', 'Redrawer'];
const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

async function getSessionContext(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT u.roles, u.grupo_id
        FROM sessions s
        JOIN usuarios u ON s.usuario_id = u.id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session) return null;

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch {
        roles = [];
    }

    return {
        roles,
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo') && !roles.some((roleName) => PRODUCTION_ROLES.includes(roleName)),
        groupId: session.grupo_id || null,
    };
}

function toLabel(value) {
    const n = Number(value);
    if (Number.isNaN(n)) return String(value);
    return String(n);
}

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const map = new Map();

    for (const value of rawCatalog) {
        let numero = NaN;
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            numero = Number(value.numero);
            traductor_url = typeof value.traductor_url === 'string' ? value.traductor_url.trim() : '';
            redraw_url = typeof value.redraw_url === 'string' ? value.redraw_url.trim() : '';
            typer_url = typeof value.typer_url === 'string' ? value.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = map.get(numero);
        if (!existing) {
            map.set(numero, { numero, traductor_url, redraw_url, typer_url });
            continue;
        }
        map.set(numero, {
            numero,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...map.values()].sort((a, b) => a.numero - b.numero);
}

async function hasCatalogColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'capitulos_catalogo');
    } catch {
        return false;
    }
}

export async function GET(request, context) {
    try {
        const { id } = await context.params;
        const db = getDb();
        const catalogColumnExists = await hasCatalogColumn(db);

        const ctx = await getSessionContext(db);
        if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const proyecto = await db.prepare(`
            SELECT id, titulo, capitulos_totales, grupo_id, ${catalogColumnExists ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'}
            FROM proyectos
            WHERE id = ?
        `).get(id);

        if (!proyecto) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }

        const restrictToOwnGroup = !ctx.isAdmin || ctx.isLeader;
        if (restrictToOwnGroup && Number(proyecto.grupo_id) !== Number(ctx.groupId)) {
            return NextResponse.json({ error: 'Sin acceso a este proyecto' }, { status: 403 });
        }

        const completados = await db.prepare(`
            SELECT capitulo, rol
            FROM asignaciones
            WHERE proyecto_id = ?
              AND estado = 'Completado'
              AND capitulo IS NOT NULL
        `).all(id);

        const chapterMap = new Map();
        let catalogo = [];
        try {
            catalogo = normalizeCatalog(JSON.parse(proyecto.capitulos_catalogo || '[]'));
        } catch {
            catalogo = [];
        }

        if (catalogo.length > 0) {
            for (const chapter of catalogo) {
                chapterMap.set(Number(chapter.numero), { Traductor: false, Typer: false, Redrawer: false });
            }
        } else {
            const maxInt = Math.floor(Number(proyecto.capitulos_totales || 0));
            for (let i = 1; i <= maxInt; i += 1) {
                chapterMap.set(i, { Traductor: false, Typer: false, Redrawer: false });
            }
            if (Number(proyecto.capitulos_totales) > maxInt) {
                chapterMap.set(Number(proyecto.capitulos_totales), { Traductor: false, Typer: false, Redrawer: false });
            }
        }

        // Count completion from catalog links by role.
        for (const chapter of catalogo) {
            const numero = Number(chapter.numero);
            if (!chapterMap.has(numero)) {
                chapterMap.set(numero, { Traductor: false, Typer: false, Redrawer: false });
            }
            const roles = chapterMap.get(numero);
            if (String(chapter.traductor_url || '').trim()) roles.Traductor = true;
            if (String(chapter.typer_url || '').trim()) roles.Typer = true;
            if (String(chapter.redraw_url || '').trim()) roles.Redrawer = true;
        }

        for (const row of completados) {
            const chapter = Number(row.capitulo);
            if (!chapterMap.has(chapter)) {
                chapterMap.set(chapter, { Traductor: false, Typer: false, Redrawer: false });
            }
            if (ROLES.includes(row.rol)) {
                chapterMap.get(chapter)[row.rol] = true;
            }
        }

        const chapters = [...chapterMap.entries()]
            .map(([numero, roles]) => ({
                numero,
                label: toLabel(numero),
                traductor: roles.Traductor,
                typer: roles.Typer,
                redrawer: roles.Redrawer,
            }))
            .sort((a, b) => a.numero - b.numero);

        const summary = {
            total_capitulos: chapters.length,
            traductor_completados: chapters.filter((c) => c.traductor).length,
            typer_completados: chapters.filter((c) => c.typer).length,
            redrawer_completados: chapters.filter((c) => c.redrawer).length,
            completos_todos_los_roles: chapters.filter((c) => c.traductor && c.typer && c.redrawer).length,
        };

        const missing = {
            traductor: chapters.filter((c) => !c.traductor).map((c) => c.label),
            typer: chapters.filter((c) => !c.typer).map((c) => c.label),
            redrawer: chapters.filter((c) => !c.redrawer).map((c) => c.label),
        };

        return NextResponse.json({
            proyecto: { id: proyecto.id, titulo: proyecto.titulo, capitulos_totales: proyecto.capitulos_totales },
            summary,
            missing,
            chapters,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
