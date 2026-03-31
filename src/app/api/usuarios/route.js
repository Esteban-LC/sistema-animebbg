import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

import { cookies } from 'next/headers';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

function normalizeRoles(rawRoles) {
    const list = Array.isArray(rawRoles) ? rawRoles : [];
    return list.map((role) => role === 'Traductor KO/JAP' ? 'Traductor KO' : role);
}

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
        } catch {
            // verify below
        }
    }

    const hasNombreCreditos = await hasUsuariosColumn(db, 'nombre_creditos');
    if (!hasNombreCreditos) {
        try {
            await db.prepare('ALTER TABLE usuarios ADD COLUMN nombre_creditos TEXT').run();
        } catch {
            // verify below
        }
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

export async function GET() {
    try {
        const db = getDb();
        await ensureUsuariosCreditosColumns(db);
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;
        console.log('DEBUG USERS API: Token received:', token ? token.substring(0, 10) + '...' : 'NONE');

        let groupId = null;
        let isAdmin = false;

        if (token) {
            console.log('DEBUG USERS API: Validating token...');
            const session = await db.prepare(`
                SELECT u.roles, u.grupo_id 
                FROM sessions s
                JOIN usuarios u ON s.usuario_id = u.id
                WHERE s.token = ? AND s.expires_at > datetime('now')
            `).get(token);

            if (session) {
                console.log('DEBUG USERS API: Session Found', session);
                try {
                    const roles = JSON.parse(session.roles || '[]');
                    console.log('DEBUG USERS API: Parsed Roles', roles);

                    isAdmin = roles.includes('Administrador');
                    groupId = session.grupo_id;

                    console.log(`DEBUG USERS API: isAdmin=${isAdmin}, groupId=${groupId}`);
                } catch (e) {
                    console.error('DEBUG USERS API: Role parse error', e);
                }
            } else {
                console.log('DEBUG USERS API: No Session found for token', token);
            }
        }

        let query = `
            SELECT u.*, g.nombre as grupo_nombre 
            FROM usuarios u
            LEFT JOIN grupos g ON u.grupo_id = g.id
        `;
        const params = [];

        if (isAdmin) {
            // Admin sees all
        } else if (groupId) {
            query += ' WHERE u.grupo_id = ?';
            params.push(groupId);
        } else {
            // Non-admin without group -> See NOTHING
            return NextResponse.json([]);
        }

        query += ' ORDER BY u.nombre';

        const usuarios = await db.prepare(query).all(...params);

        const usuariosWithRoles = usuarios.map(u => ({
            ...u,
            roles: normalizeRoles(u.roles ? JSON.parse(u.roles) : [])
        }));

        return NextResponse.json(usuariosWithRoles);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { nombre, discord_username, roles, grupo_id, tag, nombre_creditos } = await request.json();
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

        const normalizedTag = normalizeTag(tag || discord_username || nombre);
        if (!normalizedTag) {
            return NextResponse.json({ error: 'Tag invalido' }, { status: 400 });
        }

        const tagInUse = await db.prepare('SELECT id FROM usuarios WHERE LOWER(tag) = LOWER(?) LIMIT 1').get(normalizedTag);
        if (tagInUse) {
            return NextResponse.json({ error: 'El tag ya esta en uso' }, { status: 409 });
        }

        const stmt = db.prepare(`
            INSERT INTO usuarios (nombre, discord_username, roles, grupo_id, password, tag, nombre_creditos)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // Default password for new users: 123456
        // Default to Group 1 if not specified
        const allowedRoles = normalizeRoles(roles || ['Staff']);
        const finalGrupoId = grupo_id || 1;
        if (!finalGrupoId) {
            return NextResponse.json({ error: 'Grupo invalido' }, { status: 400 });
        }

        const creditsName = String(nombre_creditos || '').trim() || String(nombre || '').trim();
        const result = await stmt.run(
            nombre,
            discord_username || null,
            JSON.stringify(allowedRoles),
            finalGrupoId,
            '123456',
            normalizedTag,
            creditsName
        );

        return NextResponse.json({
            id: result.lastInsertRowid,
            nombre,
            discord_username,
            roles: allowedRoles,
            grupo_id: finalGrupoId,
            tag: normalizedTag,
            nombre_creditos: creditsName,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
