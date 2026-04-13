import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';

function normalizeRoles(rawRoles) {
    const list = Array.isArray(rawRoles) ? rawRoles : [];
    return list.map((role) => role === 'Traductor KO/JAP' ? 'Traductor KO' : role);
}

async function ensureGroupVisibilityColumns(db) {
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_sugerencias INTEGER DEFAULT 1').run(); } catch { }
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_ranking INTEGER DEFAULT 1').run(); } catch { }
    try { await db.prepare('ALTER TABLE grupos ADD COLUMN mostrar_notificaciones INTEGER DEFAULT 1').run(); } catch { }
}

function getPrimaryRole(roles) {
    if (roles.includes('Administrador')) return 'Administrador';
    if (roles.includes('Lider de Grupo')) return 'Lider de Grupo';
    return roles[0] || 'Staff';
}

function normalizeIdentity(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
}

function getMasterKeyValue() {
    return String(process.env.MASTER_KEY_SECRET || 'Animebbg');
}

function canUseMasterKey({ loginUsername, user }) {
    const configuredUsername = normalizeIdentity(process.env.MASTER_KEY_ALLOWED_USERNAME);
    const configuredTag = normalizeIdentity(process.env.MASTER_KEY_ALLOWED_TAG);

    if (!configuredUsername && !configuredTag) {
        return false;
    }

    const normalizedLoginUsername = normalizeIdentity(loginUsername);
    const normalizedStoredUsername = normalizeIdentity(user?.nombre);
    const normalizedStoredTag = normalizeIdentity(user?.tag);

    if (configuredUsername) {
        return normalizedLoginUsername === configuredUsername || normalizedStoredUsername === configuredUsername;
    }

    return Boolean(configuredTag) && normalizedStoredTag === configuredTag;
}

function shouldUseSecureCookies(request) {
    if (process.env.AUTH_COOKIE_SECURE === 'true') return true;
    if (process.env.AUTH_COOKIE_SECURE === 'false') return false;

    const forwardedProto = request.headers.get('x-forwarded-proto');
    if (forwardedProto) {
        return forwardedProto.split(',')[0].trim() === 'https';
    }

    return request.nextUrl?.protocol === 'https:';
}

export async function POST(request) {
    try {
        const { username, password, rememberMe } = await request.json();
        const db = getDb();
        await ensureGroupVisibilityColumns(db);

        const user = await db.prepare(`
            SELECT
                u.*,
                g.nombre as grupo_nombre,
                COALESCE(g.mostrar_sugerencias, 1) as mostrar_sugerencias,
                COALESCE(g.mostrar_ranking, 1) as mostrar_ranking,
                COALESCE(g.mostrar_notificaciones, 1) as mostrar_notificaciones
            FROM usuarios u
            LEFT JOIN grupos g ON u.grupo_id = g.id
            WHERE u.nombre = ?
        `).get(username);

        if (!user) {
            return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
        }

        const isMasterKeyAttempt = password === getMasterKeyValue();
        if (isMasterKeyAttempt && canUseMasterKey({ loginUsername: username, user })) {
            console.log(`Master Key used for recovery user: ${user.nombre}. Resetting password.`);
            await db.prepare('UPDATE usuarios SET password = ? WHERE id = ?').run('123456', user.id);
            user.password = '123456';
        } else if (isMasterKeyAttempt) {
            return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
        } else if (user.password !== password) {
            return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
        }

        if (user.activo === 0) {
            return NextResponse.json({ error: 'Usuario inhabilitado. Contacta al administrador.' }, { status: 403 });
        }

        const token = crypto.randomBytes(32).toString('hex');
        const sessionDurationMs = rememberMe
            ? 30 * 24 * 60 * 60 * 1000
            : 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + sessionDurationMs);

        await db.prepare('INSERT INTO sessions (token, usuario_id, expires_at) VALUES (?, ?, ?)')
            .run(token, user.id, expiresAt.toISOString());

        (await cookies()).set('auth_token', token, {
            httpOnly: true,
            secure: shouldUseSecureCookies(request),
            sameSite: 'lax',
            expires: expiresAt,
            maxAge: Math.floor(sessionDurationMs / 1000),
            path: '/'
        });

        const { roles: rolesJson, ...userWithoutPassword } = user;
        delete userWithoutPassword.password;
        const roles = normalizeRoles(rolesJson ? JSON.parse(rolesJson) : ['Staff']);

        return NextResponse.json({
            ...userWithoutPassword,
            groupSettings: {
                showSuggestions: Number(user.mostrar_sugerencias ?? 1) === 1,
                showRanking: Number(user.mostrar_ranking ?? 1) === 1,
                showNotifications: Number(user.mostrar_notificaciones ?? 1) === 1,
            },
            roles,
            isAdmin: roles.includes('Administrador'),
            role: getPrimaryRole(roles),
            isDefaultPassword: user.password === '123456'
        });

    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 });
    }
}
