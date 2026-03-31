import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { catalogFromRoleFolderIds } from '@/lib/google-drive';
import { normalizeCatalogEntries } from '@/lib/project-catalog';
import { publishProjectEvent } from '@/lib/realtime';
import { cookies } from 'next/headers';

const PRODUCTION_ROLES = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];

export const dynamic = 'force-dynamic';

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
        SELECT id, raw_folder_id, raw_eng_folder_id, traductor_folder_id, redraw_folder_id, typer_folder_id
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

async function findPotentialDuplicateProject(db, title, excludeId) {
    const allProjects = await db.prepare('SELECT id, titulo FROM proyectos WHERE id != ?').all(excludeId);
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

async function getSessionPermissions(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.grupo_id
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

    const isAdmin = roles.includes('Administrador');
    const isLeaderOnly = roles.includes('Lider de Grupo');

    return {
        userId: Number(session.usuario_id),
        roles,
        groupId: session.grupo_id ?? null,
        isAdmin,
        isLeaderOnly,
    };
}

export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const body = await request.json();
        const {
            titulo,
            tipo,
            genero,
            capitulos_totales,
            capitulos_catalogo,
            estado,
            imagen_url,
            frecuencia,
            grupo_id,
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
        const permissions = await getSessionPermissions(db);
        if (!permissions) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!permissions.isAdmin && !permissions.isLeaderOnly) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const currentProject = await db.prepare('SELECT id, grupo_id FROM proyectos WHERE id = ?').get(id);
        if (!currentProject) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        if (permissions.isLeaderOnly && Number(currentProject.grupo_id || 0) !== Number(permissions.groupId || 0)) {
            return NextResponse.json({ error: 'Solo puedes editar proyectos de tu grupo' }, { status: 403 });
        }

        const hasCatalogInPayload = Array.isArray(capitulos_catalogo);
        const hasDriveFolderInPayload = drive_folder_id !== undefined;
        const hasSecondaryRawInPayload = raw_secundario_activo !== undefined;
        const hasRoleFoldersInPayload = raw_folder_id !== undefined
            || raw_eng_folder_id !== undefined
            || traductor_folder_id !== undefined
            || redraw_folder_id !== undefined
            || typer_folder_id !== undefined;
        const hasFontsConfigInPayload = fuentes_config !== undefined;
        const hasCreditosConfigInPayload = creditos_config !== undefined;
        const catalogColumnExists = hasCatalogInPayload
            ? await ensureCatalogColumn(db)
            : await hasCatalogColumn(db);
        const driveFolderColumnExists = hasDriveFolderInPayload
            ? await ensureDriveFolderColumn(db)
            : await hasDriveFolderColumn(db);
        const secondaryRawColumnExists = hasSecondaryRawInPayload
            ? await ensureSecondaryRawColumn(db)
            : await hasSecondaryRawColumn(db);
        const roleFolderColumnsExist = hasRoleFoldersInPayload
            ? await ensureRoleFolderColumns(db)
            : await hasRoleFolderColumns(db);
        const fontsConfigColumnExists = hasFontsConfigInPayload
            ? await ensureFontsConfigColumn(db)
            : await hasFontsConfigColumn(db);
        const creditosConfigColumnExists = hasCreditosConfigInPayload
            ? await ensureCreditosConfigColumn(db)
            : await hasCreditosConfigColumn(db);
        if (hasCatalogInPayload && !catalogColumnExists) {
            return NextResponse.json({ error: 'La base de datos no soporta catalogo de capitulos. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        if (hasDriveFolderInPayload && !driveFolderColumnExists) {
            return NextResponse.json({ error: 'La base de datos no soporta drive_folder_id. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        if (hasSecondaryRawInPayload && !secondaryRawColumnExists) {
            return NextResponse.json({ error: 'La base de datos no soporta raw_secundario_activo. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        if (hasRoleFoldersInPayload && !roleFolderColumnsExist) {
            return NextResponse.json({ error: 'La base de datos no soporta carpetas por rol de Drive. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        if (hasFontsConfigInPayload && !fontsConfigColumnExists) {
            return NextResponse.json({ error: 'La base de datos no soporta fuentes_config. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        if (hasCreditosConfigInPayload && !creditosConfigColumnExists) {
            return NextResponse.json({ error: 'La base de datos no soporta creditos_config. Ejecuta la migracion de esquema.' }, { status: 500 });
        }
        const normalizedCatalog = normalizeCatalog(capitulos_catalogo);
        const maxCatalogo = normalizedCatalog.length > 0 ? normalizedCatalog[normalizedCatalog.length - 1].numero : null;

        // Dynamic update query
        const fields = [];
        const values = [];

        if (titulo !== undefined) {
            const duplicate = await findPotentialDuplicateProject(db, titulo, id);
            if (duplicate) {
                return NextResponse.json({
                    error: `Ya existe un proyecto similar: "${duplicate.titulo}" (ID ${duplicate.id}).`,
                    duplicate_project_id: Number(duplicate.id),
                }, { status: 409 });
            }
            fields.push('titulo = ?');
            values.push(titulo);
        }
        if (tipo !== undefined) { fields.push('tipo = ?'); values.push(tipo); }
        if (genero !== undefined) { fields.push('genero = ?'); values.push(genero); }
        if (hasCatalogInPayload && catalogColumnExists) {
            fields.push('capitulos_catalogo = ?');
            values.push(JSON.stringify(normalizedCatalog));
            fields.push('capitulos_totales = ?');
            values.push(maxCatalogo);
        } else if (capitulos_totales !== undefined) {
            fields.push('capitulos_totales = ?');
            values.push(capitulos_totales);
        } else if (hasCatalogInPayload) {
            fields.push('capitulos_totales = ?');
            values.push(maxCatalogo);
        }
        if (estado !== undefined) { fields.push('estado = ?'); values.push(estado); }
        if (imagen_url !== undefined) { fields.push('imagen_url = ?'); values.push(imagen_url); }
        if (frecuencia !== undefined) { fields.push('frecuencia = ?'); values.push(frecuencia); }
        if (grupo_id !== undefined) { fields.push('grupo_id = ?'); values.push(permissions.isLeaderOnly ? Number(permissions.groupId || 0) : grupo_id); }
        if (hasDriveFolderInPayload && driveFolderColumnExists) {
            fields.push('drive_folder_id = ?');
            values.push(String(drive_folder_id || '').trim() || null);
        }
        if (hasSecondaryRawInPayload && secondaryRawColumnExists) {
            fields.push('raw_secundario_activo = ?');
            values.push(Number(raw_secundario_activo) ? 1 : 0);
        }
        if (hasRoleFoldersInPayload && roleFolderColumnsExist) {
            if (raw_folder_id !== undefined) {
                fields.push('raw_folder_id = ?');
                values.push(String(raw_folder_id || '').trim() || null);
            }
            if (raw_eng_folder_id !== undefined) {
                fields.push('raw_eng_folder_id = ?');
                values.push(String(raw_eng_folder_id || '').trim() || null);
            }
            if (traductor_folder_id !== undefined) {
                fields.push('traductor_folder_id = ?');
                values.push(String(traductor_folder_id || '').trim() || null);
            }
            if (redraw_folder_id !== undefined) {
                fields.push('redraw_folder_id = ?');
                values.push(String(redraw_folder_id || '').trim() || null);
            }
            if (typer_folder_id !== undefined) {
                fields.push('typer_folder_id = ?');
                values.push(String(typer_folder_id || '').trim() || null);
            }
        }
        if (hasFontsConfigInPayload && fontsConfigColumnExists) {
            fields.push('fuentes_config = ?');
            values.push(normalizeFontsConfigPayload(fuentes_config));
        }
        if (hasCreditosConfigInPayload && creditosConfigColumnExists) {
            fields.push('creditos_config = ?');
            values.push(normalizeCreditosConfigPayload(creditos_config));
        }

        // Always update timestamp
        fields.push('ultima_actualizacion = CURRENT_TIMESTAMP');

        values.push(id);

        const result = await db.prepare(`
            UPDATE proyectos SET ${fields.join(', ')} WHERE id = ?
        `).run(...values);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }

        if (normalizeProjectStatus(estado) !== 'cancelado') {
            try {
                await autoSyncProjectRoleFolders(db, id);
                const proyectoForSync = await db.prepare(`
                    SELECT id, titulo
                    FROM proyectos
                    WHERE id = ?
                `).get(id);
                if (proyectoForSync) {
                    await getProjectCatalogEntries(db, proyectoForSync);
                }
            } catch {
                // Keep project update successful even if Drive sync fails.
            }
        }

        const updatedProject = await db.prepare('SELECT id, grupo_id FROM proyectos WHERE id = ?').get(id);
        publishProjectEvent({
            action: 'updated',
            project_id: Number(id),
            group_id: updatedProject?.grupo_id ? Number(updatedProject.grupo_id) : null,
            ts: Date.now(),
        });

        return NextResponse.json({ message: 'Proyecto actualizado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(request, { params }) {
    try {
        const { id } = await params;
        const db = getDb();
        const permissions = await getSessionPermissions(db);
        if (!permissions) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!permissions.isAdmin && !permissions.isLeaderOnly) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }
        const existing = await db.prepare('SELECT id, grupo_id FROM proyectos WHERE id = ?').get(id);
        if (!existing) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        if (permissions.isLeaderOnly && Number(existing.grupo_id || 0) !== Number(permissions.groupId || 0)) {
            return NextResponse.json({ error: 'Solo puedes eliminar proyectos de tu grupo' }, { status: 403 });
        }
        const result = await db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);

        publishProjectEvent({
            action: 'deleted',
            project_id: Number(id),
            group_id: existing?.grupo_id ? Number(existing.grupo_id) : null,
            ts: Date.now(),
        });

        return NextResponse.json({ message: 'Proyecto eliminado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
