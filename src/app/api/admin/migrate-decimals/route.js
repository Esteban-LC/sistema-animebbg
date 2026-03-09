import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token');

        if (!token) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        }

        const db = getDb();

        // Verify session and Admin role
        const session = await db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > datetime('now')").get(token.value);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const user = await db.prepare('SELECT roles FROM usuarios WHERE id = ?').get(session.usuario_id);
        const roles = user && user.roles ? JSON.parse(user.roles) : [];

        if (!roles.includes('Administrador')) {
            return NextResponse.json({ error: 'Requiere permisos de administrador' }, { status: 403 });
        }

        const logs = [];

        // Helper to log
        const log = (msg) => logs.push(msg);

        // 1. Migrate Proyectos
        log('Migrating proyectos...');

        // Check if decimals are already supported (simplified check)
        // actually we just force migration to be safe or checking schema is hard in sqlite/libsql safely without more query
        // We will rename old, create new with REAL, copy, drop old.

        await db.prepare('BEGIN TRANSACTION').run();

        try {
            // PROYECTOS
            // Rename current to old
            await db.prepare('ALTER TABLE proyectos RENAME TO proyectos_old').run();

            // Create new with REAL for capitulos
            await db.prepare(`
                CREATE TABLE proyectos (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  titulo TEXT NOT NULL,
                  tipo TEXT NOT NULL,
                  genero TEXT,
                  capitulos_actuales REAL DEFAULT 0,
                  capitulos_totales REAL,
                  capitulos_catalogo TEXT,
                  estado TEXT DEFAULT 'Activo',
                  ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                  imagen_url TEXT,
                  frecuencia TEXT,
                  grupo_id INTEGER
                )
            `).run();

            // Copy data
            await db.prepare(`
                INSERT INTO proyectos (id, titulo, tipo, genero, capitulos_actuales, capitulos_totales, capitulos_catalogo, estado, ultima_actualizacion, imagen_url, frecuencia, grupo_id)
                SELECT id, titulo, tipo, genero, capitulos_actuales, capitulos_totales, NULL, estado, ultima_actualizacion, imagen_url, frecuencia, grupo_id
                FROM proyectos_old
            `).run();

            // Drop old
            await db.prepare('DROP TABLE proyectos_old').run();
            log('Proyectos migrated successfully.');

            // ASIGNACIONES
            log('Migrating asignaciones...');
            await db.prepare('ALTER TABLE asignaciones RENAME TO asignaciones_old').run();

            // Create new with REAL for capitulo AND ensure constraints are kept
            // Note: DB.js defines check constraints? We should keep them.
            // Original: 
            // rol TEXT NOT NULL CHECK(rol IN ('Traductor', 'Redrawer', 'Typer')),
            // estado TEXT DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente', 'En Proceso', 'Completado')),

            await db.prepare(`
                CREATE TABLE asignaciones (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  usuario_id INTEGER NOT NULL,
                  rol TEXT NOT NULL CHECK(rol IN ('Traductor', 'Redrawer', 'Typer')),
                  descripcion TEXT NOT NULL,
                  estado TEXT DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente', 'En Proceso', 'Completado')),
                  asignado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                  completado_en DATETIME,
                  informe TEXT,
                  drive_url TEXT,
                  proyecto_id INTEGER,
                  capitulo REAL,
                  FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
                )
            `).run();

            // Copy data
            await db.prepare(`
                INSERT INTO asignaciones (id, usuario_id, rol, descripcion, estado, asignado_en, completado_en, informe, drive_url, proyecto_id, capitulo)
                SELECT id, usuario_id, rol, descripcion, estado, asignado_en, completado_en, informe, drive_url, proyecto_id, capitulo
                FROM asignaciones_old
            `).run();

            await db.prepare('DROP TABLE asignaciones_old').run();
            log('Asignaciones migrated successfully.');

            await db.prepare('COMMIT').run();

        } catch (e) {
            await db.prepare('ROLLBACK').run();
            throw e;
        }

        return NextResponse.json({ message: 'Migration successful', logs });
    } catch (error) {
        console.error('Migration error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
