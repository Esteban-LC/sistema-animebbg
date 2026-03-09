import fs from 'fs';
import path from 'path';
import { getDb } from '../src/lib/db.js';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      const hasValue = row.some((v) => String(v).trim() !== '');
      if (hasValue) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    const hasValue = row.some((v) => String(v).trim() !== '');
    if (hasValue) rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function slugProjectTitle(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactProjectTitle(value) {
  return slugProjectTitle(value).replace(/\s+/g, '');
}

function tokenSet(value) {
  const stop = new Set(['the', 'a', 'an', 'of', 'de', 'la', 'el', 'and', 'y', 'ni', 'no']);
  return slugProjectTitle(value)
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t && !stop.has(t));
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter += 1;
  }
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

function findBestExistingProject(projects, incomingTitle) {
  const incomingCompact = compactProjectTitle(incomingTitle);
  const incomingTokens = tokenSet(incomingTitle);
  if (!incomingCompact) return null;

  let best = null;
  for (const p of projects) {
    const dbCompact = compactProjectTitle(p.titulo);
    const dbTokens = tokenSet(p.titulo);
    if (!dbCompact) continue;

    const contains = incomingCompact.includes(dbCompact) || dbCompact.includes(incomingCompact);
    const lenRatio = Math.min(incomingCompact.length, dbCompact.length) / Math.max(incomingCompact.length, dbCompact.length);
    const jac = jaccard(incomingTokens, dbTokens);
    const score = (contains ? 0.5 : 0) + (jac * 0.5);

    // Accept strong matches: containment with decent ratio, or very high token similarity
    const isMatch = (contains && lenRatio >= 0.55) || jac >= 0.88;
    if (!isMatch) continue;

    if (!best || score > best.score) {
      best = { project: p, score };
    }
  }

  return best?.project || null;
}

function normalizeRole(raw) {
  const v = normalizeText(raw);
  if (v === 'traductor' || v === 'traduccion' || v === 'traducción') return 'Traductor';
  if (v === 'redraw' || v === 'redrawer') return 'Redrawer';
  if (v === 'type' || v === 'typer' || v === 'typeo' || v === 'typpe') return 'Typer';
  return null;
}

function extractChapters(raw) {
  const str = String(raw || '').replace(/,/g, ' ');
  const matches = str.match(/\d+(?:\.\d+)?/g) || [];
  const unique = [];
  const seen = new Set();
  for (const m of matches) {
    const n = Number(m);
    if (Number.isNaN(n)) continue;
    if (!seen.has(n)) {
      seen.add(n);
      unique.push(n);
    }
  }
  return unique;
}

function normalizeDate(raw) {
  const str = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(str)) return `${str}:00`;
  return str;
}

async function main() {
  const csvPathArg = process.argv[2];
  if (!csvPathArg) {
    throw new Error('Uso: node scripts/import-avisos-csv.mjs <ruta_csv>');
  }

  const csvPath = path.resolve(csvPathArg);
  if (!fs.existsSync(csvPath)) {
    throw new Error(`No existe el archivo: ${csvPath}`);
  }

  const csvText = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error('CSV vacio o sin filas de datos');
  }

  const db = getDb();

  const existingUsers = await db.prepare(`
    SELECT id, nombre, discord_username
    FROM usuarios
  `).all();

  const userByKey = new Map();
  for (const u of existingUsers) {
    userByKey.set(normalizeText(u.nombre), u);
    if (u.discord_username) userByKey.set(normalizeText(u.discord_username), u);
  }

  const existingProjects = await db.prepare(`
    SELECT id, titulo
    FROM proyectos
  `).all();

  const projectByTitle = new Map();
  for (const p of existingProjects) {
    projectByTitle.set(normalizeText(p.titulo), p);
  }

  const stats = {
    totalRows: rows.length,
    skippedRows: 0,
    createdUsers: 0,
    createdProjects: 0,
    createdAssignments: 0,
    skippedAssignmentsDuplicate: 0,
    rowsWithUnknownRole: 0,
    rowsWithNoChapter: 0,
  };

  const touchedProjectIds = new Set();

  for (const row of rows) {
    const usuarioRaw = row.usuario;
    const proyectoRaw = row.proyecto;
    const role = normalizeRole(row.rol);
    const chapters = extractChapters(row.capitulo);
    const fecha = normalizeDate(row.fecha);

    if (!usuarioRaw || !proyectoRaw) {
      stats.skippedRows += 1;
      continue;
    }

    if (!role) {
      stats.rowsWithUnknownRole += 1;
      stats.skippedRows += 1;
      continue;
    }

    if (chapters.length === 0) {
      stats.rowsWithNoChapter += 1;
      stats.skippedRows += 1;
      continue;
    }

    const userKey = normalizeText(usuarioRaw);
    let user = userByKey.get(userKey);

    if (!user) {
      const result = await db.prepare(`
        INSERT INTO usuarios (nombre, discord_username, password, roles, activo, grupo_id)
        VALUES (?, ?, ?, ?, 1, 1)
      `).run(usuarioRaw, usuarioRaw, '123456', '["Staff"]');

      user = { id: Number(result.lastInsertRowid), nombre: usuarioRaw, discord_username: usuarioRaw };
      userByKey.set(userKey, user);
      stats.createdUsers += 1;
    }

    const projectKey = normalizeText(proyectoRaw);
    let project = projectByTitle.get(projectKey) || findBestExistingProject(existingProjects, proyectoRaw);

    if (!project) {
      const result = await db.prepare(`
        INSERT INTO proyectos (
          titulo, tipo, genero, capitulos_totales, capitulos_actuales, estado,
          ultima_actualizacion, frecuencia, grupo_id, imagen_url
        )
        VALUES (?, 'Manga', '', NULL, 0, 'Activo', CURRENT_TIMESTAMP, 'Semanal', 1, NULL)
      `).run(proyectoRaw);

      project = { id: Number(result.lastInsertRowid), titulo: proyectoRaw };
      projectByTitle.set(projectKey, project);
      existingProjects.push(project);
      stats.createdProjects += 1;
    }

    for (const chapter of chapters) {
      const duplicate = await db.prepare(`
        SELECT id
        FROM asignaciones
        WHERE usuario_id = ?
          AND rol = ?
          AND proyecto_id = ?
          AND capitulo = ?
          AND estado = 'Completado'
        LIMIT 1
      `).get(user.id, role, project.id, chapter);

      if (duplicate) {
        stats.skippedAssignmentsDuplicate += 1;
        continue;
      }

      await db.prepare(`
        INSERT INTO asignaciones (
          usuario_id, rol, descripcion, estado,
          asignado_en, completado_en, informe, drive_url,
          proyecto_id, capitulo
        )
        VALUES (?, ?, ?, 'Completado', ?, ?, NULL, NULL, ?, ?)
      `).run(
        user.id,
        role,
        `${project.titulo} - Capitulo ${chapter}`,
        fecha || null,
        fecha || null,
        project.id,
        chapter
      );

      stats.createdAssignments += 1;
      touchedProjectIds.add(project.id);
    }
  }

  for (const projectId of touchedProjectIds) {
    const progress = await db.prepare(`
      SELECT COALESCE(MAX(capitulo), 0) AS max_cap
      FROM asignaciones
      WHERE proyecto_id = ? AND estado = 'Completado'
    `).get(projectId);

    await db.prepare(`
      UPDATE proyectos
      SET capitulos_actuales = ?, ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(progress?.max_cap || 0, projectId);
  }

  console.log('Import finalizado');
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error('Error importando CSV:', err?.message || err);
  process.exit(1);
});
