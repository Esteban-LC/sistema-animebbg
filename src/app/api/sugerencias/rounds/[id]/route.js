import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ensureSuggestionSchema, getDb } from '@/lib/db';

function parseRoles(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getViewer(db) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;

  const user = await db.prepare(`
    SELECT u.*
    FROM sessions s
    JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token);
  if (!user) return null;

  const roles = parseRoles(user.roles);
  return {
    id: Number(user.id),
    grupo_id: user.grupo_id ? Number(user.grupo_id) : null,
    isAdmin: roles.includes('Administrador'),
    isLeader: roles.includes('Lider de Grupo'),
  };
}

export async function PATCH(request, { params }) {
  try {
    const db = getDb();
    await ensureSuggestionSchema(db);
    const viewer = await getViewer(db);
    if (!viewer) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!viewer.isAdmin && !viewer.isLeader) {
      return NextResponse.json({ error: 'Solo administradores o lideres pueden cambiar el estado' }, { status: 403 });
    }

    const roundId = Number((await params).id);
    const body = await request.json();
    const action = String(body?.action || '').trim();

    const round = await db.prepare(`SELECT * FROM sugerencia_rondas WHERE id = ?`).get(roundId);
    if (!round) return NextResponse.json({ error: 'La ronda no existe' }, { status: 404 });

    if (!viewer.isAdmin && round.grupo_id && Number(round.grupo_id) !== Number(viewer.grupo_id)) {
      return NextResponse.json({ error: 'No puedes modificar esta ronda' }, { status: 403 });
    }

    if (action === 'start') {
      await db.prepare(`
        UPDATE sugerencia_rondas
        SET estado = 'activa', iniciado_en = COALESCE(iniciado_en, CURRENT_TIMESTAMP), pausado_en = NULL
        WHERE id = ?
      `).run(roundId);
      return NextResponse.json({ success: true });
    }

    if (action === 'pause') {
      await db.prepare(`
        UPDATE sugerencia_rondas
        SET estado = 'pausada', pausado_en = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(roundId);
      return NextResponse.json({ success: true });
    }

    if (action === 'resume') {
      await db.prepare(`
        UPDATE sugerencia_rondas
        SET estado = 'activa', pausado_en = NULL
        WHERE id = ?
      `).run(roundId);
      return NextResponse.json({ success: true });
    }

    if (action === 'close') {
      await db.prepare(`
        UPDATE sugerencia_rondas
        SET estado = 'cerrada', cerrado_en = CURRENT_TIMESTAMP, pausado_en = NULL
        WHERE id = ?
      `).run(roundId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Accion no soportada' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const db = getDb();
    await ensureSuggestionSchema(db);
    const viewer = await getViewer(db);
    if (!viewer) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    if (!viewer.isAdmin && !viewer.isLeader) {
      return NextResponse.json({ error: 'Solo administradores o lideres pueden eliminar periodos' }, { status: 403 });
    }

    const roundId = Number((await params).id);
    const round = await db.prepare(`SELECT * FROM sugerencia_rondas WHERE id = ?`).get(roundId);
    if (!round) return NextResponse.json({ error: 'La ronda no existe' }, { status: 404 });

    if (!viewer.isAdmin && round.grupo_id && Number(round.grupo_id) !== Number(viewer.grupo_id)) {
      return NextResponse.json({ error: 'No puedes eliminar esta ronda' }, { status: 403 });
    }

    await db.prepare(`DELETE FROM sugerencia_votos_items WHERE ronda_id = ?`).run(roundId);
    await db.prepare(`DELETE FROM sugerencia_votos WHERE ronda_id = ?`).run(roundId);
    await db.prepare(`DELETE FROM sugerencias WHERE ronda_id = ?`).run(roundId);
    await db.prepare(`DELETE FROM sugerencia_rondas WHERE id = ?`).run(roundId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 });
  }
}
