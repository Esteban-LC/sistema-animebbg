import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

function normalizeTag(rawTag) {
    return String(rawTag || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

async function hasUsuariosColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(usuarios)').all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

async function ensureUsuariosCreditosColumns(db) {
    const hasTag = await hasUsuariosColumn(db, 'tag');
    if (!hasTag) {
        try {
            await db.prepare('ALTER TABLE usuarios ADD COLUMN tag TEXT').run();
        } catch { }
    }
    const hasNombreCreditos = await hasUsuariosColumn(db, 'nombre_creditos');
    if (!hasNombreCreditos) {
        try {
            await db.prepare('ALTER TABLE usuarios ADD COLUMN nombre_creditos TEXT').run();
        } catch { }
    }

    try {
        await db.prepare(`UPDATE usuarios SET nombre_creditos = nombre WHERE nombre_creditos IS NULL OR TRIM(nombre_creditos) = ''`).run();
    } catch { }
    try {
        await db.prepare(`UPDATE usuarios SET tag = LOWER(REPLACE(COALESCE(discord_username, nombre), ' ', '')) WHERE tag IS NULL OR TRIM(tag) = ''`).run();
    } catch { }
    try {
        await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tag_unique ON usuarios(tag)').run();
    } catch { }
}

export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { nombre, roles, grupo_id, activo, avatar_url, tag, nombre_creditos, rango } = body;
        const db = getDb();
        await ensureUsuariosCreditosColumns(db);
        const token = (await cookies()).get('auth_token')?.value;
        if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);
        if (!session) return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });

        let requesterRoles = [];
        try {
            requesterRoles = JSON.parse(session.roles || '[]');
        } catch {
            requesterRoles = [];
        }

        const isAdmin = requesterRoles.includes('Administrador');
        if (!isAdmin) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const targetUser = await db.prepare('SELECT id, grupo_id FROM usuarios WHERE id = ?').get(id);
        if (!targetUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

        const updates = [];
        const queryParams = [];

        if (nombre) {
            updates.push('nombre = ?');
            queryParams.push(nombre);
        }
        if (roles) {
            updates.push('roles = ?');
            queryParams.push(JSON.stringify(roles));
        }
        if (grupo_id !== undefined) {
            updates.push('grupo_id = ?');
            queryParams.push(grupo_id);
        }
        if (activo !== undefined) {
            updates.push('activo = ?');
            queryParams.push(activo);
        }
        if (avatar_url !== undefined) {
            updates.push('avatar_url = ?');
            queryParams.push(avatar_url);
        }
        if (nombre_creditos !== undefined) {
            updates.push('nombre_creditos = ?');
            queryParams.push(String(nombre_creditos || '').trim() || null);
        }
        if (rango !== undefined) {
            const rangoNum = Number(rango);
            if (rangoNum === 1 || rangoNum === 2) {
                updates.push('rango = ?');
                queryParams.push(rangoNum);
            }
        }
        if (tag !== undefined) {
            const normalizedTag = normalizeTag(tag);
            if (!normalizedTag) {
                return NextResponse.json({ error: 'Tag invalido' }, { status: 400 });
            }
            const tagInUse = await db.prepare('SELECT id FROM usuarios WHERE LOWER(tag) = LOWER(?) AND id != ? LIMIT 1').get(normalizedTag, id);
            if (tagInUse) {
                return NextResponse.json({ error: 'El tag ya esta en uso' }, { status: 409 });
            }
            updates.push('tag = ?');
            queryParams.push(normalizedTag);
        }

        if (body.password) {
            updates.push('password = ?');
            queryParams.push(body.password);
        }

        if (updates.length === 0) {
            return NextResponse.json({ message: 'No hay cambios' });
        }

        queryParams.push(id);

        const stmt = db.prepare(`UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`);
        const result = await stmt.run(...queryParams);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Usuario actualizado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const db = getDb();
        const token = (await cookies()).get('auth_token')?.value;
        if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const session = await db.prepare(`
            SELECT s.usuario_id, u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);
        if (!session) return NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 });

        let requesterRoles = [];
        try {
            requesterRoles = JSON.parse(session.roles || '[]');
        } catch {
            requesterRoles = [];
        }

        const isAdmin = requesterRoles.includes('Administrador');
        if (!isAdmin) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const targetUser = await db.prepare('SELECT id, grupo_id FROM usuarios WHERE id = ?').get(id);
        if (!targetUser) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

        // 1. Delete associated data first to avoid FK constraints (or logical orphans)
        // Wrapped in try/catch in case of legacy table issues (e.g. asignaciones_old from old migrations)
        try {
            await db.prepare(`
                DELETE FROM informes
                WHERE asignacion_id IN (SELECT id FROM asignaciones WHERE usuario_id = ?)
            `).run(id);
        } catch { }
        try {
            await db.prepare('DELETE FROM asignaciones WHERE usuario_id = ?').run(id);
        } catch { }
        try {
            await db.prepare('DELETE FROM solicitudes_asignacion WHERE usuario_id = ?').run(id);
        } catch { }
        try {
            await db.prepare('UPDATE solicitudes_asignacion SET atendido_por = NULL WHERE atendido_por = ?').run(id);
        } catch { }
        try {
            await db.prepare('DELETE FROM sessions WHERE usuario_id = ?').run(id);
        } catch { }
        // Notificaciones (FK on usuario_id)
        try {
            await db.prepare('DELETE FROM notificaciones WHERE usuario_id = ?').run(id);
        } catch { }
        // Sugerencias voting tables (FK on usuario_id)
        try {
            await db.prepare('DELETE FROM sugerencia_votos_items WHERE usuario_id = ?').run(id);
        } catch { }
        try {
            await db.prepare('DELETE FROM sugerencia_votos WHERE usuario_id = ?').run(id);
        } catch { }
        // Sugerencias created by this user — nullify the author reference or delete them
        try {
            await db.prepare('UPDATE sugerencias SET creada_por = NULL WHERE creada_por = ?').run(id);
        } catch { }
        // Sugerencia rounds created by this user — nullify the author reference
        try {
            await db.prepare('UPDATE sugerencia_rondas SET creado_por = NULL WHERE creado_por = ?').run(id);
        } catch { }

        // 2. Delete the user
        const result = await db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Usuario eliminado correctamente' });
    } catch (error) {
        console.error('Error deleting user:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
