import { createClient } from '@libsql/client';
import Database from 'better-sqlite3';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env file
// Load .env or .env.local file
const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

console.log('📂 Current Working Directory:', process.cwd());
console.log('🔎 Looking for .env at:', envPath);
console.log('🔎 Looking for .env.local at:', envLocalPath);

if (fs.existsSync(envLocalPath)) {
    console.log('✅ Found .env.local');
    dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
    console.log('✅ Found .env');
    dotenv.config();
} else {
    console.error('❌ .env file NOT found!');
}

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL || !TURSO_TOKEN) {
    console.error('❌ Error: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required in .env');
    process.exit(1);
}

const LOCAL_DB_PATH = path.join(process.cwd(), 'data', 'animebbg.db');

if (!fs.existsSync(LOCAL_DB_PATH)) {
    console.error(`❌ Error: Local database not found at ${LOCAL_DB_PATH}`);
    process.exit(1);
}

console.log(`📂 Opening local database: ${LOCAL_DB_PATH}`);
const localDb = new Database(LOCAL_DB_PATH);

console.log(`☁️ Connecting to Turso/LibSQL: ${TURSO_URL}`);
const client = createClient({
    url: TURSO_URL,
    authToken: TURSO_TOKEN,
});

async function migrate() {
    try {
        console.log('🚀 Starting migration...');

        // 1. Reset Database (DROP & CREATE)
        console.log('🔥 Resetting Turso Database (DROP & CREATE)...');

        // We perform a batch that Drops and then Creates to ensure clean state
        await client.batch([
            // Drop old tables (Order varies due to FK, but IF EXISTS helps)
            // Ideally drop child first
            `DROP TABLE IF EXISTS informes`,
            `DROP TABLE IF EXISTS notificaciones`,
            `DROP TABLE IF EXISTS asignaciones`,
            `DROP TABLE IF EXISTS projects`, // Name typo check? It was proyectos
            `DROP TABLE IF EXISTS proyectos`,
            `DROP TABLE IF EXISTS sessions`,
            `DROP TABLE IF EXISTS creditos_capitulo`,
            `DROP TABLE IF EXISTS app_settings`,
            `DROP TABLE IF EXISTS usuarios`,
            `DROP TABLE IF EXISTS grupos`,

            // Create Tables
            // Usuarios
            `CREATE TABLE usuarios (
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
            )`,
            // Grupos
            `CREATE TABLE grupos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nombre TEXT NOT NULL UNIQUE,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // Proyectos
            `CREATE TABLE proyectos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                titulo TEXT NOT NULL,
                tipo TEXT NOT NULL,
                genero TEXT,
                capitulos_actuales INTEGER DEFAULT 0,
                capitulos_totales INTEGER,
                creditos_config TEXT,
                estado TEXT DEFAULT 'Activo',
                ultima_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
                imagen_url TEXT,
                frecuencia TEXT,
                grupo_id INTEGER REFERENCES grupos(id)
            )`,
            // Asignaciones
            `CREATE TABLE asignaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                rol TEXT NOT NULL CHECK(rol IN ('Traductor', 'Redrawer', 'Typer')),
                descripcion TEXT NOT NULL,
                estado TEXT DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente', 'En Proceso', 'Completado')),
                asignado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
                completado_en DATETIME,
                informe TEXT,
                drive_url TEXT,
                proyecto_id INTEGER,
                capitulo INTEGER
            )`,
            // Informes
            `CREATE TABLE informes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asignacion_id INTEGER NOT NULL REFERENCES asignaciones(id),
                mensaje TEXT NOT NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE notificaciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                tipo TEXT NOT NULL,
                titulo TEXT NOT NULL,
                mensaje TEXT NOT NULL,
                data_json TEXT,
                leida INTEGER DEFAULT 0,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            // Sessions
            `CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
                expires_at DATETIME NOT NULL,
                creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE creditos_capitulo (
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
            )`,
            `CREATE INDEX idx_sessions_token_expires ON sessions(token, expires_at)`,
            `CREATE INDEX idx_usuarios_grupo ON usuarios(grupo_id)`,
            `CREATE INDEX idx_notificaciones_usuario_fecha ON notificaciones(usuario_id, creado_en DESC)`,
            `CREATE INDEX idx_notificaciones_usuario_leida_fecha ON notificaciones(usuario_id, leida, creado_en DESC)`,
            `CREATE INDEX idx_asignaciones_usuario_estado ON asignaciones(usuario_id, estado)`,
            `CREATE INDEX idx_asignaciones_proyecto_capitulo_rol_estado ON asignaciones(proyecto_id, capitulo, rol, estado)`,
            `CREATE INDEX idx_asignaciones_usuario_fecha ON asignaciones(usuario_id, asignado_en DESC)`
        ], 'write');
        console.log('✅ Schema Reset successfully.');

        // 1.5 Clear existing data in Turso (Optional: ensure clean state)
        console.log('🧹 Clearing existing data in Turso...');
        try {
            await client.execute('DELETE FROM informes');
            await client.execute('DELETE FROM notificaciones');
            await client.execute('DELETE FROM asignaciones');
            await client.execute('DELETE FROM proyectos');
            await client.execute('DELETE FROM users_temp_table'); // Dummy if needed
            // Careful with users if we want to keep some, but here we want to mirror local
            await client.execute('DELETE FROM sessions');
            await client.execute('DELETE FROM usuarios');
            await client.execute('DELETE FROM grupos');
            await client.execute('DELETE FROM creditos_capitulo');
            await client.execute('DELETE FROM app_settings');
        } catch (e) {
            console.log('⚠️ Note: Some tables might not exist yet, ignoring delete errors.');
        }

        // 2. Data Migration
        // We'll read specific tables and bulk insert them.

        // --- MIGRATING GRUPOS ---
        const grupos = localDb.prepare('SELECT * FROM grupos').all();
        console.log(`📦 Migrating ${grupos.length} grupos...`);
        for (const g of grupos) {
            await client.execute({
                sql: 'INSERT INTO grupos (id, nombre, creado_en) VALUES (?, ?, ?)',
                args: [g.id, g.nombre, g.creado_en]
            });
        }

        // --- MIGRATING USUARIOS ---
        const usuarios = localDb.prepare('SELECT * FROM usuarios').all();
        console.log(`📦 Migrating ${usuarios.length} usuarios...`);
        for (const u of usuarios) {
            await client.execute({
                sql: `INSERT INTO usuarios (id, nombre, tag, nombre_creditos, discord_username, password, roles, activo, avatar_url, creado_en, grupo_id) 
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [u.id, u.nombre, u.tag, u.nombre_creditos, u.discord_username, u.password, u.roles, u.activo, u.avatar_url, u.creado_en, u.grupo_id]
            });
        }

        // --- MIGRATING PROYECTOS ---
        const proyectos = localDb.prepare('SELECT * FROM proyectos').all();
        console.log(`📦 Migrating ${proyectos.length} proyectos...`);
        for (const p of proyectos) {
            await client.execute({
                sql: `INSERT INTO proyectos (id, titulo, tipo, genero, capitulos_actuales, capitulos_totales, creditos_config, estado, ultima_actualizacion, imagen_url, frecuencia, grupo_id)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [p.id, p.titulo, p.tipo, p.genero, p.capitulos_actuales, p.capitulos_totales, p.creditos_config, p.estado, p.ultima_actualizacion, p.imagen_url, p.frecuencia, p.grupo_id]
            });
        }

        // --- MIGRATING ASIGNACIONES ---
        const asignaciones = localDb.prepare('SELECT * FROM asignaciones').all();
        console.log(`📦 Migrating ${asignaciones.length} asignaciones...`);
        for (const a of asignaciones) {
            await client.execute({
                sql: `INSERT INTO asignaciones (id, usuario_id, rol, descripcion, estado, asignado_en, completado_en, informe, drive_url, proyecto_id, capitulo)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [a.id, a.usuario_id, a.rol, a.descripcion, a.estado, a.asignado_en, a.completado_en, a.informe, a.drive_url, a.proyecto_id, a.capitulo]
            });
        }

        // --- MIGRATING CREDITOS CAPITULO ---
        const creditosCapitulo = localDb.prepare('SELECT * FROM creditos_capitulo').all();
        console.log(`📦 Migrating ${creditosCapitulo.length} creditos_capitulo...`);
        for (const c of creditosCapitulo) {
            await client.execute({
                sql: `INSERT INTO creditos_capitulo (
                        proyecto_id, capitulo, traductor_tag, typer_tag, cleaner_tag,
                        traductor_alias, typer_alias, cleaner_alias, actualizado_en
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                    c.proyecto_id,
                    c.capitulo,
                    c.traductor_tag,
                    c.typer_tag,
                    c.cleaner_tag,
                    c.traductor_alias,
                    c.typer_alias,
                    c.cleaner_alias,
                    c.actualizado_en
                ]
            });
        }

        // --- MIGRATING APP SETTINGS ---
        let appSettings = [];
        try {
            appSettings = localDb.prepare('SELECT * FROM app_settings').all();
        } catch {
            appSettings = [];
        }
        console.log(`📦 Migrating ${appSettings.length} app_settings...`);
        for (const s of appSettings) {
            await client.execute({
                sql: `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`,
                args: [s.key, s.value, s.updated_at]
            });
        }

        // --- MIGRATING NOTIFICACIONES ---
        let notificaciones = [];
        try {
            notificaciones = localDb.prepare('SELECT * FROM notificaciones').all();
        } catch {
            notificaciones = [];
        }
        console.log(`📦 Migrating ${notificaciones.length} notificaciones...`);
        for (const n of notificaciones) {
            await client.execute({
                sql: `INSERT INTO notificaciones (id, usuario_id, tipo, titulo, mensaje, data_json, leida, creado_en)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [n.id, n.usuario_id, n.tipo, n.titulo, n.mensaje, n.data_json, n.leida, n.creado_en]
            });
        }

        console.log('🎉 Migration completed successfully!');

    } catch (e) {
        console.error('❌ Migration failed:', e);
    } finally {
        localDb.close();
    }
}

migrate();
