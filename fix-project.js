const { getDb } = require('./src/lib/db');
const db = getDb();

console.log('Creating default project...');
const info = db.prepare(`
    INSERT INTO proyectos (titulo, tipo, estado, grupo_id) 
    VALUES ('Yerno Supremo', 'Manhwa', 'Activo', 1)
`).run();

const projectId = info.lastInsertRowid;
console.log(`Created project with ID: ${projectId}`);

console.log('Updating assignment 1 to link to new project...');
db.prepare(`
    UPDATE asignaciones 
    SET proyecto_id = ? 
    WHERE id = 1
`).run(projectId);

const item = db.prepare("SELECT * FROM asignaciones WHERE id = 1").get();
console.log(JSON.stringify(item, null, 2));

const history = db.prepare(`
            SELECT 
                a.id, 
                a.completado_en as fecha,
                p.titulo as proyecto, 
                a.capitulo, 
                a.rol, 
                u.nombre as usuario
            FROM asignaciones a
            JOIN proyectos p ON a.proyecto_id = p.id
            JOIN usuarios u ON a.usuario_id = u.id
            WHERE a.estado = 'Completado'
`).all();
console.log('History query result:', history);
