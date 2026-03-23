import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { catalogFromRoleFolderIds } from '@/lib/google-drive';
import { normalizeCatalogEntries } from '@/lib/project-catalog';
import { publishProjectEvent } from '@/lib/realtime';

export const dynamic = 'force-dynamic';

import { cookies } from 'next/headers';

function normalizeTitleKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isPotentialDuplicateTitle(a, b) {
    const left = normalizeTitleKey(a);
    const right = normalizeTitleKey(b);
    if (!left || !right) return false;
    if (left === right) return true;

    const shortest = left.length <= right.length ? left : right;
    const longest = left.length > right.length ? left : right;
    if (shortest.length < 12) return false;
    return longest.includes(shortest);
}

function normalizeProjectStatus(value) {
    return String(value || '').trim().toLowerCase();
}

function getProjectStatusOrderCaseSql(alias = 'p') {
    return `
        CASE
            WHEN LOWER(TRIM(COALESCE(${alias}.estado, 'Activo'))) = 'activo' THEN 1
            WHEN LOWER(TRIM(COALESCE(${alias}.estado, 'Activo'))) = 'pausado' THEN 2
            WHEN LOWER(TRIM(COALESCE(${alias}.estado, 'Activo'))) = 'finalizado' THEN 3
            WHEN LOWER(TRIM(COALESCE(${alias}.estado, 'Activo'))) = 'cancelado' THEN 4
            ELSE 5
        END
    `;
}

function extractFolderId(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';
    if (!value.includes('http')) return value;
    try {
        const url = new URL(value);
        const path = String(url.pathname || '');
        const match = path.match(/\/drive\/folders\/([^/?#]+)/i);
        if (match?.[1]) return String(match[1]).trim();
        const id = url.searchParams.get('id');
        return String(id || '').trim();
    } catch {
        return '';
    }
}

async function autoSyncProjectRoleFolders(db, proyectoId) {
    const proyecto = await db.prepare(`
        SELECT id, titulo, raw_folder_id, raw_eng_folder_id, traductor_folder_id, redraw_folder_id, typer_folder_id
        FROM proyectos
        WHERE id = ?
    `).get(proyectoId);
    if (!proyecto) return;

    const roleFolders = {
        raw: extractFolderId(proyecto.raw_folder_id),
        raw_eng: extractFolderId(proyecto.raw_eng_folder_id),
        traductor: extractFolderId(proyecto.traductor_folder_id),
        redraw: extractFolderId(proyecto.redraw_folder_id),
        typer: extractFolderId(proyecto.typer_folder_id),
    };
    const hasAnyRoleFolder = Object.values(roleFolders).some((v) => Boolean(v));
    if (!hasAnyRoleFolder) return;

    const scan = await catalogFromRoleFolderIds(roleFolders);
    const catalog = normalizeCatalogEntries(scan?.catalog || []);
    const maxChapter = catalog.length > 0 ? Number(catalog[catalog.length - 1].numero) : null;

    await db.prepare(`
        UPDATE proyectos
        SET raw_folder_id = ?,
            raw_eng_folder_id = ?,
            traductor_folder_id = ?,
            redraw_folder_id = ?,
            typer_folder_id = ?,
            drive_folder_id = COALESCE(NULLIF(TRIM(drive_folder_id), ''), ?),
            capitulos_catalogo = ?,
            capitulos_totales = COALESCE(?, capitulos_totales),
            ultima_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        roleFolders.raw || null,
        roleFolders.raw_eng || null,
        roleFolders.traductor || null,
        roleFolders.redraw || null,
        roleFolders.typer || null,
        roleFolders.raw || roleFolders.raw_eng || roleFolders.traductor || roleFolders.redraw || roleFolders.typer || null,
        JSON.stringify(catalog),
        maxChapter,
        proyectoId
    );
}

async function findPotentialDuplicateProject(db, title) {
    const allProjects = await db.prepare('SELECT id, titulo FROM proyectos').all();
    return allProjects.find((row) => isPotentialDuplicateTitle(row.titulo, title)) || null;
}

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const chapterMap = new Map();

    for (const value of rawCatalog) {
        let numero = null;
        let url = '';
        let raw_eng_url = '';
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            numero = Number(value.numero);
            url = typeof value.url === 'string' ? value.url.trim() : '';
            raw_eng_url = typeof value.raw_eng_url === 'string' ? value.raw_eng_url.trim() : '';
            traductor_url = typeof value.traductor_url === 'string' ? value.traductor_url.trim() : '';
            redraw_url = typeof value.redraw_url === 'string' ? value.redraw_url.trim() : '';
            typer_url = typeof value.typer_url === 'string' ? value.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = chapterMap.get(numero);
        if (!existing) {
            chapterMap.set(numero, { numero, url, raw_eng_url, traductor_url, redraw_url, typer_url });
            continue;
        }

        chapterMap.set(numero, {
            numero,
            url: existing.url || url,
            raw_eng_url: existing.raw_eng_url || raw_eng_url,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...chapterMap.values()].sort((a, b) => a.numero - b.numero);
}

function normalizeFontsConfigPayload(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value === 'object') return JSON.stringify(value);
    return null;
}

function normalizeCreditosConfigPayload(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value === 'object') return JSON.stringify(value);
    return null;
}

async function hasCatalogColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'capitulos_catalogo');
    } catch {
        return false;
    }
}

async function hasFontsConfigColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'fuentes_config');
    } catch {
        return false;
    }
}

async function hasCreditosConfigColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'creditos_config');
    } catch {
        return false;
    }
}

async function hasDriveFolderColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'drive_folder_id');
    } catch {
        return false;
    }
}

async function hasRoleFolderColumns(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        if (!Array.isArray(tableInfo)) return false;
        const names = new Set(tableInfo.map((col) => col?.name));
        return names.has('raw_folder_id')
            && names.has('raw_eng_folder_id')
            && names.has('traductor_folder_id')
            && names.has('redraw_folder_id')
            && names.has('typer_folder_id');
    } catch {
        return false;
    }
}

async function hasSecondaryRawColumn(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === 'raw_secundario_activo');
    } catch {
        return false;
    }
}

async function ensureDriveFolderColumn(db) {
    const exists = await hasDriveFolderColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN drive_folder_id TEXT`).run();
    } catch {
        // Ignore and verify again below.
    }
    return hasDriveFolderColumn(db);
}

async function ensureRoleFolderColumns(db) {
    const columns = [
        ['raw_folder_id', 'raw_folder_id TEXT'],
        ['raw_eng_folder_id', 'raw_eng_folder_id TEXT'],
        ['traductor_folder_id', 'traductor_folder_id TEXT'],
        ['redraw_folder_id', 'redraw_folder_id TEXT'],
        ['typer_folder_id', 'typer_folder_id TEXT'],
    ];

    for (const [name, sql] of columns) {
        try {
            const tableInfo = await db.prepare(`PRAGMA table_info(proyectos)`).all();
            const exists = Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === name);
            if (!exists) {
                await db.prepare(`ALTER TABLE proyectos ADD COLUMN ${sql}`).run();
            }
        } catch {
            // Ignore and verify below.
        }
    }

    return hasRoleFolderColumns(db);
}

async function ensureCatalogColumn(db) {
    const exists = await hasCatalogColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN capitulos_catalogo TEXT`).run();
    } catch {
        // Ignore and verify again below.
    }
    return hasCatalogColumn(db);
}

async function ensureSecondaryRawColumn(db) {
    const exists = await hasSecondaryRawColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN raw_secundario_activo INTEGER DEFAULT 0`).run();
    } catch {
        // Ignore and verify again below.
    }
    return hasSecondaryRawColumn(db);
}

async function ensureFontsConfigColumn(db) {
    const exists = await hasFontsConfigColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN fuentes_config TEXT`).run();
    } catch {
        // Ignore and verify again below.
    }
    return hasFontsConfigColumn(db);
}

async function ensureCreditosConfigColumn(db) {
    const exists = await hasCreditosConfigColumn(db);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN creditos_config TEXT`).run();
    } catch {
        // Ignore and verify again below.
    }
    return hasCreditosConfigColumn(db);
}

export async function GET() {
    try {
        const db = await getDb();
        const hasCatalog = await hasCatalogColumn(db);
        const hasDriveFolder = await hasDriveFolderColumn(db);
        const hasRoleFolders = await hasRoleFolderColumns(db);
        const hasSecondaryRaw = await hasSecondaryRawColumn(db);
        const hasFontsConfig = await hasFontsConfigColumn(db);
        const hasCreditosConfig = await hasCreditosConfigColumn(db);
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        let groupId = null;
        let isAdmin = false;

        if (token) {
            const session = await db.prepare(`
                SELECT u.roles, u.grupo_id 
                FROM sessions s
                JOIN usuarios u ON s.usuario_id = u.id
                WHERE s.token = ? AND s.expires_at > datetime('now')
            `).get(token);

            if (session) {
                const roles = JSON.parse(session.roles || '[]');
                isAdmin = roles.includes('Administrador');
                // Always get group_id if available, regardless of role
                groupId = session.grupo_id;
            }
        }

        let query = `
            SELECT 
                p.id,
                p.titulo,
                p.tipo,
                p.genero,
                COALESCE(ac.capitulo_completado, 0) AS capitulos_actuales,
                p.capitulos_totales,
                ${hasCatalog ? 'p.capitulos_catalogo,' : 'NULL as capitulos_catalogo,'}
                ${hasDriveFolder ? 'p.drive_folder_id,' : 'NULL as drive_folder_id,'}
                ${hasRoleFolders ? 'p.raw_folder_id,' : 'NULL as raw_folder_id,'}
                ${hasRoleFolders ? 'p.raw_eng_folder_id,' : 'NULL as raw_eng_folder_id,'}
                ${hasSecondaryRaw ? 'p.raw_secundario_activo,' : '0 as raw_secundario_activo,'}
                ${hasRoleFolders ? 'p.traductor_folder_id,' : 'NULL as traductor_folder_id,'}
                ${hasRoleFolders ? 'p.redraw_folder_id,' : 'NULL as redraw_folder_id,'}
                ${hasRoleFolders ? 'p.typer_folder_id,' : 'NULL as typer_folder_id,'}
                ${hasFontsConfig ? 'p.fuentes_config,' : 'NULL as fuentes_config,'}
                ${hasCreditosConfig ? 'p.creditos_config,' : 'NULL as creditos_config,'}
                p.estado,
                p.ultima_actualizacion,
                p.imagen_url,
                p.frecuencia,
                p.grupo_id
            FROM proyectos p
            LEFT JOIN (
                SELECT proyecto_id, MAX(capitulo) AS capitulo_completado
                FROM asignaciones
                WHERE estado = 'Completado'
                GROUP BY proyecto_id
            ) ac ON ac.proyecto_id = p.id
        `;
        const params = [];

        // If not admin and is leader, filter by group
        // Role-based filtering
        if (isAdmin) {
            // Admin sees all
        } else if (groupId) {
            // Leader/Staff sees their group's projects
            query += " WHERE p.grupo_id = ? AND LOWER(TRIM(COALESCE(p.estado, 'Activo'))) != 'cancelado'";
            params.push(groupId);
        } else {
            // Non-admin without group -> See NOTHING (or only public? Assuming internal tool, see nothing)
            return NextResponse.json([]);
        }

        query += `
            ORDER BY
                ${getProjectStatusOrderCaseSql('p')} ASC,
                LOWER(TRIM(COALESCE(p.titulo, ''))) ASC,
                p.titulo ASC,
                p.id ASC
        `;
        const proyectos = await db.prepare(query).all(...params);
        const hydrated = proyectos.map((proyecto) => {
            let catalogo = [];
            try {
                catalogo = normalizeCatalog(JSON.parse(proyecto.capitulos_catalogo || '[]'));
            } catch {
                catalogo = [];
            }

            const maxCatalogo = catalogo.length > 0
                ? catalogo[catalogo.length - 1].numero
                : null;

            return {
                ...proyecto,
                capitulos_catalogo: catalogo,
                capitulos_totales: maxCatalogo ?? proyecto.capitulos_totales,
                fuentes_config: (() => {
                    try {
                        return proyecto.fuentes_config ? JSON.parse(proyecto.fuentes_config) : null;
                    } catch {
                        return null;
                    }
                })(),
                creditos_config: (() => {
                    try {
                        return proyecto.creditos_config ? JSON.parse(proyecto.creditos_config) : null;
                    } catch {
                        return null;
                    }
                })(),
            };
        });

        return NextResponse.json(hydrated);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const body = await request.json();
        const {
            titulo,
            tipo,
            genero,
            capitulos_totales,
            capitulos_catalogo,
            frecuencia,
            grupo_id,
            imagen_url,
            drive_folder_id,
            raw_folder_id,
            raw_eng_folder_id,
            raw_secundario_activo,
            traductor_folder_id,
            redraw_folder_id,
            typer_folder_id,
            fuentes_config,
            creditos_config,
        } = body;
        const db = getDb();

        const duplicate = await findPotentialDuplicateProject(db, titulo);
        if (duplicate) {
            return NextResponse.json({
                error: `Ya existe un proyecto similar: "${duplicate.titulo}" (ID ${duplicate.id}).`,
                duplicate_project_id: Number(duplicate.id),
            }, { status: 409 });
        }

        const hasCatalog = await ensureCatalogColumn(db);
        const hasDriveFolder = await ensureDriveFolderColumn(db);
        const hasRoleFolders = await ensureRoleFolderColumns(db);
        const hasSecondaryRaw = await ensureSecondaryRawColumn(db);
        const hasFontsConfig = await ensureFontsConfigColumn(db);
        const hasCreditosConfig = await ensureCreditosConfigColumn(db);
        if (Array.isArray(capitulos_catalogo) && !hasCatalog) {
            return NextResponse.json({ error: 'La base de datos no soporta catalogo de capitulos. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        const catalogo = normalizeCatalog(capitulos_catalogo);
        const maxCatalogo = catalogo.length > 0 ? catalogo[catalogo.length - 1].numero : null;
        const totalFinal = maxCatalogo ?? (capitulos_totales ?? null);

        // Default to Group 1 if not specified
        const finalGrupoId = grupo_id || 1;

        let result;
        if (hasCatalog) {
            if (hasDriveFolder && hasRoleFolders && hasSecondaryRaw) {
                const stmt = db.prepare(`
                    INSERT INTO proyectos (titulo, tipo, genero, capitulos_totales, capitulos_catalogo, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url, drive_folder_id, raw_folder_id, raw_eng_folder_id, raw_secundario_activo, traductor_folder_id, redraw_folder_id, typer_folder_id)
                    VALUES (?, ?, ?, ?, ?, 0, 'Activo', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                result = await stmt.run(
                    titulo,
                    tipo,
                    genero,
                    totalFinal,
                    JSON.stringify(catalogo),
                    frecuencia || 'Semanal',
                    finalGrupoId,
                    imagen_url || null,
                    String(drive_folder_id || '').trim() || null,
                    String(raw_folder_id || '').trim() || null,
                    String(raw_eng_folder_id || '').trim() || null,
                    Number(raw_secundario_activo) ? 1 : 0,
                    String(traductor_folder_id || '').trim() || null,
                    String(redraw_folder_id || '').trim() || null,
                    String(typer_folder_id || '').trim() || null
                );
            } else if (hasDriveFolder && hasRoleFolders) {
                const stmt = db.prepare(`
                    INSERT INTO proyectos (titulo, tipo, genero, capitulos_totales, capitulos_catalogo, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url, drive_folder_id, raw_folder_id, raw_eng_folder_id, traductor_folder_id, redraw_folder_id, typer_folder_id)
                    VALUES (?, ?, ?, ?, ?, 0, 'Activo', CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                result = await stmt.run(
                    titulo,
                    tipo,
                    genero,
                    totalFinal,
                    JSON.stringify(catalogo),
                    frecuencia || 'Semanal',
                    finalGrupoId,
                    imagen_url || null,
                    String(drive_folder_id || '').trim() || null,
                    String(raw_folder_id || '').trim() || null,
                    String(raw_eng_folder_id || '').trim() || null,
                    String(traductor_folder_id || '').trim() || null,
                    String(redraw_folder_id || '').trim() || null,
                    String(typer_folder_id || '').trim() || null
                );
            } else if (hasDriveFolder) {
                const stmt = db.prepare(`
                    INSERT INTO proyectos (titulo, tipo, genero, capitulos_totales, capitulos_catalogo, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url, drive_folder_id)
                    VALUES (?, ?, ?, ?, ?, 0, 'Activo', CURRENT_TIMESTAMP, ?, ?, ?, ?)
                `);
                result = await stmt.run(
                    titulo,
                    tipo,
                    genero,
                    totalFinal,
                    JSON.stringify(catalogo),
                    frecuencia || 'Semanal',
                    finalGrupoId,
                    imagen_url || null,
                    String(drive_folder_id || '').trim() || null
                );
            } else {
                const stmt = db.prepare(`
                    INSERT INTO proyectos (titulo, tipo, genero, capitulos_totales, capitulos_catalogo, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url)
                    VALUES (?, ?, ?, ?, ?, 0, 'Activo', CURRENT_TIMESTAMP, ?, ?, ?)
                `);
                result = await stmt.run(
                    titulo,
                    tipo,
                    genero,
                    totalFinal,
                    JSON.stringify(catalogo),
                    frecuencia || 'Semanal',
                    finalGrupoId,
                    imagen_url || null
                );
            }
        } else {
            const stmt = db.prepare(`
                INSERT INTO proyectos (titulo, tipo, genero, capitulos_totales, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url)
                VALUES (?, ?, ?, ?, 0, 'Activo', CURRENT_TIMESTAMP, ?, ?, ?)
            `);
            result = await stmt.run(
                titulo,
                tipo,
                genero,
                totalFinal,
                frecuencia || 'Semanal',
                finalGrupoId,
                imagen_url || null
            );
        }

        if (hasFontsConfig && fuentes_config !== undefined) {
            const normalizedFontsConfig = normalizeFontsConfigPayload(fuentes_config);
            await db.prepare(`
                UPDATE proyectos
                SET fuentes_config = ?, ultima_actualizacion = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(normalizedFontsConfig, Number(result?.lastInsertRowid || 0));
        }
        if (hasCreditosConfig && creditos_config !== undefined) {
            const normalizedCreditosConfig = normalizeCreditosConfigPayload(creditos_config);
            await db.prepare(`
                UPDATE proyectos
                SET creditos_config = ?, ultima_actualizacion = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(normalizedCreditosConfig, Number(result?.lastInsertRowid || 0));
        }

        const createdProjectId = Number(result?.lastInsertRowid || 0);
        if (createdProjectId > 0 && normalizeProjectStatus(body?.estado) !== 'cancelado') {
            try {
                await autoSyncProjectRoleFolders(db, createdProjectId);
                await getProjectCatalogEntries(db, {
                    id: createdProjectId,
                    titulo,
                    drive_folder_id: String(drive_folder_id || '').trim() || null,
                    raw_folder_id: String(raw_folder_id || '').trim() || null,
                    raw_eng_folder_id: String(raw_eng_folder_id || '').trim() || null,
                    traductor_folder_id: String(traductor_folder_id || '').trim() || null,
                    redraw_folder_id: String(redraw_folder_id || '').trim() || null,
                    typer_folder_id: String(typer_folder_id || '').trim() || null,
                });
            } catch {
                // Keep project creation successful even if Drive sync fails.
            }
        }

        publishProjectEvent({
            action: 'created',
            project_id: createdProjectId,
            group_id: Number(finalGrupoId) || null,
            ts: Date.now(),
        });

        return NextResponse.json({ id: result.lastInsertRowid, message: 'Proyecto creado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request) {
    try {
        const db = getDb();
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;
        if (!token) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const session = await db.prepare(`
            SELECT u.roles FROM sessions s
            JOIN usuarios u ON s.usuario_id = u.id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);
        if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        const roles = JSON.parse(session.roles || '[]');
        if (!roles.includes('Administrador')) {
            return NextResponse.json({ error: 'Solo administradores pueden hacer esto.' }, { status: 403 });
        }

        const body = await request.json();
        const { action, font_file_id } = body;

        if (action === 'set_font_all') {
            const fontId = String(font_file_id || '').trim();
            if (!fontId) return NextResponse.json({ error: 'font_file_id es requerido.' }, { status: 400 });

            const allProjects = await db.prepare('SELECT id, creditos_config FROM proyectos').all();
            let updated = 0;
            for (const proj of Array.isArray(allProjects) ? allProjects : []) {
                let config = {};
                try { config = proj.creditos_config ? JSON.parse(proj.creditos_config) : {}; } catch { config = {}; }
                if (!config || typeof config !== 'object') config = {};
                if (!config.imagen || typeof config.imagen !== 'object') config.imagen = {};
                config.imagen.font_file_id = fontId;
                await db.prepare(
                    'UPDATE proyectos SET creditos_config = ?, ultima_actualizacion = CURRENT_TIMESTAMP WHERE id = ?'
                ).run(JSON.stringify(config), proj.id);
                updated++;
            }
            return NextResponse.json({ ok: true, updated });
        }

        return NextResponse.json({ error: 'Accion no reconocida.' }, { status: 400 });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
