const { getDb } = require('./src/lib/db');

const db = getDb();

console.log('--- Assignments with status "Completado" ---');
const completed = db.prepare("SELECT id, usuario_id, rol, descripcion, estado, completado_en, asignado_en FROM asignaciones WHERE estado = 'Completado'").all();
console.table(completed);

console.log('--- All Assignments ---');
const all = db.prepare("SELECT id, usuario_id, rol, descripcion, estado, completado_en, asignado_en FROM asignaciones LIMIT 10").all();
console.table(all);
