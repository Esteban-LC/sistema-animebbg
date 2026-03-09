const { getDb } = require('./src/lib/db');
const db = getDb();
const item = db.prepare("SELECT * FROM asignaciones WHERE id = 1").get();
console.log(item);
