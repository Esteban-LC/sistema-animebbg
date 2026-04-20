import { ensureAssignmentGroupSnapshotSchema, ensureAssignmentReviewSchema, getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createNotification, notifyRoles } from '@/lib/notifications';
import { getProjectCatalogEntries } from '@/lib/project-catalog';
import { publishAssignmentEvent, publishProjectEvent } from '@/lib/realtime';
import { refreshRankingRealtime } from '@/lib/ranking';
import { deleteDriveItemOAuth } from '@/lib/google-oauth';

const ACTIVE_ASSIGNMENT_STATES = ['Pendiente', 'En Proceso'];

async function hasAsignacionesColumn(db, columnName) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(asignaciones)`).all();
        return Array.isArray(tableInfo) && tableInfo.some((col) => col?.name === columnName);
    } catch {
        return false;
    }
}

async function ensureTraductorTipoColumn(db) {
    const exists = await hasAsignacionesColumn(db, 'traductor_tipo');
    if (exists) return true;
    try {
        await db.prepare(`ALTER TABLE asignaciones ADD COLUMN traductor_tipo TEXT CHECK(traductor_tipo IN ('CORE', 'ENG'))`).run();
    } catch {
        // verify below
    }
    return hasAsignacionesColumn(db, 'traductor_tipo');
}

async function hasAssignmentReviewColumns(db) {
    try {
        const tableInfo = await db.prepare(`PRAGMA table_info(asignaciones)`).all();
        if (!Array.isArray(tableInfo)) return false;
        const names = new Set(tableInfo.map((col) => col?.name));
        return names.has('review_status')
            && names.has('review_comment')
            && names.has('review_requested_at')
            && names.has('review_decision_at')
            && names.has('review_drive_item_id');
    } catch {
        return false;
    }
}

function normalizeUrlValue(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidDeliveryUrlForRole(rol, rawUrl) {
    const value = normalizeUrlValue(rawUrl);
    if (!value) return false;
    let url;
    try {
        url = new URL(value);
    } catch {
        return false;
    }

    const host = String(url.hostname || '').toLowerCase();
    const path = String(url.pathname || '').toLowerCase();
    const role = String(rol || '').toLowerCase();

    if (role === 'traductor') {
        const isGoogleDoc = host.includes('docs.google.com') && path.includes('/document/');
        const isDriveFile = host.includes('drive.google.com') && (
            /\/file\/d\/[^/?#]+/i.test(path) ||
            (path.includes('/open') && !!url.searchParams.get('id'))
        );
        return isGoogleDoc || isDriveFile;
    }

    if (role === 'typer' || role === 'redrawer') {
        if (!host.includes('drive.google.com')) return false;
        const hasFolderPath = /\/drive\/folders\/[^/?#]+/i.test(path);
        const hasFolderOpenId = path.includes('/open') && !!url.searchParams.get('id');
        return hasFolderPath || hasFolderOpenId;
    }

    return true;
}

function getDeliveryUrlError(rol) {
    const role = String(rol || '').toLowerCase();
    if (role === 'traductor') {
        return 'Para Traductor debes adjuntar un enlace de Google Docs o archivo de Drive antes de completar.';
    }
    if (role === 'typer' || role === 'redrawer') {
        return 'Para Typer/Redrawer debes adjuntar un enlace de carpeta de Drive antes de completar.';
    }
    return 'Debes adjuntar un enlace valido antes de completar.';
}

function getCatalogUrlForRole(entry, roleName) {
    if (!entry) return null;
    const role = String(roleName || '').toLowerCase();
    if (role === 'traductor') {
        return entry.traductor_url || null;
    }
    if (role === 'redrawer') {
        return entry.redraw_url || null;
    }
    if (role === 'typer') {
        return entry.typer_url || null;
    }
    return entry.traductor_url || entry.redraw_url || entry.typer_url || null;
}

function getCoreRawLabelByProjectType(tipo) {
    const normalized = String(tipo || '').toLowerCase();
    if (normalized === 'manga') return 'JAP';
    if (normalized === 'manhwa') return 'KO';
    return 'KO/JAP';
}

async function getProjectChapterUrl(db, proyectoId, capitulo, rol) {
    if (!proyectoId || capitulo === null || capitulo === undefined) return null;
    const proyecto = await db.prepare(`
        SELECT id, capitulos_catalogo, drive_folder_id, raw_folder_id, raw_eng_folder_id, traductor_folder_id, redraw_folder_id, typer_folder_id
        FROM proyectos
        WHERE id = ?
    `).get(proyectoId);
    if (!proyecto) return null;

    const entries = await getProjectCatalogEntries(db, proyecto);
    const match = entries.find((item) => Number(item.numero) === Number(capitulo));
    return getCatalogUrlForRole(match, rol);
}

async function recalculateProjectProgress(db, proyectoId) {
    if (!proyectoId) return;

    const progress = await db.prepare(`
        SELECT COALESCE(MAX(capitulo), 0) as capitulos_actuales
        FROM asignaciones
        WHERE proyecto_id = ? AND estado = 'Completado'
    `).get(proyectoId);

    await db.prepare(`
        UPDATE proyectos
        SET capitulos_actuales = ?, ultima_actualizacion = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(progress?.capitulos_actuales || 0, proyectoId);
}

async function getAuthContext(db) {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT s.usuario_id, u.roles, u.grupo_id
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);
    if (!session) return null;

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch {
        roles = [];
    }

    return {
        userId: Number(session.usuario_id),
        roles,
        isAdmin: roles.includes('Administrador'),
        isLeader: roles.includes('Lider de Grupo'),
        groupId: session?.grupo_id ?? null,
    };
}

async function getAsignacionDetalle(db, id, hasTraductorTipoColumn) {
    const hasReviewColumns = await hasAssignmentReviewColumns(db);
    const asignacion = await db.prepare(`
      SELECT
        a.id, a.usuario_id, a.rol, ${hasTraductorTipoColumn ? 'a.traductor_tipo' : 'NULL as traductor_tipo'}, a.descripcion, a.estado,
        a.asignado_en, a.completado_en, a.informe, a.drive_url, a.proyecto_id, a.capitulo, a.grupo_id_snapshot,
        ${hasReviewColumns ? 'a.review_status, a.review_comment, a.review_requested_at, a.review_decision_at, a.review_drive_item_id,' : "NULL as review_status, NULL as review_comment, NULL as review_requested_at, NULL as review_decision_at, NULL as review_drive_item_id,"}
        u.nombre as usuario_nombre,
        u.discord_username,
        p.titulo as proyecto_titulo,
        p.tipo as proyecto_tipo
      FROM asignaciones a
      JOIN usuarios u ON a.usuario_id = u.id
      LEFT JOIN proyectos p ON p.id = a.proyecto_id
      WHERE a.id = ?
    `).get(id);

    if (!asignacion) return null;
    const proyecto = await db.prepare(`
        SELECT id, tipo, capitulos_catalogo, drive_folder_id, raw_folder_id, raw_eng_folder_id, traductor_folder_id, redraw_folder_id, typer_folder_id, fuentes_config
        FROM proyectos
        WHERE id = ?
    `).get(asignacion.proyecto_id);
    const entries = await getProjectCatalogEntries(db, proyecto || { id: asignacion.proyecto_id });
    const match = entries.find((item) => Number(item.numero) === Number(asignacion.capitulo));
    const linkedDriveUrl = getCatalogUrlForRole(match, asignacion.rol);

    let proyecto_fuentes_config = null;
    try {
        proyecto_fuentes_config = proyecto?.fuentes_config ? JSON.parse(proyecto.fuentes_config) : null;
    } catch {
        proyecto_fuentes_config = null;
    }

    return {
        ...asignacion,
        drive_url: asignacion.drive_url || linkedDriveUrl || null,
        raw_url: String(match?.url || ''),
        raw_eng_url: String(match?.raw_eng_url || ''),
        core_raw_label: getCoreRawLabelByProjectType(asignacion?.proyecto_tipo || proyecto?.tipo),
        proyecto_fuentes_config,
    };
}

async function getAssignmentScopeGroupId(db, assignmentId) {
    if (!assignmentId) return null;
    const row = await db.prepare(`
        SELECT COALESCE(a.grupo_id_snapshot, p.grupo_id, u.grupo_id) AS grupo_id
        FROM asignaciones a
        LEFT JOIN proyectos p ON p.id = a.proyecto_id
        LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.id = ?
        LIMIT 1
    `).get(assignmentId);
    return row?.grupo_id ?? null;
}

async function getUserGroupId(db, userId) {
    if (!userId) return null;
    const row = await db.prepare('SELECT grupo_id FROM usuarios WHERE id = ?').get(userId);
    return row?.grupo_id ?? null;
}

async function getProjectGroupId(db, projectId) {
    if (!projectId) return null;
    const row = await db.prepare('SELECT grupo_id FROM proyectos WHERE id = ?').get(projectId);
    return row?.grupo_id ?? null;
}

async function countActiveAssignments(db, usuarioId, excludeAssignmentId = null) {
    if (!usuarioId) return 0;

    let query = `
        SELECT COUNT(*) as total
        FROM asignaciones
        WHERE usuario_id = ?
          AND estado IN (${ACTIVE_ASSIGNMENT_STATES.map(() => '?').join(', ')})
    `;
    const params = [usuarioId, ...ACTIVE_ASSIGNMENT_STATES];

    if (excludeAssignmentId) {
        query += ' AND id != ?';
        params.push(excludeAssignmentId);
    }

    const row = await db.prepare(query).get(...params);
    return Number(row?.total || 0);
}

async function resolveAsignacionId(contextOrParams) {
    const source = contextOrParams && 'params' in contextOrParams
        ? contextOrParams.params
        : contextOrParams;
    const params = await source;
    const idNum = Number(params?.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return null;
    return idNum;
}

export async function GET(request, context) {
    try {
        const id = await resolveAsignacionId(context);
        if (!id) return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        await ensureAssignmentReviewSchema(db);
        const traductorTipoColumnExists = await ensureTraductorTipoColumn(db);
        const auth = await getAuthContext(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const asignacion = await getAsignacionDetalle(db, id, traductorTipoColumnExists);
        if (!asignacion) {
            return NextResponse.json({ error: 'Asignacion no encontrada' }, { status: 404 });
        }

        const isOwner = Number(asignacion.usuario_id) === auth.userId;
        const assignmentGroupId = asignacion?.grupo_id_snapshot ?? await getAssignmentScopeGroupId(db, id);
        const canViewAsLeader = auth.isLeader && auth.groupId && Number(assignmentGroupId) === Number(auth.groupId);
        if (!auth.isAdmin && !canViewAsLeader && !isOwner) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        let responseData = asignacion;
        if (!auth.isAdmin && !canViewAsLeader) {
            const { raw_url, raw_eng_url, ...rest } = asignacion;
            responseData = {
                ...rest,
                has_eng_raw: !!raw_url,
                has_core_raw: !!raw_eng_url,
            };
        }
        return NextResponse.json(responseData);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PATCH(request, context) {
    try {
        const id = await resolveAsignacionId(context);
        if (!id) return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        const body = await request.json();
        const { estado, informe, drive_url, usuario_id, capitulo, reset_tiro, traductor_tipo, review_action, review_comment } = body;

        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        await ensureAssignmentReviewSchema(db);
        const traductorTipoColumnExists = await ensureTraductorTipoColumn(db);
        const auth = await getAuthContext(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

        const actor = await db.prepare('SELECT nombre FROM usuarios WHERE id = ?').get(auth.userId);
        const actorName = actor?.nombre || 'Sistema';

        const asignacionOriginal = await db.prepare(`
            SELECT a.usuario_id, a.proyecto_id, a.rol, a.capitulo, a.estado, a.drive_url, a.descripcion, p.titulo as proyecto_titulo
                   , a.review_status, a.review_drive_item_id
            FROM asignaciones a
            LEFT JOIN proyectos p ON p.id = a.proyecto_id
            WHERE a.id = ?
        `).get(id);
        if (!asignacionOriginal) {
            return NextResponse.json({ error: 'Asignacion no encontrada' }, { status: 404 });
        }

        const prevUsuarioId = Number(asignacionOriginal.usuario_id);
        const prevCapitulo = asignacionOriginal.capitulo;
        const prevEstado = asignacionOriginal.estado;

        const assignmentGroupId = await getAssignmentScopeGroupId(db, id);
        const isOwner = Number(asignacionOriginal.usuario_id) === auth.userId;
        const canTouchAsLeader = auth.isLeader && auth.groupId && Number(assignmentGroupId) === Number(auth.groupId);
        const canTouch = auth.isAdmin || canTouchAsLeader || isOwner;
        if (!canTouch) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
        }

        const wantsAdminOnlyAction = usuario_id !== undefined || capitulo !== undefined || reset_tiro || traductor_tipo !== undefined;
        if (wantsAdminOnlyAction && !auth.isAdmin) {
            return NextResponse.json({ error: 'Solo administradores pueden reasignar, cambiar capitulo o resetear tiro' }, { status: 403 });
        }

        if (usuario_id !== undefined) {
            const nextUsuarioId = Number(usuario_id);
            const activeAssignmentsCount = await countActiveAssignments(db, nextUsuarioId, id);
            if (activeAssignmentsCount >= 2) {
                return NextResponse.json({ error: 'Este miembro ya tiene 2 asignaciones activas. Completa o libera una antes de reasignar otra.' }, { status: 400 });
            }
            await db.prepare('UPDATE asignaciones SET usuario_id = ? WHERE id = ?').run(usuario_id, id);
            if (!asignacionOriginal.proyecto_id) {
                const nextUserGroupId = await getUserGroupId(db, nextUsuarioId);
                await db.prepare('UPDATE asignaciones SET grupo_id_snapshot = ? WHERE id = ?').run(nextUserGroupId, id);
            }
        }

        if (traductor_tipo !== undefined) {
            const normalizedType = String(traductor_tipo || '').toUpperCase() === 'ENG' ? 'ENG' : 'CORE';
            if (String(asignacionOriginal.rol) !== 'Traductor') {
                return NextResponse.json({ error: 'traductor_tipo solo aplica al rol Traductor' }, { status: 400 });
            }
            if (!traductorTipoColumnExists) {
                return NextResponse.json({ error: 'No se pudo habilitar traductor_tipo en la base de datos' }, { status: 500 });
            }
            await db.prepare('UPDATE asignaciones SET traductor_tipo = ? WHERE id = ?').run(normalizedType, id);
        }

        if (drive_url !== undefined && estado !== 'Completado') {
            await db.prepare('UPDATE asignaciones SET drive_url = ? WHERE id = ?').run(drive_url, id);
        }

        if (review_action !== undefined) {
            if (!auth.isAdmin && !canTouchAsLeader) {
                return NextResponse.json({ error: 'Solo administradores o lideres pueden revisar entregas' }, { status: 403 });
            }
            if (String(asignacionOriginal.review_status || '') !== 'Pendiente') {
                return NextResponse.json({ error: 'Esta asignacion no tiene una entrega pendiente de revision' }, { status: 400 });
            }

            const normalizedReviewComment = String(review_comment || '').trim();
            if (review_action === 'approve') {
                const finalDriveUrl = normalizeUrlValue(asignacionOriginal.drive_url);
                if (!isValidDeliveryUrlForRole(asignacionOriginal.rol, finalDriveUrl)) {
                    return NextResponse.json({ error: getDeliveryUrlError(asignacionOriginal.rol) }, { status: 400 });
                }

                await db.prepare(`
                    UPDATE asignaciones
                    SET estado = 'Completado',
                        completado_en = CURRENT_TIMESTAMP,
                        review_status = 'Aprobado',
                        review_comment = ?,
                        review_decision_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(normalizedReviewComment || null, id);

                await recalculateProjectProgress(db, asignacionOriginal?.proyecto_id);
            } else if (review_action === 'reject') {
                if (!normalizedReviewComment) {
                    return NextResponse.json({ error: 'Agrega un comentario para explicar el rechazo' }, { status: 400 });
                }

                const reviewDriveItemId = String(asignacionOriginal.review_drive_item_id || '').trim();
                if (reviewDriveItemId) {
                    try {
                        await deleteDriveItemOAuth(reviewDriveItemId);
                    } catch (error) {
                        return NextResponse.json({
                            error: error instanceof Error ? error.message : 'No se pudo eliminar la entrega de Drive'
                        }, { status: 500 });
                    }
                }

                await db.prepare(`
                    UPDATE asignaciones
                    SET estado = 'En Proceso',
                        drive_url = NULL,
                        completado_en = NULL,
                        review_status = 'Rechazado',
                        review_comment = ?,
                        review_requested_at = NULL,
                        review_decision_at = CURRENT_TIMESTAMP,
                        review_drive_item_id = NULL
                    WHERE id = ?
                `).run(normalizedReviewComment, id);
            } else {
                return NextResponse.json({ error: 'Accion de revision no valida' }, { status: 400 });
            }
        }

        if (capitulo !== undefined) {
            if (!asignacionOriginal.proyecto_id) {
                return NextResponse.json({ error: 'Solo se puede editar capitulo en asignaciones de proyecto' }, { status: 400 });
            }

            const duplicada = await db.prepare(`
                SELECT id
                FROM asignaciones
                WHERE proyecto_id = ?
                  AND capitulo = ?
                  AND rol = ?
                  AND estado != 'Completado'
                  AND id != ?
            `).get(asignacionOriginal.proyecto_id, capitulo, asignacionOriginal.rol, id);

            if (duplicada) {
                return NextResponse.json({ error: 'Ya existe una asignacion activa para este capitulo y rol' }, { status: 400 });
            }

            const chapterNumber = Number(capitulo);
            const chapterDescription = `${asignacionOriginal.proyecto_titulo || 'Proyecto'} - Capitulo ${chapterNumber}`;
            await db.prepare('UPDATE asignaciones SET capitulo = ?, descripcion = ? WHERE id = ?').run(chapterNumber, chapterDescription, id);
            const linkedDriveUrl = await getProjectChapterUrl(db, asignacionOriginal.proyecto_id, capitulo, asignacionOriginal.rol);
            const normalizedManualDrive = normalizeUrlValue(drive_url);
            if (normalizedManualDrive) {
                await db.prepare('UPDATE asignaciones SET drive_url = ? WHERE id = ?').run(normalizedManualDrive, id);
            } else if (linkedDriveUrl) {
                await db.prepare('UPDATE asignaciones SET drive_url = ? WHERE id = ?').run(linkedDriveUrl, id);
            }
        }

        if (reset_tiro) {
            await db.prepare(`
                UPDATE asignaciones
                SET estado = 'Pendiente',
                    proyecto_id = NULL,
                    capitulo = NULL,
                    completado_en = NULL,
                    informe = NULL,
                    grupo_id_snapshot = ?,
                    review_status = NULL,
                    review_comment = NULL,
                    review_requested_at = NULL,
                    review_decision_at = NULL,
                    review_drive_item_id = NULL
                WHERE id = ?
            `).run(await getUserGroupId(db, Number(usuario_id ?? asignacionOriginal.usuario_id)), id);

            await recalculateProjectProgress(db, asignacionOriginal?.proyecto_id);
        }

        if (estado !== undefined) {
            if (estado === 'Completado') {
                const finalDriveUrl = normalizeUrlValue(
                    drive_url !== undefined ? drive_url : asignacionOriginal.drive_url
                );
                if (!isValidDeliveryUrlForRole(asignacionOriginal.rol, finalDriveUrl)) {
                    return NextResponse.json({ error: getDeliveryUrlError(asignacionOriginal.rol) }, { status: 400 });
                }

                const needsReview = isOwner && !auth.isAdmin && !auth.isLeader;
                await db.prepare('UPDATE asignaciones SET drive_url = ? WHERE id = ?').run(finalDriveUrl, id);

                if (needsReview) {
                    const params = informe ? [informe, id] : [id];
                    const sql = informe
                        ? `UPDATE asignaciones
                           SET estado = 'En Proceso',
                               informe = ?,
                               completado_en = NULL,
                               review_status = 'Pendiente',
                               review_requested_at = CURRENT_TIMESTAMP,
                               review_decision_at = NULL,
                               review_comment = NULL
                           WHERE id = ?`
                        : `UPDATE asignaciones
                           SET estado = 'En Proceso',
                               completado_en = NULL,
                               review_status = 'Pendiente',
                               review_requested_at = CURRENT_TIMESTAMP,
                               review_decision_at = NULL,
                               review_comment = NULL
                           WHERE id = ?`;
                    await db.prepare(sql).run(...params);
                } else {
                    const params = informe ? [estado, informe, id] : [estado, id];
                    const sql = informe
                        ? `UPDATE asignaciones
                           SET estado = ?, completado_en = CURRENT_TIMESTAMP, informe = ?,
                               review_status = 'Aprobado', review_decision_at = CURRENT_TIMESTAMP
                           WHERE id = ?`
                        : `UPDATE asignaciones
                           SET estado = ?, completado_en = CURRENT_TIMESTAMP,
                               review_status = 'Aprobado', review_decision_at = CURRENT_TIMESTAMP
                           WHERE id = ?`;

                    await db.prepare(sql).run(...params);
                }
            } else {
                await db.prepare(`
                    UPDATE asignaciones
                    SET estado = ?,
                        review_status = CASE WHEN ? = 'Pendiente' THEN NULL ELSE review_status END,
                        review_requested_at = CASE WHEN ? = 'Pendiente' THEN NULL ELSE review_requested_at END
                    WHERE id = ?
                `).run(estado, estado, estado, id);
            }

            await recalculateProjectProgress(db, asignacionOriginal?.proyecto_id);
        }

        const asignacion = await getAsignacionDetalle(db, id, traductorTipoColumnExists);

        if (usuario_id !== undefined && Number(usuario_id) !== prevUsuarioId) {
            const reassignedGroupId = await getAssignmentScopeGroupId(db, id);
            await createNotification(db, {
                usuarioId: Number(usuario_id),
                tipo: 'reasignacion',
                titulo: 'Nueva reasignacion',
                mensaje: `Te reasignaron ${asignacion?.proyecto_titulo || asignacion?.descripcion || 'una tarea'} (${asignacion?.rol})`,
                data: { asignacion_id: Number(id) },
            });

            await createNotification(db, {
                usuarioId: prevUsuarioId,
                tipo: 'reasignacion',
                titulo: 'Asignacion reasignada',
                mensaje: `${actorName} reasigno tu tarea ${asignacion?.proyecto_titulo || asignacion?.descripcion || ''}`,
                data: { asignacion_id: Number(id) },
            });

            await notifyRoles(
                db,
                ['Administrador', 'Lider de Grupo'],
                {
                    tipo: 'asignacion_evento',
                    titulo: 'Reasignacion',
                    mensaje: `${actorName} reasigno ${asignacion?.proyecto_titulo || 'tarea'} (${asignacion?.rol})`,
                    data: { asignacion_id: Number(id) },
                },
                { excludeUserIds: [auth.userId], groupId: reassignedGroupId }
            );
        }

        if (capitulo !== undefined && Number(capitulo) !== Number(prevCapitulo)) {
            await createNotification(db, {
                usuarioId: Number(asignacion?.usuario_id),
                tipo: 'cambio_capitulo',
                titulo: 'Capitulo actualizado',
                mensaje: `${asignacion?.proyecto_titulo || 'Proyecto'} ahora es Cap. ${asignacion?.capitulo} (${asignacion?.rol})`,
                data: { asignacion_id: Number(id) },
            });
        }

        if (reset_tiro) {
            await createNotification(db, {
                usuarioId: Number(asignacion?.usuario_id),
                tipo: 'reset_tiro',
                titulo: 'Tiro reseteado',
                mensaje: `${actorName} reseteo tu tiro en ${asignacion?.proyecto_titulo || 'proyecto'}`,
                data: { asignacion_id: Number(id) },
            });
        }

        if (review_action === 'approve') {
            await createNotification(db, {
                usuarioId: Number(asignacion?.usuario_id),
                tipo: 'revision_aprobada',
                titulo: 'Entrega aprobada',
                mensaje: `${actorName} aprobo tu entrega en ${asignacion?.proyecto_titulo || 'proyecto'}${asignacion?.capitulo ? ` (Cap. ${asignacion.capitulo})` : ''}`,
                data: { asignacion_id: Number(id) },
            });
        }

        if (review_action === 'reject') {
            const reasonText = String(review_comment || '').trim();
            await createNotification(db, {
                usuarioId: Number(asignacion?.usuario_id),
                tipo: 'revision_rechazada',
                titulo: 'Entrega rechazada',
                mensaje: `${actorName} rechazo tu entrega en ${asignacion?.proyecto_titulo || 'proyecto'}${asignacion?.capitulo ? ` (Cap. ${asignacion.capitulo})` : ''}. ${reasonText}`,
                data: { asignacion_id: Number(id) },
            });
        }

        if (estado !== undefined && estado !== prevEstado) {
            const currentGroupId = await getAssignmentScopeGroupId(db, id);
            await notifyRoles(
                db,
                ['Administrador', 'Lider de Grupo'],
                {
                    tipo: 'estado_tarea',
                    titulo: `Estado: ${estado}`,
                    mensaje: `${asignacion?.usuario_nombre || 'Usuario'} cambio a "${estado}" en ${asignacion?.proyecto_titulo || 'tarea'}${asignacion?.capitulo ? ` (Cap. ${asignacion.capitulo})` : ''}`,
                    data: { asignacion_id: Number(id) },
                },
                { excludeUserIds: [auth.userId], groupId: currentGroupId }
            );
        }

        if (String(asignacion?.review_status || '') === 'Pendiente' && (review_action === undefined && estado === 'Completado')) {
            const currentGroupId = await getAssignmentScopeGroupId(db, id);
            await notifyRoles(
                db,
                ['Administrador', 'Lider de Grupo'],
                {
                    tipo: 'entrega_revision',
                    titulo: 'Entrega pendiente de revision',
                    mensaje: `${asignacion?.usuario_nombre || 'Usuario'} envio entrega para revision en ${asignacion?.proyecto_titulo || 'tarea'}${asignacion?.capitulo ? ` (Cap. ${asignacion.capitulo})` : ''}`,
                    data: { asignacion_id: Number(id) },
                },
                { excludeUserIds: [auth.userId], groupId: currentGroupId }
            );
        }

        const assignedUserId = Number(asignacion?.usuario_id || prevUsuarioId);
        const assignedGroupId = await getAssignmentScopeGroupId(db, id);
        publishAssignmentEvent({
            action: 'updated',
            assignment_id: Number(id),
            usuario_id: assignedUserId,
            proyecto_id: asignacion?.proyecto_id ? Number(asignacion.proyecto_id) : (asignacionOriginal?.proyecto_id ? Number(asignacionOriginal.proyecto_id) : null),
            group_id: assignedGroupId ? Number(assignedGroupId) : null,
            ts: Date.now(),
        });

        const affectedProjectIds = new Set();
        if (asignacionOriginal?.proyecto_id) affectedProjectIds.add(Number(asignacionOriginal.proyecto_id));
        if (asignacion?.proyecto_id) affectedProjectIds.add(Number(asignacion.proyecto_id));
        for (const projectId of affectedProjectIds) {
            const projectGroupId = await getProjectGroupId(db, projectId);
            publishProjectEvent({
                action: 'updated',
                project_id: Number(projectId),
                group_id: projectGroupId ? Number(projectGroupId) : null,
                ts: Date.now(),
            });
        }

        const rankingGroupIds = new Set();
        if (assignedGroupId) rankingGroupIds.add(Number(assignedGroupId));
        await refreshRankingRealtime(db, {
            groupIds: [...rankingGroupIds],
            notifyPositionChanges: true,
        });

        return NextResponse.json(asignacion);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function PUT(request, context) {
    return PATCH(request, context);
}

export async function DELETE(request, { params }) {
    try {
        const id = await resolveAsignacionId(params);
        if (!id) return NextResponse.json({ error: 'ID de asignacion invalido' }, { status: 400 });
        const db = getDb();
        await ensureAssignmentGroupSnapshotSchema(db);
        const auth = await getAuthContext(db);
        if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
        if (!auth.isAdmin) return NextResponse.json({ error: 'Solo administradores' }, { status: 403 });

        const asignacionOriginal = await db.prepare('SELECT proyecto_id, usuario_id FROM asignaciones WHERE id = ?').get(id);
        const result = await db.prepare('DELETE FROM asignaciones WHERE id = ?').run(id);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Asignacion no encontrada' }, { status: 404 });
        }

        await recalculateProjectProgress(db, asignacionOriginal?.proyecto_id);
        const assignedGroupId = await getAssignmentScopeGroupId(db, id);
        publishAssignmentEvent({
            action: 'deleted',
            assignment_id: Number(id),
            usuario_id: asignacionOriginal?.usuario_id ? Number(asignacionOriginal.usuario_id) : null,
            proyecto_id: asignacionOriginal?.proyecto_id ? Number(asignacionOriginal.proyecto_id) : null,
            group_id: assignedGroupId ? Number(assignedGroupId) : null,
            ts: Date.now(),
        });
        if (asignacionOriginal?.proyecto_id) {
            const projectGroupId = await getProjectGroupId(db, Number(asignacionOriginal.proyecto_id));
            publishProjectEvent({
                action: 'updated',
                project_id: Number(asignacionOriginal.proyecto_id),
                group_id: projectGroupId ? Number(projectGroupId) : null,
                ts: Date.now(),
            });
        }
        const originalGroupId = assignedGroupId;
        await refreshRankingRealtime(db, {
            groupIds: originalGroupId ? [Number(originalGroupId)] : [],
            notifyPositionChanges: true,
        });
        return NextResponse.json({ message: 'Asignacion eliminada' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
