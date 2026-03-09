const { getDb } = require('./src/lib/db');
const db = getDb();

console.log('--- All Assignments for User 1 ---');
const user1 = db.prepare(`
    SELECT a.id, p.titulo, a.capitulo, a.rol, a.estado, a.usuario_id 
    FROM asignaciones a
    LEFT JOIN proyectos p ON a.proyecto_id = p.id
    WHERE a.usuario_id = 1
`).all();
console.table(user1);

console.log('--- All Assignments ---');
const all = db.prepare(`
    SELECT a.id, p.titulo, a.capitulo, a.rol, a.estado, a.usuario_id 
    FROM asignaciones a
    LEFT JOIN proyectos p ON a.proyecto_id = p.id
`).all();
console.table(all);
