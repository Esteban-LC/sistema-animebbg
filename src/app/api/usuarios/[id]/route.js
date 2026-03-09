import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

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
        const { nombre, roles, grupo_id, activo, avatar_url, tag, nombre_creditos } = body;
        const db = getDb();
        await ensureUsuariosCreditosColumns(db);

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

        // 1. Delete associated data first to avoid FK constraints (or logical orphans)

        // Delete reports from assignments belonging to this user
        await db.prepare(`
            DELETE FROM informes 
            WHERE asignacion_id IN (SELECT id FROM asignaciones WHERE usuario_id = ?)
        `).run(id);

        // Delete assignments
        await db.prepare('DELETE FROM asignaciones WHERE usuario_id = ?').run(id);

        // Delete sessions
        await db.prepare('DELETE FROM sessions WHERE usuario_id = ?').run(id);

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
