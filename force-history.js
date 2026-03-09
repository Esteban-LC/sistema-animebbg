const { getDb } = require('./src/lib/db');
const db = getDb();

console.log('Updating assignment 1 to user 1...');
db.prepare(`
    UPDATE asignaciones 
    SET usuario_id = 1, estado = 'Completado', completado_en = DATETIME('now')
    WHERE id = 1
`).run();

const item = db.prepare("SELECT * FROM asignaciones WHERE id = 1").get();
console.log(JSON.stringify(item, null, 2));
