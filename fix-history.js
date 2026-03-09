const { getDb } = require('./src/lib/db');

const db = getDb();
console.log('Fixing completado_en for completed assignments...');
const result = db.prepare(`
    UPDATE asignaciones 
    SET completado_en = COALESCE(asignado_en, DATETIME('now')) 
    WHERE estado = 'Completado' AND completado_en IS NULL
`).run();

console.log(`Updated ${result.changes} rows.`);
