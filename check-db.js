const sqlite3 = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'animebbg.db');
console.log('Checking database at:', DB_PATH);

try {
    const db = sqlite3(DB_PATH);

    console.log('\n=== TABLAS EN LA BASE DE DATOS ===');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log(tables);

    console.log('\n=== PROYECTOS ===');
    const count = db.prepare('SELECT COUNT(*) as count FROM proyectos').get();
    console.log(`Total proyectos: ${count.count}`);

    if (count.count > 0) {
        const proyectos = db.prepare('SELECT * FROM proyectos').all();
        console.log('Proyectos encontrados:');
        proyectos.forEach(p => {
            console.log(`  - ID: ${p.id}, Título: ${p.titulo}, Tipo: ${p.tipo}`);
        });
    } else {
        console.log('No hay proyectos en la base de datos.');
    }

    db.close();
} catch (error) {
    console.error('Error:', error.message);
}
