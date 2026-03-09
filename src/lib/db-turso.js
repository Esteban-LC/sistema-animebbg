import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables if not already loaded
if (!process.env.TURSO_DATABASE_URL && fs.existsSync('.env')) {
    dotenv.config();
}

const isProd = process.env.NODE_ENV === 'production' || process.env.USE_TURSO === 'true';

let dbInstance = null;

export function getDb() {
    if (dbInstance) return dbInstance;

    if (isProd) {
        if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
            console.warn('Warning: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing in production mode.');
        }

        const client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        console.log('Using Turso DB');

        // Wrapper to match better-sqlite3 synchronous interface with async implementation
        // NOTE: This requires all DB calls in the app to be awaited if they weren't already.
        // However, better-sqlite3 is sync, so we might need a sync wrapper or change app logic.
        // Given Next.js Server Actions/APIs are async, we should be fine if we await correctly.
        dbInstance = {
            prepare: (sql) => ({
                get: async (...args) => {
                    const rs = await client.execute({ sql, args });
                    return rs.rows[0];
                },
                all: async (...args) => {
                    const rs = await client.execute({ sql, args });
                    return rs.rows;
                },
                run: async (...args) => {
                    const rs = await client.execute({ sql, args });
                    return { lastInsertRowid: rs.lastInsertRowid, changes: rs.rowsAffected };
                }
            })
        };
    } else {
        const DB_PATH = path.join(process.cwd(), 'data', 'animebbg.db');
        const dir = path.dirname(DB_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        console.log('Using Local SQLite:', DB_PATH);
        const db = new Database(DB_PATH, { verbose: console.log });
        db.pragma('journal_mode = WAL');

        // Sync implementation for local dev (compatible with better-sqlite3)
        // allows us to keep using better-sqlite3 features if needed
        dbInstance = db;

        initTables(db);
    }

    return dbInstance;
}

function initTables(db) {
    db.prepare(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      tag TEXT,
      nombre_creditos TEXT,
      discord_username TEXT,
      password TEXT,
      roles TEXT,
      activo INTEGER DEFAULT 1,
      avatar_url TEXT,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

    // Migración: Agregar columnas si no existen (mismo logic de db.js original)
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN password TEXT`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET password = '123456' WHERE password IS NULL`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN roles TEXT`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET roles = REPLACE(roles, '"Traductor KO/JAP"', '"Traductor KO"') WHERE roles LIKE '%Traductor KO/JAP%'`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET roles = '["Staff"]' WHERE roles IS NULL`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN avatar_url TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN tag TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN nombre_creditos TEXT`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET nombre_creditos = nombre WHERE nombre_creditos IS NULL OR TRIM(nombre_creditos) = ''`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET tag = LOWER(REPLACE(COALESCE(discord_username, nombre), ' ', '')) WHERE tag IS NULL OR TRIM(tag) = ''`).run(); } catch (e) { }
    try { db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tag_unique ON usuarios(tag)`).run(); } catch (e) { }

    db.prepare(`
    CREATE TABLE IF NOT EXISTS asignaciones (
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
	      capitulo INTEGER,
	      traductor_tipo TEXT CHECK(traductor_tipo IN ('CORE', 'ENG')),
	      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
	    );
	  `).run();

	    try { db.prepare(`ALTER TABLE asignaciones ADD COLUMN drive_url TEXT`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE asignaciones ADD COLUMN proyecto_id INTEGER`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE asignaciones ADD COLUMN capitulo INTEGER`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE asignaciones ADD COLUMN traductor_tipo TEXT CHECK(traductor_tipo IN ('CORE', 'ENG'))`).run(); } catch (e) { }

    db.prepare(`
    CREATE TABLE IF NOT EXISTS informes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asignacion_id INTEGER NOT NULL,
      mensaje TEXT NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id)
    );
  `).run();

    db.prepare(`
    CREATE TABLE IF NOT EXISTS proyectos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      tipo TEXT NOT NULL,
      genero TEXT,
      capitulos_actuales INTEGER DEFAULT 0,
      capitulos_totales INTEGER,
	      capitulos_catalogo TEXT,
	      drive_folder_id TEXT,
	      raw_folder_id TEXT,
	      raw_eng_folder_id TEXT,
	      raw_secundario_activo INTEGER DEFAULT 0,
	      traductor_folder_id TEXT,
	      redraw_folder_id TEXT,
	      typer_folder_id TEXT,
	      fuentes_config TEXT,
          creditos_config TEXT,
      estado TEXT DEFAULT 'Activo',
      ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      imagen_url TEXT,
      frecuencia TEXT,
      grupo_id INTEGER
    );
  `).run();

    db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      usuario_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
  `).run();

    db.prepare(`
    CREATE TABLE IF NOT EXISTS notificaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      data_json TEXT,
      leida INTEGER DEFAULT 0,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
  `).run();
    try { db.prepare(`CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_leida ON notificaciones(usuario_id, leida, creado_en)`).run(); } catch (e) { }

    db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

    db.prepare(`
    CREATE TABLE IF NOT EXISTS creditos_capitulo (
      proyecto_id INTEGER NOT NULL,
      capitulo REAL NOT NULL,
      traductor_tag TEXT,
      typer_tag TEXT,
      cleaner_tag TEXT,
      traductor_alias TEXT,
      typer_alias TEXT,
      cleaner_alias TEXT,
      actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (proyecto_id, capitulo),
      FOREIGN KEY (proyecto_id) REFERENCES proyectos(id)
    );
  `).run();
    try { db.prepare(`CREATE INDEX IF NOT EXISTS idx_creditos_capitulo_proyecto ON creditos_capitulo(proyecto_id, capitulo)`).run(); } catch (e) { }

    db.prepare(`
    CREATE TABLE IF NOT EXISTS grupos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

    // Default Group
    try {
        const defaultGroup = db.prepare('SELECT * FROM grupos WHERE nombre = ?').get('Grupo C-4');
        if (!defaultGroup) {
            db.prepare('INSERT INTO grupos (nombre) VALUES (?)').run('Grupo C-4');
        }
    } catch (e) { }

    try { db.prepare(`ALTER TABLE usuarios ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`).run(); } catch (e) { }
    try { db.prepare(`UPDATE usuarios SET grupo_id = 1 WHERE grupo_id IS NULL`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN capitulos_catalogo TEXT`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN drive_folder_id TEXT`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN raw_folder_id TEXT`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN raw_eng_folder_id TEXT`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN raw_secundario_activo INTEGER DEFAULT 0`).run(); } catch (e) { }
	    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN traductor_folder_id TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN redraw_folder_id TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN typer_folder_id TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN fuentes_config TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN creditos_config TEXT`).run(); } catch (e) { }
    try { db.prepare(`ALTER TABLE proyectos ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`).run(); } catch (e) { }
    try { db.prepare(`UPDATE proyectos SET grupo_id = 1 WHERE grupo_id IS NULL`).run(); } catch (e) { }
}
