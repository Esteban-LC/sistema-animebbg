const { getDb } = require('./src/lib/db');
const db = getDb();

const completed = db.prepare("SELECT id, usuario_id, estado, completado_en FROM asignaciones WHERE estado = 'Completado'").all();
console.log('Completed Assignments:', completed);

const users = db.prepare("SELECT id, nombre FROM usuarios").all();
console.table(users);
