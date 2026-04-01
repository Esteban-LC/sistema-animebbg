import { ensureAssignmentGroupSnapshotSchema, getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { catalogFromDriveByRoleFolders } from '@/lib/google-drive';
import { refreshRankingRealtime } from '@/lib/ranking';

export const dynamic = 'force-dynamic';

async function requireManager(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;

    if (!token) {
        return { error: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) };
    }

    const session = await db.prepare(`
            SELECT u.roles, u.grupo_id
            FROM sessions s
            JOIN usuarios u ON s.usuario_id = u.id
            WHERE s.token = ? AND s.expires_at > datetime('now')
        `).get(token);

    if (!session) {
        return { error: NextResponse.json({ error: 'Sesion invalida o expirada' }, { status: 401 }) };
    }

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch (e) {
        roles = [];
    }

    const isAdmin = roles.includes('Administrador');
    const isLeader = roles.includes('Lider de Grupo');

    if (!isAdmin && !isLeader) {
        return { error: NextResponse.json({ error: 'Solo administradores o lideres de grupo' }, { status: 403 }) };
    }

    return {
        ok: true,
        isAdmin,
        isLeader,
        groupId: session.grupo_id ? Number(session.grupo_id) : null,
    };
}

function parseNames(raw) {
    return [...new Set(
        String(raw || '')
            .split(/[,;\n]+/)
            .map((v) => v.trim().replace(/^@+/, ''))
            .filter(Boolean)
    )];
}

function normalizeTag(rawTag) {
    return String(rawTag || '').trim().toLowerCase().replace(/\s+/g, '');
}

function cleanAlias(rawValue) {
    return String(rawValue || '').trim();
}

function buildCreditsDisplay(tagValue, aliasValue, creditsNameByTag) {
    const alias = cleanAlias(aliasValue);
    if (alias) return alias;
    const tag = normalizeTag(tagValue);
    if (!tag) return '';
    return creditsNameByTag.get(tag) || tag;
}

function normalizeProjectCreditosConfig(rawValue) {
    const parsed = (() => {
        if (!rawValue) return null;
        if (typeof rawValue === 'object') return rawValue;
        try {
            return JSON.parse(String(rawValue));
        } catch {
            return null;
        }
    })();
    const defaults = (parsed && typeof parsed === 'object' && parsed.defaults && typeof parsed.defaults === 'object')
        ? parsed.defaults
        : {};
    const imagen = (parsed && typeof parsed === 'object' && parsed.imagen && typeof parsed.imagen === 'object')
        ? parsed.imagen
        : {};

    return {
        defaults: {
            traductor_tag: normalizeTag(defaults.traductor_tag),
            typer_tag: normalizeTag(defaults.typer_tag),
            cleaner_tag: normalizeTag(defaults.cleaner_tag),
            traductor_alias: cleanAlias(defaults.traductor_alias),
            typer_alias: cleanAlias(defaults.typer_alias),
            cleaner_alias: cleanAlias(defaults.cleaner_alias),
        },
        imagen: {
            plantilla_url: String(imagen.plantilla_url || '').trim(),
            overlay_url: String(imagen.overlay_url || '').trim(),
            font_file_id: String(imagen.font_file_id || '').trim(),
            font_family: String(imagen.font_family || '').trim(),
            font_size: Number(imagen.font_size || 0) || null,
            layout: (imagen.layout && typeof imagen.layout === 'object') ? imagen.layout : null,
        },
    };
}

function normalizeCatalog(rawCatalog) {
    if (!Array.isArray(rawCatalog)) return [];
    const chapterMap = new Map();

    for (const value of rawCatalog) {
        let numero = NaN;
        let url = '';
        let traductor_url = '';
        let redraw_url = '';
        let typer_url = '';

        if (typeof value === 'number' || typeof value === 'string') {
            numero = Number(value);
        } else if (value && typeof value === 'object') {
            numero = Number(value.numero);
            url = typeof value.url === 'string' ? value.url.trim() : '';
            traductor_url = typeof value.traductor_url === 'string' ? value.traductor_url.trim() : '';
            redraw_url = typeof value.redraw_url === 'string' ? value.redraw_url.trim() : '';
            typer_url = typeof value.typer_url === 'string' ? value.typer_url.trim() : '';
        }

        if (!Number.isFinite(numero) || numero <= 0) continue;
        const existing = chapterMap.get(numero);
        if (!existing) {
            chapterMap.set(numero, { numero, url, traductor_url, redraw_url, typer_url });
            continue;
        }
        chapterMap.set(numero, {
            numero,
            url: existing.url || url,
            traductor_url: existing.traductor_url || traductor_url,
            redraw_url: existing.redraw_url || redraw_url,
            typer_url: existing.typer_url || typer_url,
        });
    }

    return [...chapterMap.values()].sort((a, b) => a.numero - b.numero);
}

function pickRole(roles, roleName) {
    return roles.find((r) => r.rol === roleName) || null;
}

function pickCatalogRoleUrl(chapter, roleName) {
    if (!chapter) return '';
    if (roleName === 'Traductor') {
        return String(chapter.traductor_url || chapter.url || '').trim();
    }
    if (roleName === 'Redrawer') {
        return String(chapter.redraw_url || chapter.url || '').trim();
    }
    if (roleName === 'Typer') {
        return String(chapter.typer_url || chapter.url || '').trim();
    }
    return String(chapter.url || '').trim();
}

function findCatalogChapter(capitulosCatalogoRaw, capitulo) {
    try {
        const catalogo = normalizeCatalog(JSON.parse(capitulosCatalogoRaw || '[]'));
        return catalogo.find((row) => Number(row.numero) === Number(capitulo)) || null;
    } catch {
        return null;
    }
}

function chapterKey(proyectoId, capitulo) {
    return `${Number(proyectoId)}|${Number(capitulo)}`;
}

function hasAllDeliveryUrls(chapter) {
    if (!chapter) return false;
    const traductor = String(chapter.traductor_url || '').trim();
    const redraw = String(chapter.redraw_url || '').trim();
    const typer = String(chapter.typer_url || '').trim();
    return Boolean(traductor && redraw && typer);
}

async function ensureSystemSyncUser(db) {
    const existing = await db.prepare(`
        SELECT id
        FROM usuarios
        WHERE LOWER(discord_username) = 'drive_sync_bot'
           OR LOWER(nombre) = 'drive sync bot'
        LIMIT 1
    `).get();
    if (existing?.id) return Number(existing.id);

    const created = await db.prepare(`
        INSERT INTO usuarios (nombre, tag, nombre_creditos, discord_username, password, roles, activo, grupo_id)
        VALUES ('Drive Sync Bot', 'drive_sync_bot', 'Drive Sync Bot', 'drive_sync_bot', '123456', '["Staff"]', 1, 1)
    `).run();
    return Number(created.lastInsertRowid);
}

async function recalculateProjectProgress(db, proyectoId) {
    const progress = await db.prepare(`
        SELECT COALESCE(MAX(capitulo), 0) AS capitulos_actuales
        FROM asignaciones
        WHERE proyecto_id = ? AND estado = 'Completado'
    `).get(proyectoId);

    await db.prepare(`
        UPDATE proyectos
        SET capitulos_actuales = ?, ultima_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(progress?.capitulos_actuales || 0, proyectoId);
}

async function hasProjectColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare('PRAGMA table_info(proyectos)').all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

async function ensureProjectColumn(db, columnName, columnSql) {
    const exists = await hasProjectColumn(db, columnName);
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE proyectos ADD COLUMN ${columnSql}`).run();
    } catch {
        // verify again below
    }
    return hasProjectColumn(db, columnName);
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
    } catch {
        // ignore if table/column state is in transition
    }
    try {
        await db.prepare(`UPDATE usuarios SET tag = LOWER(REPLACE(COALESCE(discord_username, nombre), ' ', '')) WHERE tag IS NULL OR TRIM(tag) = ''`).run();
    } catch {
        // ignore if table/column state is in transition
    }
    try {
        await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_tag_unique ON usuarios(tag)').run();
    } catch {
        // ignore if duplicates already exist
    }
}

async function ensureCreditosTable(db) {
    try {
        await db.prepare(`
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
            )
        `).run();
        await db.prepare('CREATE INDEX IF NOT EXISTS idx_creditos_capitulo_proyecto ON creditos_capitulo(proyecto_id, capitulo)').run();
    } catch {
        // ignore create/index failures here to avoid breaking read-only flows
    }
}

async function ensureAppSettingsTable(db) {
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
    } catch {
        // ignore
    }
}

async function getGlobalCreditsLayout(db) {
    await ensureAppSettingsTable(db);
    try {
        const row = await db.prepare(`
            SELECT value
            FROM app_settings
            WHERE key = 'creditos_layout_default'
            LIMIT 1
        `).get();
        const parsed = row?.value ? JSON.parse(String(row.value)) : null;
        const normalize = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            names_x: normalize(parsed.names_x),
            traductor_y: normalize(parsed.traductor_y),
            typer_y: normalize(parsed.typer_y),
            redraw_y: normalize(parsed.redraw_y),
            cleaner_y: normalize(parsed.cleaner_y),
        };
    } catch {
        return null;
    }
}

export async function GET() {
    try {
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        const auth = await requireManager(db);
        if (auth.error) return auth.error;
        await ensureUsuariosCreditosColumns(db);
        await ensureCreditosTable(db);
        const globalCreditsLayout = await getGlobalCreditsLayout(db);
        const hasProjectCreditsConfig = await ensureProjectColumn(db, 'creditos_config', 'creditos_config TEXT');

        const creditUsers = await db.prepare(`
            SELECT
                LOWER(COALESCE(tag, '')) AS tag,
                COALESCE(NULLIF(TRIM(nombre_creditos), ''), NULLIF(TRIM(nombre), ''), LOWER(COALESCE(tag, ''))) AS display_name
            FROM usuarios
            WHERE tag IS NOT NULL AND TRIM(tag) != ''
        `).all();
        const creditsNameByTag = new Map();
        for (const row of Array.isArray(creditUsers) ? creditUsers : []) {
            const tag = normalizeTag(row?.tag);
            if (!tag || creditsNameByTag.has(tag)) continue;
            creditsNameByTag.set(tag, String(row?.display_name || tag).trim());
        }

        const completadosBase = await db.prepare(`
            SELECT
                p.id AS proyecto_id,
                p.titulo AS proyecto_titulo,
                p.imagen_url AS proyecto_imagen,
                p.capitulos_catalogo AS capitulos_catalogo,
                ${hasProjectCreditsConfig ? 'p.creditos_config AS proyecto_creditos_config,' : 'NULL AS proyecto_creditos_config,'}
                a.capitulo,
                MAX(a.completado_en) AS completado_en,
                COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN a.rol = 'Traductor' THEN COALESCE(u.discord_username, u.nombre) END), '') AS traductores,
                COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN a.rol = 'Typer' THEN COALESCE(u.discord_username, u.nombre) END), '') AS typers,
                COALESCE(GROUP_CONCAT(DISTINCT CASE WHEN a.rol = 'Redrawer' THEN COALESCE(u.discord_username, u.nombre) END), '') AS redrawers
            FROM asignaciones a
            JOIN proyectos p ON p.id = a.proyecto_id
            LEFT JOIN usuarios u ON u.id = a.usuario_id
            WHERE a.estado = 'Completado'
              AND a.proyecto_id IS NOT NULL
              AND a.capitulo IS NOT NULL
              ${!auth.isAdmin && auth.groupId ? 'AND COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) = ?' : ''}
            GROUP BY p.id, p.titulo, p.imagen_url, a.capitulo
            ORDER BY MAX(a.completado_en) DESC
            LIMIT 250
        `).all(...(!auth.isAdmin && auth.groupId ? [auth.groupId] : []));

        const completados = [];
        const existingChapterKeys = new Set();
        for (const item of completadosBase) {
            const projectCreditosConfig = normalizeProjectCreditosConfig(item?.proyecto_creditos_config);
            if (!projectCreditosConfig.imagen.layout || typeof projectCreditosConfig.imagen.layout !== 'object') {
                projectCreditosConfig.imagen.layout = globalCreditsLayout;
            } else if (globalCreditsLayout) {
                projectCreditosConfig.imagen.layout = {
                    ...globalCreditsLayout,
                    ...projectCreditosConfig.imagen.layout,
                };
            }
            const projectDefaults = projectCreditosConfig.defaults;
            const creditsRow = await db.prepare(`
                SELECT
                    traductor_tag,
                    typer_tag,
                    cleaner_tag,
                    traductor_alias,
                    typer_alias,
                    cleaner_alias
                FROM creditos_capitulo
                WHERE proyecto_id = ? AND capitulo = ?
                LIMIT 1
            `).get(item.proyecto_id, item.capitulo);

            const roleRows = await db.prepare(`
                SELECT
                    a.id,
                    a.rol,
                    a.drive_url,
                    a.completado_en,
                    COALESCE(u.discord_username, u.nombre) as usuario
                FROM asignaciones a
                LEFT JOIN usuarios u ON u.id = a.usuario_id
                WHERE a.proyecto_id = ?
                  AND a.capitulo = ?
                  AND a.estado = 'Completado'
                  AND a.rol IN ('Traductor', 'Typer', 'Redrawer')
                ORDER BY datetime(a.completado_en) DESC, a.id DESC
            `).all(item.proyecto_id, item.capitulo);

            let raw_url = '';
            let chapterCatalog = null;
            try {
                const catalogo = normalizeCatalog(JSON.parse(item.capitulos_catalogo || '[]'));
                chapterCatalog = catalogo.find((row) => Number(row.numero) === Number(item.capitulo)) || null;
                raw_url = chapterCatalog?.url || '';
            } catch {
                raw_url = '';
                chapterCatalog = null;
            }

            const traductor = pickRole(roleRows, 'Traductor');
            const typer = pickRole(roleRows, 'Typer');
            const redrawer = pickRole(roleRows, 'Redrawer');

            const traductorFallback = pickCatalogRoleUrl(chapterCatalog, 'Traductor');
            const typerFallback = pickCatalogRoleUrl(chapterCatalog, 'Typer');
            const redrawerFallback = pickCatalogRoleUrl(chapterCatalog, 'Redrawer');

            completados.push({
                proyecto_id: item.proyecto_id,
                proyecto_titulo: item.proyecto_titulo,
                proyecto_imagen: item.proyecto_imagen,
                capitulo: item.capitulo,
                completado_en: item.completado_en,
                traductores: item.traductores,
                typers: item.typers,
                redrawers: item.redrawers,
                raw_url,
                roles: {
                    traductor: traductor ? {
                        asignacion_id: traductor.id,
                        usuario: traductor.usuario || '',
                        drive_url: traductor.drive_url || traductorFallback || '',
                        completado_en: traductor.completado_en || null,
                    } : (traductorFallback ? {
                        asignacion_id: 0,
                        usuario: '',
                        drive_url: traductorFallback,
                        completado_en: null,
                    } : null),
                    typer: typer ? {
                        asignacion_id: typer.id,
                        usuario: typer.usuario || '',
                        drive_url: typer.drive_url || typerFallback || '',
                        completado_en: typer.completado_en || null,
                    } : (typerFallback ? {
                        asignacion_id: 0,
                        usuario: '',
                        drive_url: typerFallback,
                        completado_en: null,
                    } : null),
                    redrawer: redrawer ? {
                        asignacion_id: redrawer.id,
                        usuario: redrawer.usuario || '',
                        drive_url: redrawer.drive_url || redrawerFallback || '',
                        completado_en: redrawer.completado_en || null,
                    } : (redrawerFallback ? {
                        asignacion_id: 0,
                        usuario: '',
                        drive_url: redrawerFallback,
                        completado_en: null,
                    } : null),
                },
                creditos: {
                    traductor_tag: normalizeTag(creditsRow?.traductor_tag || projectDefaults.traductor_tag),
                    typer_tag: normalizeTag(creditsRow?.typer_tag || projectDefaults.typer_tag),
                    cleaner_tag: normalizeTag(creditsRow?.cleaner_tag || projectDefaults.cleaner_tag),
                    traductor_alias: cleanAlias(creditsRow?.traductor_alias || projectDefaults.traductor_alias),
                    typer_alias: cleanAlias(creditsRow?.typer_alias || projectDefaults.typer_alias),
                    cleaner_alias: cleanAlias(creditsRow?.cleaner_alias || projectDefaults.cleaner_alias),
                    traductor_display: buildCreditsDisplay(
                        creditsRow?.traductor_tag || projectDefaults.traductor_tag,
                        creditsRow?.traductor_alias || projectDefaults.traductor_alias,
                        creditsNameByTag
                    ),
                    typer_display: buildCreditsDisplay(
                        creditsRow?.typer_tag || projectDefaults.typer_tag,
                        creditsRow?.typer_alias || projectDefaults.typer_alias,
                        creditsNameByTag
                    ),
                    cleaner_display: buildCreditsDisplay(
                        creditsRow?.cleaner_tag || projectDefaults.cleaner_tag,
                        creditsRow?.cleaner_alias || projectDefaults.cleaner_alias,
                        creditsNameByTag
                    ),
                    redraw_display: buildCreditsDisplay(
                        creditsRow?.cleaner_tag || projectDefaults.cleaner_tag,
                        creditsRow?.cleaner_alias || projectDefaults.cleaner_alias,
                        creditsNameByTag
                    ),
                    plantilla_imagen: projectCreditosConfig.imagen,
                },
            });
            existingChapterKeys.add(chapterKey(item.proyecto_id, item.capitulo));
        }

        const proyectosCatalogo = await db.prepare(`
            SELECT id, titulo, imagen_url, capitulos_catalogo, ${hasProjectCreditsConfig ? 'creditos_config' : 'NULL as creditos_config'}
            FROM proyectos
            ${!auth.isAdmin && auth.groupId ? 'WHERE grupo_id = ?' : ''}
        `).all(...(!auth.isAdmin && auth.groupId ? [auth.groupId] : []));

        for (const proyecto of Array.isArray(proyectosCatalogo) ? proyectosCatalogo : []) {
            let catalogo = [];
            try {
                catalogo = normalizeCatalog(JSON.parse(proyecto.capitulos_catalogo || '[]'));
            } catch {
                catalogo = [];
            }

            for (const chapter of catalogo) {
                const key = chapterKey(proyecto.id, chapter.numero);
                if (existingChapterKeys.has(key)) continue;
                const projectCreditosConfig = normalizeProjectCreditosConfig(proyecto?.creditos_config);
                if (!projectCreditosConfig.imagen.layout || typeof projectCreditosConfig.imagen.layout !== 'object') {
                    projectCreditosConfig.imagen.layout = globalCreditsLayout;
                } else if (globalCreditsLayout) {
                    projectCreditosConfig.imagen.layout = {
                        ...globalCreditsLayout,
                        ...projectCreditosConfig.imagen.layout,
                    };
                }
                const projectDefaults = projectCreditosConfig.defaults;

                const creditsRow = await db.prepare(`
                    SELECT
                        traductor_tag,
                        typer_tag,
                        cleaner_tag,
                        traductor_alias,
                        typer_alias,
                        cleaner_alias
                    FROM creditos_capitulo
                    WHERE proyecto_id = ? AND capitulo = ?
                    LIMIT 1
                `).get(proyecto.id, chapter.numero);

                const traductorFallback = pickCatalogRoleUrl(chapter, 'Traductor');
                const typerFallback = pickCatalogRoleUrl(chapter, 'Typer');
                const redrawerFallback = pickCatalogRoleUrl(chapter, 'Redrawer');

                completados.push({
                    proyecto_id: Number(proyecto.id),
                    proyecto_titulo: proyecto.titulo,
                    proyecto_imagen: proyecto.imagen_url,
                    capitulo: Number(chapter.numero),
                    completado_en: null,
                    traductores: '',
                    typers: '',
                    redrawers: '',
                    raw_url: String(chapter.url || '').trim(),
                    es_catalogo: true,
                    roles: {
                        traductor: traductorFallback ? {
                            asignacion_id: 0,
                            usuario: '',
                            drive_url: traductorFallback,
                            completado_en: null,
                        } : null,
                        typer: typerFallback ? {
                            asignacion_id: 0,
                            usuario: '',
                            drive_url: typerFallback,
                            completado_en: null,
                        } : null,
                        redrawer: redrawerFallback ? {
                            asignacion_id: 0,
                            usuario: '',
                            drive_url: redrawerFallback,
                            completado_en: null,
                        } : null,
                    },
                    creditos: {
                        traductor_tag: normalizeTag(creditsRow?.traductor_tag || projectDefaults.traductor_tag),
                        typer_tag: normalizeTag(creditsRow?.typer_tag || projectDefaults.typer_tag),
                        cleaner_tag: normalizeTag(creditsRow?.cleaner_tag || projectDefaults.cleaner_tag),
                        traductor_alias: cleanAlias(creditsRow?.traductor_alias || projectDefaults.traductor_alias),
                        typer_alias: cleanAlias(creditsRow?.typer_alias || projectDefaults.typer_alias),
                        cleaner_alias: cleanAlias(creditsRow?.cleaner_alias || projectDefaults.cleaner_alias),
                        traductor_display: buildCreditsDisplay(
                            creditsRow?.traductor_tag || projectDefaults.traductor_tag,
                            creditsRow?.traductor_alias || projectDefaults.traductor_alias,
                            creditsNameByTag
                        ),
                        typer_display: buildCreditsDisplay(
                            creditsRow?.typer_tag || projectDefaults.typer_tag,
                            creditsRow?.typer_alias || projectDefaults.typer_alias,
                            creditsNameByTag
                        ),
                        cleaner_display: buildCreditsDisplay(
                            creditsRow?.cleaner_tag || projectDefaults.cleaner_tag,
                            creditsRow?.cleaner_alias || projectDefaults.cleaner_alias,
                            creditsNameByTag
                        ),
                        redraw_display: buildCreditsDisplay(
                            creditsRow?.cleaner_tag || projectDefaults.cleaner_tag,
                            creditsRow?.cleaner_alias || projectDefaults.cleaner_alias,
                            creditsNameByTag
                        ),
                        plantilla_imagen: projectCreditosConfig.imagen,
                    },
                });
            }
        }

        completados.sort((a, b) => {
            const left = a?.completado_en ? new Date(a.completado_en).getTime() : 0;
            const right = b?.completado_en ? new Date(b.completado_en).getTime() : 0;
            if (right !== left) return right - left;
            if (String(a.proyecto_titulo) !== String(b.proyecto_titulo)) {
                return String(a.proyecto_titulo).localeCompare(String(b.proyecto_titulo));
            }
            return Number(a.capitulo) - Number(b.capitulo);
        });

        return NextResponse.json(completados);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request) {
    try {
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        const auth = await requireAdmin(db);
        if (auth.error) return auth.error;
        await ensureUsuariosCreditosColumns(db);
        await ensureCreditosTable(db);

        const body = await request.json();
        const { proyecto_id, capitulo, traductores, typers, redrawers, rol, drive_url, usuario_id, creditos, plantilla_layout, layout_global_default, apply_layout_all } = body;

        if (!proyecto_id || capitulo === undefined || capitulo === null) {
            return NextResponse.json({ error: 'proyecto_id y capitulo son requeridos' }, { status: 400 });
        }

        if (layout_global_default && typeof layout_global_default === 'object') {
            await ensureAppSettingsTable(db);
            const sanitize = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
            const payload = {
                names_x: sanitize(layout_global_default.names_x),
                traductor_y: sanitize(layout_global_default.traductor_y),
                typer_y: sanitize(layout_global_default.typer_y),
                redraw_y: sanitize(layout_global_default.redraw_y),
                cleaner_y: sanitize(layout_global_default.cleaner_y),
            };
            await db.prepare(`
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ('creditos_layout_default', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            `).run(JSON.stringify(payload));

            return NextResponse.json({
                message: 'Default global guardado',
                layout: payload,
            });
        }

        if (apply_layout_all && typeof apply_layout_all === 'object') {
            const sanitize = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
            const newLayout = {
                names_x: sanitize(apply_layout_all.names_x),
                traductor_y: sanitize(apply_layout_all.traductor_y),
                typer_y: sanitize(apply_layout_all.typer_y),
                redraw_y: sanitize(apply_layout_all.redraw_y),
                cleaner_y: sanitize(apply_layout_all.cleaner_y),
            };
            // Save as global default too
            await ensureAppSettingsTable(db);
            await db.prepare(`
                INSERT INTO app_settings (key, value, updated_at)
                VALUES ('creditos_layout_default', ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = CURRENT_TIMESTAMP
            `).run(JSON.stringify(newLayout));
            // Apply to all projects
            await ensureProjectColumn(db, 'creditos_config', 'creditos_config TEXT');
            const allProjects = await db.prepare(`SELECT id, creditos_config FROM proyectos`).all();
            for (const proj of Array.isArray(allProjects) ? allProjects : []) {
                const currentConfig = normalizeProjectCreditosConfig(proj.creditos_config);
                const mergedConfig = {
                    ...currentConfig,
                    imagen: {
                        ...currentConfig.imagen,
                        layout: newLayout,
                    },
                };
                await db.prepare(`
                    UPDATE proyectos
                    SET creditos_config = ?, ultima_actualizacion = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(JSON.stringify(mergedConfig), proj.id);
            }
            return NextResponse.json({
                ok: true,
                message: `Layout aplicado a ${Array.isArray(allProjects) ? allProjects.length : 0} proyectos`,
                layout: newLayout,
            });
        }

        if (plantilla_layout && typeof plantilla_layout === 'object') {
            const hasProjectCreditsConfig = await ensureProjectColumn(db, 'creditos_config', 'creditos_config TEXT');
            if (!hasProjectCreditsConfig) {
                return NextResponse.json({ error: 'No se pudo habilitar creditos_config en proyectos' }, { status: 500 });
            }

            const proyecto = await db.prepare('SELECT id, creditos_config FROM proyectos WHERE id = ?').get(proyecto_id);
            if (!proyecto) {
                return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
            }

            const currentConfig = normalizeProjectCreditosConfig(proyecto.creditos_config);
            const nextLayout = {
                names_x: Number(plantilla_layout.names_x),
                traductor_y: Number(plantilla_layout.traductor_y),
                typer_y: Number(plantilla_layout.typer_y),
                redraw_y: Number(plantilla_layout.redraw_y),
                cleaner_y: Number(plantilla_layout.cleaner_y),
            };
            const sanitize = (v) => Number.isFinite(v) ? v : null;
            const mergedConfig = {
                ...currentConfig,
                imagen: {
                    ...currentConfig.imagen,
                    layout: {
                        ...(currentConfig.imagen?.layout && typeof currentConfig.imagen.layout === 'object' ? currentConfig.imagen.layout : {}),
                        names_x: sanitize(nextLayout.names_x),
                        traductor_y: sanitize(nextLayout.traductor_y),
                        typer_y: sanitize(nextLayout.typer_y),
                        redraw_y: sanitize(nextLayout.redraw_y),
                        cleaner_y: sanitize(nextLayout.cleaner_y),
                    },
                },
            };

            await db.prepare(`
                UPDATE proyectos
                SET creditos_config = ?, ultima_actualizacion = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(JSON.stringify(mergedConfig), proyecto_id);

            return NextResponse.json({
                message: 'Posicion guardada',
                layout: mergedConfig.imagen.layout,
            });
        }

        if (creditos && typeof creditos === 'object') {
            const traductorTag = normalizeTag(creditos.traductor_tag);
            const typerTag = normalizeTag(creditos.typer_tag);
            const cleanerTag = normalizeTag(creditos.cleaner_tag);
            const traductorAlias = cleanAlias(creditos.traductor_alias);
            const typerAlias = cleanAlias(creditos.typer_alias);
            const cleanerAlias = cleanAlias(creditos.cleaner_alias);

            const allTags = [traductorTag, typerTag, cleanerTag].filter(Boolean);
            if (allTags.length > 0) {
                const placeholders = allTags.map(() => '?').join(', ');
                const existingTags = await db.prepare(`
                    SELECT LOWER(tag) AS tag
                    FROM usuarios
                    WHERE LOWER(tag) IN (${placeholders})
                `).all(...allTags);
                const existingSet = new Set((Array.isArray(existingTags) ? existingTags : []).map((row) => normalizeTag(row?.tag)));
                const missing = allTags.find((tag) => !existingSet.has(tag));
                if (missing) {
                    return NextResponse.json({ error: `No existe el tag "${missing}" en staff` }, { status: 400 });
                }
            }

            await db.prepare(`
                INSERT INTO creditos_capitulo (
                    proyecto_id, capitulo,
                    traductor_tag, typer_tag, cleaner_tag,
                    traductor_alias, typer_alias, cleaner_alias,
                    actualizado_en
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(proyecto_id, capitulo)
                DO UPDATE SET
                    traductor_tag = excluded.traductor_tag,
                    typer_tag = excluded.typer_tag,
                    cleaner_tag = excluded.cleaner_tag,
                    traductor_alias = excluded.traductor_alias,
                    typer_alias = excluded.typer_alias,
                    cleaner_alias = excluded.cleaner_alias,
                    actualizado_en = CURRENT_TIMESTAMP
            `).run(
                proyecto_id,
                capitulo,
                traductorTag || null,
                typerTag || null,
                cleanerTag || null,
                traductorAlias || null,
                typerAlias || null,
                cleanerAlias || null,
            );

            return NextResponse.json({
                message: 'Creditos guardados',
                creditos: {
                    traductor_tag: traductorTag,
                    typer_tag: typerTag,
                    cleaner_tag: cleanerTag,
                    traductor_alias: traductorAlias,
                    typer_alias: typerAlias,
                    cleaner_alias: cleanerAlias,
                    redraw_alias: cleanerAlias,
                },
            });
        }

        if (rol && drive_url !== undefined) {
            const validRoles = {
                Traductor: 'Traductor',
                Typer: 'Typer',
                Redrawer: 'Redrawer',
            };
            const finalRole = validRoles[rol];
            if (!finalRole) {
                return NextResponse.json({ error: 'Rol invalido' }, { status: 400 });
            }

            const target = await db.prepare(`
                SELECT id
                FROM asignaciones
                WHERE proyecto_id = ?
                  AND capitulo = ?
                  AND rol = ?
                  AND estado = 'Completado'
                ORDER BY datetime(completado_en) DESC, id DESC
                LIMIT 1
            `).get(proyecto_id, capitulo, finalRole);

            const normalizedDriveUrl = String(drive_url || '').trim();
            const proyecto = await db.prepare('SELECT id, titulo, capitulos_catalogo, grupo_id FROM proyectos WHERE id = ?').get(proyecto_id);
            if (!proyecto) {
                return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
            }
            const proyectoGroup = await db.prepare('SELECT grupo_id FROM proyectos WHERE id = ?').get(proyecto_id);

            const chapterCatalog = findCatalogChapter(proyecto.capitulos_catalogo, capitulo);
            const fallbackRoleUrl = pickCatalogRoleUrl(chapterCatalog, finalRole);
            const finalDriveUrl = normalizedDriveUrl || fallbackRoleUrl;

            if (target) {
                const nextUserId = usuario_id !== undefined && usuario_id !== null ? Number(usuario_id) : null;
                if (nextUserId) {
                    const userExists = await db.prepare('SELECT id FROM usuarios WHERE id = ?').get(nextUserId);
                    if (!userExists) {
                        return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
                    }
                    await db.prepare(`
                        UPDATE asignaciones
                        SET drive_url = ?, usuario_id = ?
                        WHERE id = ?
                    `).run(finalDriveUrl, nextUserId, target.id);
                } else {
                    await db.prepare(`
                        UPDATE asignaciones
                        SET drive_url = ?
                        WHERE id = ?
                    `).run(finalDriveUrl, target.id);
                }
                await refreshRankingRealtime(db, { notifyPositionChanges: true });
                return NextResponse.json({ message: 'Enlace actualizado', asignacion_id: target.id });
            }

            const selectedUserId = Number(usuario_id || 0);
            if (!selectedUserId) {
                return NextResponse.json({ error: `No existe registro completado para rol ${finalRole}. Selecciona usuario para crearlo manualmente.` }, { status: 400 });
            }
            const userExists = await db.prepare('SELECT id FROM usuarios WHERE id = ?').get(selectedUserId);
            if (!userExists) {
                return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
            }
            if (!finalDriveUrl) {
                return NextResponse.json({ error: 'Debes ingresar el enlace para crear el registro manual.' }, { status: 400 });
            }

            const insert = await db.prepare(`
                INSERT INTO asignaciones (
                    usuario_id, rol, descripcion, estado,
                    asignado_en, completado_en, informe, drive_url,
                    proyecto_id, capitulo, grupo_id_snapshot
                )
                VALUES (?, ?, ?, 'Completado', CURRENT_TIMESTAMP, NULL, NULL, ?, ?, ?, ?)
            `).run(
                selectedUserId,
                finalRole,
                `${proyecto.titulo} - Capitulo ${capitulo}`,
                finalDriveUrl,
                proyecto_id,
                capitulo,
                proyectoGroup?.grupo_id ?? null
            );

            await refreshRankingRealtime(db, { notifyPositionChanges: true });

            return NextResponse.json({ message: 'Registro manual creado', asignacion_id: Number(insert.lastInsertRowid) });
        }

        const proyecto = await db.prepare('SELECT id, titulo, capitulos_catalogo, grupo_id FROM proyectos WHERE id = ?').get(proyecto_id);
        if (!proyecto) {
            return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
        }
        const proyectoGroup = await db.prepare('SELECT grupo_id FROM proyectos WHERE id = ?').get(proyecto_id);
        const chapterCatalog = findCatalogChapter(proyecto.capitulos_catalogo, capitulo);

        const rolesMap = [
            { rol: 'Traductor', names: parseNames(traductores) },
            { rol: 'Typer', names: parseNames(typers) },
            { rol: 'Redrawer', names: parseNames(redrawers) },
        ];

        let createdUsers = 0;
        let addedAssignments = 0;

        for (const roleGroup of rolesMap) {
            for (const name of roleGroup.names) {
                const key = name.toLowerCase();
                let user = await db.prepare(`
                    SELECT id, nombre, discord_username
                    FROM usuarios
                    WHERE LOWER(nombre) = ? OR LOWER(discord_username) = ?
                    LIMIT 1
                `).get(key, key);

                if (!user) {
                    const created = await db.prepare(`
                        INSERT INTO usuarios (nombre, tag, nombre_creditos, discord_username, password, roles, activo, grupo_id)
                        VALUES (?, ?, ?, ?, '123456', '["Staff"]', 1, 1)
                    `).run(name, normalizeTag(name), name, name);
                    user = { id: Number(created.lastInsertRowid), nombre: name, discord_username: name };
                    createdUsers += 1;
                }

                const exists = await db.prepare(`
                    SELECT id FROM asignaciones
                    WHERE usuario_id = ? AND rol = ? AND proyecto_id = ? AND capitulo = ? AND estado = 'Completado'
                    LIMIT 1
                `).get(user.id, roleGroup.rol, proyecto_id, capitulo);

                if (!exists) {
                    await db.prepare(`
                        INSERT INTO asignaciones (
                            usuario_id, rol, descripcion, estado,
                            asignado_en, completado_en, informe, drive_url,
                            proyecto_id, capitulo, grupo_id_snapshot
                        )
                        VALUES (?, ?, ?, 'Completado', CURRENT_TIMESTAMP, NULL, NULL, ?, ?, ?, ?)
                    `).run(
                        user.id,
                        roleGroup.rol,
                        `${proyecto.titulo} - Capitulo ${capitulo}`,
                        pickCatalogRoleUrl(chapterCatalog, roleGroup.rol) || null,
                        proyecto_id,
                        capitulo,
                        proyectoGroup?.grupo_id ?? null
                    );
                    addedAssignments += 1;
                }
            }
        }

        await db.prepare(`
            UPDATE proyectos
            SET capitulos_actuales = CASE
                    WHEN capitulos_actuales < ? THEN ?
                    ELSE capitulos_actuales
                END,
                ultima_actualizacion = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(capitulo, capitulo, proyecto_id);

        await refreshRankingRealtime(db, { notifyPositionChanges: true });

        return NextResponse.json({
            message: 'Registros actualizados',
            createdUsers,
            addedAssignments,
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const db = getDb();
        const auth = await requireAdmin(db);
        if (auth.error) return auth.error;
        await ensureUsuariosCreditosColumns(db);

        const body = await request.json().catch(() => ({}));
        const proyectoId = Number(body?.proyecto_id || 0) || null;
        const dryRun = body?.dry_run !== false;
        const source = String(body?.source || 'catalog').toLowerCase();
        const forceDrive = source === 'drive';
        const mode = String(body?.mode || 'role_folders');
        const folderIdOverride = String(body?.folderId || '').trim();

        const hasCatalogColumn = await ensureProjectColumn(db, 'capitulos_catalogo', 'capitulos_catalogo TEXT');
        const hasDriveFolderColumn = await ensureProjectColumn(db, 'drive_folder_id', 'drive_folder_id TEXT');

        const projects = proyectoId
            ? await db.prepare(`
                SELECT
                    id,
                    titulo,
                    grupo_id,
                    ${hasCatalogColumn ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                    ${hasDriveFolderColumn ? 'drive_folder_id' : 'NULL as drive_folder_id'}
                FROM proyectos
                WHERE id = ?
            `).all(proyectoId)
            : await db.prepare(`
                SELECT
                    id,
                    titulo,
                    grupo_id,
                    ${hasCatalogColumn ? 'capitulos_catalogo' : 'NULL as capitulos_catalogo'},
                    ${hasDriveFolderColumn ? 'drive_folder_id' : 'NULL as drive_folder_id'}
                FROM proyectos
            `).all();

        if (!Array.isArray(projects) || projects.length === 0) {
            return NextResponse.json({ error: 'No hay proyectos para reconciliar' }, { status: 404 });
        }

        const roles = [
            { rol: 'Traductor', field: 'traductor_url' },
            { rol: 'Redrawer', field: 'redraw_url' },
            { rol: 'Typer', field: 'typer_url' },
        ];

        let systemUserId = null;
        if (!dryRun) {
            systemUserId = await ensureSystemSyncUser(db);
        }

        const plan = [];
        let chaptersReady = 0;
        let inserts = 0;
        let promoted = 0;
        let updatedLinks = 0;
        const touchedProjects = new Set();

        for (const project of projects) {
            let catalog = [];
            if (forceDrive) {
                const folderId = folderIdOverride || String(project.drive_folder_id || '').trim();
                if (!folderId) {
                    continue;
                }
                try {
                    const driveScan = await catalogFromDriveByRoleFolders(folderId, mode);
                    catalog = normalizeCatalog(driveScan?.catalog || []);
                    if (!dryRun && hasCatalogColumn && catalog.length > 0) {
                        await db.prepare(`
                            UPDATE proyectos
                            SET capitulos_catalogo = ?, capitulos_totales = ?, ultima_actualizacion = CURRENT_TIMESTAMP
                            WHERE id = ?
                        `).run(
                            JSON.stringify(catalog),
                            Number(catalog[catalog.length - 1]?.numero || null),
                            project.id
                        );
                    }
                } catch {
                    catalog = [];
                }
            } else {
                try {
                    catalog = normalizeCatalog(JSON.parse(project.capitulos_catalogo || '[]'));
                } catch {
                    catalog = [];
                }
            }

            const readyChapters = catalog.filter((chapter) => hasAllDeliveryUrls(chapter));
            chaptersReady += readyChapters.length;

            for (const chapter of readyChapters) {
                for (const roleInfo of roles) {
                    const expectedUrl = String(chapter[roleInfo.field] || '').trim();
                    if (!expectedUrl) continue;

                    const completed = await db.prepare(`
                        SELECT id, drive_url
                        FROM asignaciones
                        WHERE proyecto_id = ?
                          AND capitulo = ?
                          AND rol = ?
                          AND estado = 'Completado'
                        ORDER BY datetime(completado_en) DESC, id DESC
                        LIMIT 1
                    `).get(project.id, chapter.numero, roleInfo.rol);

                    if (completed) {
                        if (!String(completed.drive_url || '').trim()) {
                            plan.push({
                                action: 'update_link_completed',
                                proyecto_id: Number(project.id),
                                proyecto_titulo: project.titulo,
                                capitulo: Number(chapter.numero),
                                rol: roleInfo.rol,
                                asignacion_id: Number(completed.id),
                                drive_url: expectedUrl,
                            });
                            if (!dryRun) {
                                await db.prepare('UPDATE asignaciones SET drive_url = ? WHERE id = ?').run(expectedUrl, completed.id);
                            }
                            updatedLinks += 1;
                            touchedProjects.add(Number(project.id));
                        }
                        continue;
                    }

                    const active = await db.prepare(`
                        SELECT id, drive_url
                        FROM asignaciones
                        WHERE proyecto_id = ?
                          AND capitulo = ?
                          AND rol = ?
                          AND estado IN ('Pendiente', 'En Proceso')
                        ORDER BY datetime(asignado_en) DESC, id DESC
                        LIMIT 1
                    `).get(project.id, chapter.numero, roleInfo.rol);

                    if (active) {
                        plan.push({
                            action: 'promote_active_to_completed',
                            proyecto_id: Number(project.id),
                            proyecto_titulo: project.titulo,
                            capitulo: Number(chapter.numero),
                            rol: roleInfo.rol,
                            asignacion_id: Number(active.id),
                            drive_url: expectedUrl,
                        });
                        if (!dryRun) {
                            const finalUrl = String(active.drive_url || '').trim() || expectedUrl;
                            await db.prepare(`
                                UPDATE asignaciones
                                SET estado = 'Completado',
                                    completado_en = CURRENT_TIMESTAMP,
                                    drive_url = ?
                                WHERE id = ?
                            `).run(finalUrl, active.id);
                        }
                        promoted += 1;
                        touchedProjects.add(Number(project.id));
                        continue;
                    }

                    plan.push({
                        action: 'insert_completed',
                        proyecto_id: Number(project.id),
                        proyecto_titulo: project.titulo,
                        capitulo: Number(chapter.numero),
                        rol: roleInfo.rol,
                        drive_url: expectedUrl,
                    });
                    if (!dryRun) {
                    await db.prepare(`
                        INSERT INTO asignaciones (
                            usuario_id, rol, descripcion, estado,
                            asignado_en, completado_en, informe, drive_url,
                            proyecto_id, capitulo, grupo_id_snapshot
                        )
                        VALUES (?, ?, ?, 'Completado', CURRENT_TIMESTAMP, NULL, NULL, ?, ?, ?, ?)
                    `).run(
                        systemUserId,
                        roleInfo.rol,
                        `${project.titulo} - Capitulo ${chapter.numero}`,
                        expectedUrl,
                        project.id,
                        chapter.numero,
                        project?.grupo_id ?? null
                    );
                    }
                    inserts += 1;
                    touchedProjects.add(Number(project.id));
                }
            }
        }

        if (!dryRun) {
            for (const id of touchedProjects) {
                await recalculateProjectProgress(db, id);
            }
            await refreshRankingRealtime(db, { notifyPositionChanges: true });
        }

        return NextResponse.json({
            ok: true,
            dry_run: dryRun,
            summary: {
                proyectos_revisados: projects.length,
                capitulos_con_3_entregas: chaptersReady,
                acciones_totales: plan.length,
                inserts,
                promoted,
                updated_links: updatedLinks,
            },
            preview: plan.slice(0, 200),
        });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
