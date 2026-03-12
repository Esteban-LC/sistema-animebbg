import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ensureSuggestionSchema, getDb } from '@/lib/db';

const SUGGESTIONS_TIMEZONE = 'America/Mexico_City';
const MAX_VOTES_PER_ROUND = 3;

function parseRoles(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isDateTimeLocal(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value);
}

function toSqlDateTime(value) {
  return `${value.replace('T', ' ')}:00`;
}

function toDateTimeInput(value) {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 16);
}

function getCurrentDateTimeInTimezone(timeZone = SUGGESTIONS_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day} ${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

async function getViewer(db) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;

  const user = await db.prepare(`
    SELECT u.*, g.nombre AS grupo_nombre
    FROM sessions s
    JOIN usuarios u ON u.id = s.usuario_id
    LEFT JOIN grupos g ON g.id = u.grupo_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);

  if (!user) return null;

  const roles = parseRoles(user.roles);
  return {
    id: Number(user.id),
    nombre: user.nombre,
    tag: user.tag,
    grupo_id: user.grupo_id ? Number(user.grupo_id) : null,
    grupo_nombre: user.grupo_nombre || null,
    isAdmin: roles.includes('Administrador'),
    isLeader: roles.includes('Lider de Grupo'),
  };
}

function getScope(viewer) {
  if (viewer?.grupo_id) return { clause: 'WHERE r.grupo_id = ?', args: [viewer.grupo_id] };
  return { clause: 'WHERE r.grupo_id IS NULL', args: [] };
}

async function getSuggestionVoters(db, suggestionId) {
  const rows = await db.prepare(`
    SELECT
      u.id,
      u.nombre,
      u.tag,
      u.avatar_url
    FROM sugerencia_votos_items v
    JOIN usuarios u ON u.id = v.usuario_id
    WHERE v.sugerencia_id = ?
    ORDER BY v.creado_en ASC
  `).all(suggestionId);

  return (rows || []).map((item) => ({
    id: Number(item.id),
    nombre: item.nombre || '',
    tag: item.tag || '',
    avatar_url: item.avatar_url || '',
  }));
}

async function getEligibleCount(db, groupId) {
  const row = groupId
    ? await db.prepare(`SELECT COUNT(*) AS total FROM usuarios WHERE activo = 1 AND grupo_id = ?`).get(groupId)
    : await db.prepare(`SELECT COUNT(*) AS total FROM usuarios WHERE activo = 1`).get();
  return Number(row?.total || 0);
}

async function normalizeRoundStates(db) {
  const nowLocal = getCurrentDateTimeInTimezone();

  await db.prepare(`
    UPDATE sugerencia_rondas
    SET estado = 'cerrada', cerrado_en = COALESCE(cerrado_en, ?), pausado_en = NULL
    WHERE estado != 'cerrada' AND end_at IS NOT NULL AND end_at < ?
  `).run(nowLocal, nowLocal);

  await db.prepare(`
    UPDATE sugerencia_rondas
    SET estado = 'activa', iniciado_en = COALESCE(iniciado_en, ?)
    WHERE estado = 'borrador'
      AND start_at IS NOT NULL
      AND end_at IS NOT NULL
      AND start_at <= ?
      AND end_at >= ?
  `).run(nowLocal, nowLocal, nowLocal);
}

async function getCurrentRound(db, viewer) {
  await normalizeRoundStates(db);

  const scope = getScope(viewer);
  const rows = await db.prepare(`
    SELECT
      r.*,
      g.nombre AS grupo_nombre,
      creator.nombre AS creador_nombre,
      creator.tag AS creador_tag
    FROM sugerencia_rondas r
    LEFT JOIN grupos g ON g.id = r.grupo_id
    LEFT JOIN usuarios creator ON creator.id = r.creado_por
    ${scope.clause}
      ${scope.clause ? 'AND' : 'WHERE'} r.estado IN ('borrador', 'activa', 'pausada')
    ORDER BY
      CASE r.estado
        WHEN 'activa' THEN 0
        WHEN 'pausada' THEN 1
        ELSE 2
      END,
      COALESCE(r.start_at, r.creado_en) DESC
    LIMIT 1
  `).all(...scope.args);

  return rows?.[0] || null;
}

async function serializeRound(db, viewer, round) {
  if (!round) return null;

  const eligibleCount = await getEligibleCount(db, round.grupo_id ? Number(round.grupo_id) : null);
  const suggestions = await db.prepare(`
    SELECT
      s.*,
      proposer.nombre AS recomendador_nombre,
      proposer.tag AS recomendador_tag,
      COALESCE(v.vote_count, 0) AS votos,
      uv.sugerencia_id AS viewer_vote
    FROM sugerencias s
    LEFT JOIN usuarios proposer ON proposer.id = s.creada_por
    LEFT JOIN (
      SELECT sugerencia_id, COUNT(*) AS vote_count
      FROM sugerencia_votos_items
      WHERE ronda_id = ?
      GROUP BY sugerencia_id
    ) v ON v.sugerencia_id = s.id
    LEFT JOIN (
      SELECT sugerencia_id
      FROM sugerencia_votos_items
      WHERE ronda_id = ? AND usuario_id = ?
    ) uv ON uv.sugerencia_id = s.id
    WHERE s.ronda_id = ? AND s.estado = 'activa'
    ORDER BY votos DESC, s.creado_en DESC
  `).all(round.id, round.id, viewer.id, round.id);

  const totalVotesRow = await db.prepare(`SELECT COUNT(*) AS total FROM sugerencia_votos_items WHERE ronda_id = ?`).get(round.id);
  const viewerSuggestionCount = await db.prepare(`SELECT COUNT(*) AS total FROM sugerencias WHERE ronda_id = ? AND creada_por = ?`).get(round.id, viewer.id);
  const viewerVote = await db.prepare(`SELECT sugerencia_id FROM sugerencia_votos_items WHERE ronda_id = ? AND usuario_id = ? LIMIT 1`).get(round.id, viewer.id);
  const viewerVoteCountRow = await db.prepare(`SELECT COUNT(*) AS total FROM sugerencia_votos_items WHERE ronda_id = ? AND usuario_id = ?`).get(round.id, viewer.id);

  const serializedSuggestions = [];
  for (const item of suggestions || []) {
    serializedSuggestions.push({
      id: Number(item.id),
      ronda_id: Number(item.ronda_id),
      titulo: item.titulo,
      sinopsis: item.sinopsis || '',
      tipo_obra: item.tipo_obra || '',
      imagen_url: item.imagen_url || '',
      url_publicacion: item.url_publicacion || '',
      proyecto_exportado_id: item.proyecto_exportado_id ? Number(item.proyecto_exportado_id) : null,
      creado_en: item.creado_en,
      recomendador_nombre: item.recomendador_nombre || '',
      recomendador_tag: item.recomendador_tag || '',
      votos: Number(item.votos || 0),
      voted_by_me: Boolean(item.viewer_vote),
      voters: await getSuggestionVoters(db, Number(item.id)),
    });
  }

  return {
    id: Number(round.id),
    titulo: round.titulo,
    descripcion: round.descripcion || '',
    estado: round.estado,
    grupo_id: round.grupo_id ? Number(round.grupo_id) : null,
    grupo_nombre: round.grupo_nombre || 'General',
    creado_en: round.creado_en,
    start_at: round.start_at,
    end_at: round.end_at,
    iniciado_en: round.iniciado_en,
    pausado_en: round.pausado_en,
    cerrado_en: round.cerrado_en,
    creador_nombre: round.creador_nombre || '',
    creador_tag: round.creador_tag || '',
    eligible_count: eligibleCount,
    total_votes: Number(totalVotesRow?.total || 0),
    viewer_suggestion_count: Number(viewerSuggestionCount?.total || 0),
    viewer_vote_count: Number(viewerVoteCountRow?.total || 0),
    max_votes_per_round: MAX_VOTES_PER_ROUND,
    viewer_voted: Boolean(viewerVote?.sugerencia_id),
    suggestions: serializedSuggestions,
  };
}

async function getHistory(db, viewer) {
  const scope = getScope(viewer);
  const rows = await db.prepare(`
    SELECT r.*, g.nombre AS grupo_nombre
    FROM sugerencia_rondas r
    LEFT JOIN grupos g ON g.id = r.grupo_id
    ${scope.clause}
      ${scope.clause ? 'AND' : 'WHERE'} r.estado = 'cerrada'
    ORDER BY COALESCE(r.cerrado_en, r.end_at, r.creado_en) DESC
    LIMIT 12
  `).all(...scope.args);

  const items = [];
  for (const row of rows || []) {
    const suggestions = await db.prepare(`
      SELECT
        s.id,
        s.titulo,
        s.tipo_obra,
        s.sinopsis,
        s.imagen_url,
        s.url_publicacion,
        s.proyecto_exportado_id,
        proposer.nombre AS recomendador_nombre,
        proposer.tag AS recomendador_tag,
        COUNT(v.id) AS votos
      FROM sugerencias s
      LEFT JOIN usuarios proposer ON proposer.id = s.creada_por
      LEFT JOIN sugerencia_votos_items v ON v.sugerencia_id = s.id
      WHERE s.ronda_id = ? AND s.estado = 'activa'
      GROUP BY s.id, s.titulo, s.tipo_obra, s.sinopsis, s.imagen_url, s.url_publicacion, s.proyecto_exportado_id, proposer.nombre, proposer.tag
      ORDER BY votos DESC, s.creado_en DESC
    `).all(row.id);
    const winner = await db.prepare(`
      SELECT s.titulo, COUNT(v.id) AS votos
      FROM sugerencias s
      LEFT JOIN sugerencia_votos_items v ON v.sugerencia_id = s.id
      WHERE s.ronda_id = ? AND s.estado = 'activa'
      GROUP BY s.id, s.titulo
      ORDER BY votos DESC, s.creado_en DESC
      LIMIT 1
    `).get(row.id);
    const mySuggestions = await db.prepare(`SELECT COUNT(*) AS total FROM sugerencias WHERE ronda_id = ? AND creada_por = ?`).get(row.id, viewer.id);
    const myVote = await db.prepare(`
      SELECT s.titulo
      FROM sugerencia_votos_items v
      JOIN sugerencias s ON s.id = v.sugerencia_id
      WHERE v.ronda_id = ? AND v.usuario_id = ?
    `).get(row.id, viewer.id);

    items.push({
      id: Number(row.id),
      titulo: row.titulo,
      descripcion: row.descripcion || '',
      grupo_nombre: row.grupo_nombre || 'General',
      start_at: row.start_at,
      end_at: row.end_at,
      cerrado_en: row.cerrado_en,
      total_votes: Number((await db.prepare(`SELECT COUNT(*) AS total FROM sugerencia_votos_items WHERE ronda_id = ?`).get(row.id))?.total || 0),
      winner_title: winner?.titulo || '',
      winner_votes: Number(winner?.votos || 0),
      my_suggestions: Number(mySuggestions?.total || 0),
      my_vote_title: myVote?.titulo || '',
      suggestions: (suggestions || []).map((item) => ({
        id: Number(item.id),
        titulo: item.titulo,
        tipo_obra: item.tipo_obra || '',
        sinopsis: item.sinopsis || '',
        imagen_url: item.imagen_url || '',
        url_publicacion: item.url_publicacion || '',
        proyecto_exportado_id: item.proyecto_exportado_id ? Number(item.proyecto_exportado_id) : null,
        recomendador_nombre: item.recomendador_nombre || '',
        recomendador_tag: item.recomendador_tag || '',
        votos: Number(item.votos || 0),
      })),
    });
  }

  for (const period of items) {
    for (const suggestion of period.suggestions) {
      suggestion.voters = await getSuggestionVoters(db, suggestion.id);
    }
  }

  return items;
}

async function getConfig(db, viewer) {
  const current = await getCurrentRound(db, viewer);
  if (!current) {
    return {
      start_at: '',
      end_at: '',
      status: 'sin_configurar',
    };
  }

  return {
    round_id: Number(current.id),
    start_at: toDateTimeInput(current.start_at),
    end_at: toDateTimeInput(current.end_at),
    status: current.estado,
  };
}

export async function GET() {
  try {
    const db = getDb();
    await ensureSuggestionSchema(db);
    const viewer = await getViewer(db);
    if (!viewer) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const current = await serializeRound(db, viewer, await getCurrentRound(db, viewer));

    const mySuggestions = await db.prepare(`
      SELECT
        s.id,
        s.titulo,
        s.sinopsis,
        s.tipo_obra,
        s.imagen_url,
        s.url_publicacion,
        s.proyecto_exportado_id,
        s.creado_en,
        r.titulo AS ronda_titulo,
        r.estado AS ronda_estado,
        r.start_at,
        r.end_at,
        COALESCE(v.vote_count, 0) AS votos
      FROM sugerencias s
      JOIN sugerencia_rondas r ON r.id = s.ronda_id
      LEFT JOIN (
        SELECT sugerencia_id, COUNT(*) AS vote_count
        FROM sugerencia_votos_items
        GROUP BY sugerencia_id
      ) v ON v.sugerencia_id = s.id
      WHERE s.creada_por = ?
      ORDER BY s.creado_en DESC
    `).all(viewer.id);

    const myVotes = await db.prepare(`
      SELECT
        v.creado_en AS voted_at,
        s.id AS sugerencia_id,
        s.titulo AS sugerencia_titulo,
        r.titulo AS ronda_titulo,
        r.estado AS ronda_estado,
        r.start_at,
        r.end_at
      FROM sugerencia_votos_items v
      JOIN sugerencias s ON s.id = v.sugerencia_id
      JOIN sugerencia_rondas r ON r.id = v.ronda_id
      WHERE v.usuario_id = ?
      ORDER BY v.creado_en DESC
    `).all(viewer.id);

    return NextResponse.json({
      viewer,
      config: await getConfig(db, viewer),
      current,
      history: await getHistory(db, viewer),
      mySuggestions: (mySuggestions || []).map((item) => ({
        id: Number(item.id),
        titulo: item.titulo,
        sinopsis: item.sinopsis || '',
        tipo_obra: item.tipo_obra || '',
        imagen_url: item.imagen_url || '',
        url_publicacion: item.url_publicacion || '',
        proyecto_exportado_id: item.proyecto_exportado_id ? Number(item.proyecto_exportado_id) : null,
        creado_en: item.creado_en,
        ronda_titulo: item.ronda_titulo,
        ronda_estado: item.ronda_estado,
        start_at: item.start_at,
        end_at: item.end_at,
        votos: Number(item.votos || 0),
      })),
      myVotes: (myVotes || []).map((item) => ({
        sugerencia_id: Number(item.sugerencia_id),
        sugerencia_titulo: item.sugerencia_titulo,
        ronda_titulo: item.ronda_titulo,
        ronda_estado: item.ronda_estado,
        start_at: item.start_at,
        end_at: item.end_at,
        voted_at: item.voted_at,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const db = getDb();
    await ensureSuggestionSchema(db);
    const viewer = await getViewer(db);
    if (!viewer) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

    const body = await request.json();
    const type = String(body?.type || '').trim();

    if (type === 'suggestion') {
      const current = await getCurrentRound(db, viewer);
      if (!current) return NextResponse.json({ error: 'No hay votacion actual configurada' }, { status: 400 });
      if (current.estado === 'cerrada') return NextResponse.json({ error: 'La votacion actual ya esta cerrada' }, { status: 400 });

      const titulo = String(body?.titulo || '').trim();
      const urlPublicacion = String(body?.url_publicacion || '').trim();
      const imagenUrl = String(body?.imagen_url || '').trim();
      const sinopsis = String(body?.sinopsis || '').trim();
      const tipoObra = String(body?.tipo_obra || '').trim();

      if (!titulo || !urlPublicacion || !imagenUrl || !['Manga', 'Manhwa', 'Manhua'].includes(tipoObra)) {
        return NextResponse.json({ error: 'Nombre, tipo, URL e imagen son obligatorios' }, { status: 400 });
      }

      const result = await db.prepare(`
        INSERT INTO sugerencias (
          ronda_id, titulo, descripcion, categoria, imagen_url, creada_por, url_publicacion, sinopsis, tipo_obra
        )
        VALUES (?, ?, '', 'Actuales', ?, ?, ?, ?, ?)
      `).run(
        current.id,
        titulo,
        imagenUrl,
        viewer.id,
        urlPublicacion,
        sinopsis || null,
        tipoObra
      );

      return NextResponse.json({ success: true, id: Number(result?.lastInsertRowid || 0) });
    }

    if (type === 'vote') {
      const current = await getCurrentRound(db, viewer);
      if (!current) return NextResponse.json({ error: 'No hay votacion actual' }, { status: 400 });
      if (current.estado !== 'activa') return NextResponse.json({ error: 'La votacion no esta activa en este momento' }, { status: 400 });

      const suggestionId = Number(body?.sugerencia_id || 0);
      if (!suggestionId) return NextResponse.json({ error: 'Falta la sugerencia a votar' }, { status: 400 });

      const suggestion = await db.prepare(`
        SELECT id
        FROM sugerencias
        WHERE id = ? AND ronda_id = ? AND estado = 'activa'
      `).get(suggestionId, current.id);
      if (!suggestion) return NextResponse.json({ error: 'La sugerencia no esta disponible' }, { status: 404 });

      const existingVote = await db.prepare(`
        SELECT id
        FROM sugerencia_votos_items
        WHERE ronda_id = ? AND sugerencia_id = ? AND usuario_id = ?
      `).get(current.id, suggestionId, viewer.id);

      if (existingVote) {
        return NextResponse.json({ success: true, already_voted: true });
      }

      const currentVoteCount = await db.prepare(`
        SELECT COUNT(*) AS total
        FROM sugerencia_votos_items
        WHERE ronda_id = ? AND usuario_id = ?
      `).get(current.id, viewer.id);

      if (Number(currentVoteCount?.total || 0) >= MAX_VOTES_PER_ROUND) {
        return NextResponse.json({ error: `Solo puedes votar hasta ${MAX_VOTES_PER_ROUND} sugerencias por periodo.` }, { status: 400 });
      }

      await db.prepare(`
        INSERT INTO sugerencia_votos_items (ronda_id, sugerencia_id, usuario_id)
        VALUES (?, ?, ?)
      `).run(current.id, suggestionId, viewer.id);

      return NextResponse.json({ success: true });
    }

    if (type === 'unvote') {
      const current = await getCurrentRound(db, viewer);
      if (!current) return NextResponse.json({ error: 'No hay votacion actual' }, { status: 400 });
      if (current.estado !== 'activa') return NextResponse.json({ error: 'La votacion no esta activa en este momento' }, { status: 400 });

      const suggestionId = Number(body?.sugerencia_id || 0);
      if (!suggestionId) return NextResponse.json({ error: 'Falta la sugerencia del voto a retirar' }, { status: 400 });

      await db.prepare(`
        DELETE FROM sugerencia_votos_items
        WHERE ronda_id = ? AND usuario_id = ? AND sugerencia_id = ?
      `).run(current.id, viewer.id, suggestionId);

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Operacion no soportada' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const db = getDb();
    await ensureSuggestionSchema(db);
    const viewer = await getViewer(db);
    if (!viewer) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!viewer.isAdmin && !viewer.isLeader) {
      return NextResponse.json({ error: 'Solo administradores o lideres pueden configurar la votacion' }, { status: 403 });
    }

    const body = await request.json();
    const action = String(body?.action || 'save_schedule').trim();

    if (action === 'save_schedule') {
      const startAt = String(body?.start_at || '').trim();
      const endAt = String(body?.end_at || '').trim();
      if (!isDateTimeLocal(startAt) || !isDateTimeLocal(endAt)) {
        return NextResponse.json({ error: 'Usa fecha y hora validas.' }, { status: 400 });
      }
      if (startAt >= endAt) {
        return NextResponse.json({ error: 'La fecha inicial debe ser menor a la final.' }, { status: 400 });
      }

      const current = await getCurrentRound(db, viewer);
      const title = `Votacion ${startAt.slice(0, 10)} al ${endAt.slice(0, 10)}`;

      if (current) {
        await db.prepare(`
          UPDATE sugerencia_rondas
          SET titulo = ?, descripcion = ?, start_at = ?, end_at = ?, estado = CASE WHEN estado = 'cerrada' THEN 'borrador' ELSE estado END
          WHERE id = ?
        `).run(title, 'Periodo oficial de sugerencias', toSqlDateTime(startAt), toSqlDateTime(endAt), current.id);
        return NextResponse.json({ success: true, id: Number(current.id) });
      }

      const result = await db.prepare(`
        INSERT INTO sugerencia_rondas (titulo, descripcion, estado, grupo_id, creado_por, start_at, end_at)
        VALUES (?, 'Periodo oficial de sugerencias', 'borrador', ?, ?, ?, ?)
      `).run(title, viewer.isAdmin ? (viewer.grupo_id || null) : viewer.grupo_id, viewer.id, toSqlDateTime(startAt), toSqlDateTime(endAt));

      return NextResponse.json({ success: true, id: Number(result?.lastInsertRowid || 0) });
    }

    if (action === 'export_to_project') {
      const suggestionId = Number(body?.sugerencia_id || 0);
      if (!suggestionId) {
        return NextResponse.json({ error: 'Falta la sugerencia a exportar' }, { status: 400 });
      }

      const suggestion = await db.prepare(`
        SELECT s.*, r.grupo_id
        FROM sugerencias s
        JOIN sugerencia_rondas r ON r.id = s.ronda_id
        WHERE s.id = ?
      `).get(suggestionId);

      if (!suggestion) {
        return NextResponse.json({ error: 'La sugerencia no existe' }, { status: 404 });
      }

      if (suggestion.proyecto_exportado_id) {
        return NextResponse.json({ success: true, project_id: Number(suggestion.proyecto_exportado_id), reused: true });
      }

      const duplicate = await db.prepare(`
        SELECT id, titulo
        FROM proyectos
        WHERE LOWER(TRIM(titulo)) = LOWER(TRIM(?))
        LIMIT 1
      `).get(suggestion.titulo);
      if (duplicate) {
        await db.prepare(`UPDATE sugerencias SET proyecto_exportado_id = ? WHERE id = ?`).run(duplicate.id, suggestionId);
        return NextResponse.json({ success: true, project_id: Number(duplicate.id), reused: true });
      }

      const projectType = ['Manga', 'Manhwa', 'Manhua'].includes(String(suggestion.tipo_obra || ''))
        ? String(suggestion.tipo_obra)
        : 'Manga';

      const result = await db.prepare(`
        INSERT INTO proyectos (
          titulo, tipo, genero, capitulos_totales, capitulos_actuales, estado, ultima_actualizacion, frecuencia, grupo_id, imagen_url
        )
        VALUES (?, ?, '', NULL, 0, 'Activo', CURRENT_TIMESTAMP, 'Mensual', ?, ?)
      `).run(
        suggestion.titulo,
        projectType,
        suggestion.grupo_id || viewer.grupo_id || 1,
        suggestion.imagen_url || null
      );

      const projectId = Number(result?.lastInsertRowid || 0);
      await db.prepare(`UPDATE sugerencias SET proyecto_exportado_id = ? WHERE id = ?`).run(projectId, suggestionId);

      return NextResponse.json({ success: true, project_id: projectId, reused: false });
    }

    return NextResponse.json({ error: 'Accion no soportada' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
  }
}
