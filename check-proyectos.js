const { getDb } = require('./src/lib/db');
const db = getDb();
console.log('--- Proyectos ---');
const projects = db.prepare("SELECT * FROM proyectos").all();
console.table(projects);
