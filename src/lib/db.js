import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables if not already loaded (e.g., in scripts)
// Note: Next.js loads .env automatically, but scripts might need this.
if (!process.env.TURSO_DATABASE_URL && fs.existsSync('.env')) {
  dotenv.config();
}

const isProd = process.env.NODE_ENV === 'production' || process.env.USE_TURSO === 'true';

let dbInstance = null;
let performanceIndexesEnsured = false;
let suggestionSchemaEnsured = false;
let assignmentGroupSnapshotEnsured = false;

export function getDb() {
  if (dbInstance) return dbInstance;

  if (isProd) {
    console.log('Initializing Turso DB connection...');
    if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
      console.error('ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for production/Turso usage.');
      // We don't throw immediately to allow build process to pass if env vars are missing at build time
      // but runtime will fail if accessed.
    }

    const client = createClient({
      url: process.env.TURSO_DATABASE_URL || 'libsql://placeholder-url', // Prevents crash on build
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    // Wrapper to match better-sqlite3 interface roughly
    // IMPORTANT: All consumers must now await their DB calls implicitly or explicitly.
    // However, better-sqlite3 is synchronous. The original app code is synchronous.
    // If we switch to Turso (async), we break the app unless we change all callers to async.
    //
    // STRATEGY: 
    // 1. For Vercel (Next.js), APIs are async handlers. We can make DB calls async there.
    // 2. But we need to update ALL route handlers to `await` the DB calls.
    //
    // This is a significant refactor. Alternatively, we check if better-sqlite3 works on Vercel?
    // No, Vercel is serverless/lambda, persistent local FS is not available. WE MUST USE CLOUD DB.
    //
    // So, the refactor to async is necessary for Vercel deployment.

    dbInstance = {
      prepare: (sql) => {
        return {
          get: async (...args) => {
            const rs = await client.execute({ sql, args });
            return rs.rows[0];
          },
          all: async (...args) => {
            const rs = await client.execute({ sql, args });
            return rs.rows; // Array of objects
          },
          run: async (...args) => {
            const rs = await client.execute({ sql, args });
            return { lastInsertRowid: rs.lastInsertRowid, changes: rs.rowsAffected };
          },
        };
      }
    };
    console.log('Connected to Turso/LibSQL');
  } else {
    const DB_PATH = path.join(process.cwd(), 'data', 'animebbg.db');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    console.log('Using Local SQLite:', DB_PATH);
    const db = new Database(DB_PATH); // Removed verbose logging to clear console
    db.pragma('journal_mode = WAL');

    // We wrap local DB to match the Async interface of Turso so dev environment matches prod behavior.
    // This forces us to fix code in dev before deploying.
    dbInstance = {
      prepare: (sql) => {
        const stmt = db.prepare(sql);
        return {
          get: async (...args) => stmt.get(...args),
          all: async (...args) => stmt.all(...args),
          run: async (...args) => stmt.run(...args),
        };
      },
      // Direct access if absolutely needed (try to avoid)
      _native: db
    };

    initTables(db);
  }

  return dbInstance;
}

export async function ensurePerformanceIndexes(db) {
  if (performanceIndexesEnsured || !db?.prepare) return;

  const statements = [
    `CREATE INDEX IF NOT EXISTS idx_sessions_token_expires ON sessions(token, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_grupo ON usuarios(grupo_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_fecha ON notificaciones(usuario_id, creado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_leida_fecha ON notificaciones(usuario_id, leida, creado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_asignaciones_usuario_estado ON asignaciones(usuario_id, estado)`,
    `CREATE INDEX IF NOT EXISTS idx_asignaciones_proyecto_capitulo_rol_estado ON asignaciones(proyecto_id, capitulo, rol, estado)`,
    `CREATE INDEX IF NOT EXISTS idx_asignaciones_usuario_fecha ON asignaciones(usuario_id, asignado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_asignaciones_grupo_snapshot_estado_fecha ON asignaciones(grupo_id_snapshot, estado, completado_en DESC, asignado_en DESC)`,
  ];

  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Ignore if a table or index is not available yet in the current environment.
    }
  }

  performanceIndexesEnsured = true;
}

export async function ensureSuggestionSchema(db) {
  if (suggestionSchemaEnsured || !db?.prepare) return;

  const statements = [
    `CREATE TABLE IF NOT EXISTS sugerencia_rondas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador', 'activa', 'pausada', 'cerrada')),
      grupo_id INTEGER REFERENCES grupos(id),
      creado_por INTEGER NOT NULL REFERENCES usuarios(id),
      iniciado_en DATETIME,
      pausado_en DATETIME,
      cerrado_en DATETIME,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sugerencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      titulo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      categoria TEXT,
      imagen_url TEXT,
      estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa', 'archivada')),
      creada_por INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sugerencia_votos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      sugerencia_id INTEGER NOT NULL REFERENCES sugerencias(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ronda_id, usuario_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sugerencia_votos_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      sugerencia_id INTEGER NOT NULL REFERENCES sugerencias(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ronda_id, sugerencia_id, usuario_id)
    )`,
    `CREATE TABLE IF NOT EXISTS sugerencias_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      ronda_actual_id INTEGER REFERENCES sugerencia_rondas(id),
      updated_by INTEGER REFERENCES usuarios(id),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencia_rondas_estado_grupo ON sugerencia_rondas(estado, grupo_id, creado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencias_ronda_estado ON sugerencias(ronda_id, estado, creado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_ronda ON sugerencia_votos(ronda_id, sugerencia_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_usuario ON sugerencia_votos(usuario_id, creado_en DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_items_ronda ON sugerencia_votos_items(ronda_id, sugerencia_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_items_usuario ON sugerencia_votos_items(usuario_id, creado_en DESC)`,
  ];

  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  const safeStatements = [
    `ALTER TABLE sugerencia_rondas ADD COLUMN descripcion TEXT`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN creado_por INTEGER REFERENCES usuarios(id)`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN iniciado_en DATETIME`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN pausado_en DATETIME`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN cerrado_en DATETIME`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN start_at DATETIME`,
    `ALTER TABLE sugerencia_rondas ADD COLUMN end_at DATETIME`,
    `ALTER TABLE sugerencias ADD COLUMN categoria TEXT`,
    `ALTER TABLE sugerencias ADD COLUMN imagen_url TEXT`,
    `ALTER TABLE sugerencias ADD COLUMN estado TEXT NOT NULL DEFAULT 'activa'`,
    `ALTER TABLE sugerencias ADD COLUMN creada_por INTEGER REFERENCES usuarios(id)`,
    `ALTER TABLE sugerencias ADD COLUMN url_publicacion TEXT`,
    `ALTER TABLE sugerencias ADD COLUMN sinopsis TEXT`,
    `ALTER TABLE sugerencias ADD COLUMN tipo_obra TEXT`,
    `ALTER TABLE sugerencias ADD COLUMN proyecto_exportado_id INTEGER REFERENCES proyectos(id)`,
  ];

  for (const sql of safeStatements) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Ignore duplicate-column errors when the schema already exists.
    }
  }

  await db.prepare(`
    INSERT OR IGNORE INTO sugerencia_votos_items (ronda_id, sugerencia_id, usuario_id, creado_en)
    SELECT ronda_id, sugerencia_id, usuario_id, creado_en
    FROM sugerencia_votos
  `).run();

  suggestionSchemaEnsured = true;
}

export async function ensureAssignmentGroupSnapshotSchema(db) {
  if (assignmentGroupSnapshotEnsured || !db?.prepare) return;

  const statements = [
    `ALTER TABLE asignaciones ADD COLUMN grupo_id_snapshot INTEGER REFERENCES grupos(id)`,
    `UPDATE asignaciones
      SET grupo_id_snapshot = (
        SELECT p.grupo_id
        FROM proyectos p
        WHERE p.id = asignaciones.proyecto_id
      )
      WHERE grupo_id_snapshot IS NULL
        AND proyecto_id IS NOT NULL`,
    `UPDATE asignaciones
      SET grupo_id_snapshot = (
        SELECT u.grupo_id
        FROM usuarios u
        WHERE u.id = asignaciones.usuario_id
      )
      WHERE grupo_id_snapshot IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_asignaciones_grupo_snapshot_estado_fecha ON asignaciones(grupo_id_snapshot, estado, completado_en DESC, asignado_en DESC)`,
  ];

  for (const sql of statements) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Ignore duplicate-column and transient schema errors.
    }
  }

  assignmentGroupSnapshotEnsured = true;
}

function initTables(db) {
  // We use the synchronous DB instance here because this runs once on startup/import
  // and better-sqlite3 is sync.

  db.exec(`
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
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      grupo_id INTEGER
    );
    `);

  // Migrations (simplified for readability, using Try-Catch for existing cols)
  const runSafe = (sql) => { try { db.prepare(sql).run(); } catch (e) { } };

  runSafe(`ALTER TABLE usuarios ADD COLUMN password TEXT`);
  runSafe(`ALTER TABLE usuarios ADD COLUMN roles TEXT`);
  runSafe(`UPDATE usuarios SET roles = REPLACE(roles, '"Traductor KO/JAP"', '"Traductor KO"') WHERE roles LIKE '%Traductor KO/JAP%'`);
  runSafe(`ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1`);
  runSafe(`ALTER TABLE usuarios ADD COLUMN avatar_url TEXT`);
  runSafe(`ALTER TABLE usuarios ADD COLUMN tag TEXT`);
  runSafe(`ALTER TABLE usuarios ADD COLUMN nombre_creditos TEXT`);
  runSafe(`UPDATE usuarios SET nombre_creditos = nombre WHERE nombre_creditos IS NULL OR TRIM(nombre_creditos) = ''`);
  runSafe(`UPDATE usuarios SET tag = LOWER(REPLACE(COALESCE(discord_username, nombre), ' ', '')) WHERE tag IS NULL OR TRIM(tag) = ''`);
  runSafe(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tag_unique ON usuarios(tag)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_usuarios_grupo ON usuarios(grupo_id)`);

  // Grupos
  db.exec(`
    CREATE TABLE IF NOT EXISTS grupos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      mostrar_sugerencias INTEGER DEFAULT 1,
      mostrar_ranking INTEGER DEFAULT 1,
      mostrar_notificaciones INTEGER DEFAULT 1,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    `);
  runSafe(`ALTER TABLE grupos ADD COLUMN mostrar_sugerencias INTEGER DEFAULT 1`);
  runSafe(`ALTER TABLE grupos ADD COLUMN mostrar_ranking INTEGER DEFAULT 1`);
  runSafe(`ALTER TABLE grupos ADD COLUMN mostrar_notificaciones INTEGER DEFAULT 1`);
  runSafe(`UPDATE grupos SET mostrar_sugerencias = 1 WHERE mostrar_sugerencias IS NULL`);
  runSafe(`UPDATE grupos SET mostrar_ranking = 1 WHERE mostrar_ranking IS NULL`);
  runSafe(`UPDATE grupos SET mostrar_notificaciones = 1 WHERE mostrar_notificaciones IS NULL`);

  // Default group
  const hasGroup = db.prepare('SELECT id FROM grupos WHERE nombre = ?').get('Grupo C-4');
  if (!hasGroup) {
    db.prepare('INSERT INTO grupos (nombre) VALUES (?)').run('Grupo C-4');
  }

  runSafe(`ALTER TABLE usuarios ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`);
  // Default existing users to group 1
  runSafe(`UPDATE usuarios SET grupo_id = 1 WHERE grupo_id IS NULL`);

  // Proyectos
  db.exec(`
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
      grupo_id INTEGER REFERENCES grupos(id)
    );
    `);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sessions_token_expires ON sessions(token, expires_at)`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN capitulos_catalogo TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN drive_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN raw_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN raw_eng_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN raw_secundario_activo INTEGER DEFAULT 0`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN traductor_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN redraw_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN typer_folder_id TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN fuentes_config TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN creditos_config TEXT`);
  runSafe(`ALTER TABLE proyectos ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`);
  runSafe(`UPDATE proyectos SET grupo_id = 1 WHERE grupo_id IS NULL`);

  // Asignaciones
  db.exec(`
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
      grupo_id_snapshot INTEGER REFERENCES grupos(id),
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    `);
  runSafe(`ALTER TABLE asignaciones ADD COLUMN drive_url TEXT`);
  runSafe(`ALTER TABLE asignaciones ADD COLUMN proyecto_id INTEGER`);
  runSafe(`ALTER TABLE asignaciones ADD COLUMN capitulo INTEGER`);
  runSafe(`ALTER TABLE asignaciones ADD COLUMN traductor_tipo TEXT CHECK(traductor_tipo IN ('CORE', 'ENG'))`);
  runSafe(`ALTER TABLE asignaciones ADD COLUMN grupo_id_snapshot INTEGER REFERENCES grupos(id)`);
  runSafe(`
    UPDATE asignaciones
    SET grupo_id_snapshot = (
      SELECT p.grupo_id
      FROM proyectos p
      WHERE p.id = asignaciones.proyecto_id
    )
    WHERE grupo_id_snapshot IS NULL
      AND proyecto_id IS NOT NULL
  `);
  runSafe(`
    UPDATE asignaciones
    SET grupo_id_snapshot = (
      SELECT u.grupo_id
      FROM usuarios u
      WHERE u.id = asignaciones.usuario_id
    )
    WHERE grupo_id_snapshot IS NULL
  `);

  // Informes & Sessions
  db.exec(`
    CREATE TABLE IF NOT EXISTS informes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asignacion_id INTEGER NOT NULL,
      mensaje TEXT NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asignacion_id) REFERENCES asignaciones(id)
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      usuario_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    );
    `);

  db.exec(`
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
  `);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_leida ON notificaciones(usuario_id, leida, creado_en)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario_fecha ON notificaciones(usuario_id, creado_en DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
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
  `);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_creditos_capitulo_proyecto ON creditos_capitulo(proyecto_id, capitulo)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_asignaciones_usuario_estado ON asignaciones(usuario_id, estado)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_asignaciones_proyecto_capitulo_rol_estado ON asignaciones(proyecto_id, capitulo, rol, estado)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_asignaciones_usuario_fecha ON asignaciones(usuario_id, asignado_en DESC)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_asignaciones_grupo_snapshot_estado_fecha ON asignaciones(grupo_id_snapshot, estado, completado_en DESC, asignado_en DESC)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sugerencia_rondas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL,
      descripcion TEXT,
      estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador', 'activa', 'pausada', 'cerrada')),
      grupo_id INTEGER REFERENCES grupos(id),
      creado_por INTEGER NOT NULL REFERENCES usuarios(id),
      iniciado_en DATETIME,
      pausado_en DATETIME,
      cerrado_en DATETIME,
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sugerencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      titulo TEXT NOT NULL,
      descripcion TEXT NOT NULL,
      categoria TEXT,
      imagen_url TEXT,
      estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa', 'archivada')),
      creada_por INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sugerencia_votos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      sugerencia_id INTEGER NOT NULL REFERENCES sugerencias(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ronda_id, usuario_id)
    );

    CREATE TABLE IF NOT EXISTS sugerencia_votos_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ronda_id INTEGER NOT NULL REFERENCES sugerencia_rondas(id),
      sugerencia_id INTEGER NOT NULL REFERENCES sugerencias(id),
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (ronda_id, sugerencia_id, usuario_id)
    );
  `);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN descripcion TEXT`);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN grupo_id INTEGER REFERENCES grupos(id)`);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN creado_por INTEGER REFERENCES usuarios(id)`);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN iniciado_en DATETIME`);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN pausado_en DATETIME`);
  runSafe(`ALTER TABLE sugerencia_rondas ADD COLUMN cerrado_en DATETIME`);
  runSafe(`ALTER TABLE sugerencias ADD COLUMN categoria TEXT`);
  runSafe(`ALTER TABLE sugerencias ADD COLUMN imagen_url TEXT`);
  runSafe(`ALTER TABLE sugerencias ADD COLUMN estado TEXT NOT NULL DEFAULT 'activa'`);
  runSafe(`ALTER TABLE sugerencias ADD COLUMN creada_por INTEGER REFERENCES usuarios(id)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencia_rondas_estado_grupo ON sugerencia_rondas(estado, grupo_id, creado_en DESC)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencias_ronda_estado ON sugerencias(ronda_id, estado, creado_en DESC)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_ronda ON sugerencia_votos(ronda_id, sugerencia_id)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_usuario ON sugerencia_votos(usuario_id, creado_en DESC)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_items_ronda ON sugerencia_votos_items(ronda_id, sugerencia_id)`);
  runSafe(`CREATE INDEX IF NOT EXISTS idx_sugerencia_votos_items_usuario ON sugerencia_votos_items(usuario_id, creado_en DESC)`);
  runSafe(`
    INSERT OR IGNORE INTO sugerencia_votos_items (ronda_id, sugerencia_id, usuario_id, creado_en)
    SELECT ronda_id, sugerencia_id, usuario_id, creado_en
    FROM sugerencia_votos
  `);
}
