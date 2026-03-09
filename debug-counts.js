const { getDb } = require('./src/lib/db');
const db = getDb();
const counts = db.prepare("SELECT estado, COUNT(*) as count FROM asignaciones GROUP BY estado").all();
console.table(counts);

const completed = db.prepare("SELECT id, estado, completado_en, asignado_en FROM asignaciones WHERE estado = 'Completado'").all();
console.log('Completed tasks details:', completed);
