const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'data', 'animebbg.db');
const db = new Database(DB_PATH); // No verbose logging

try {
    const usuariosInfo = db.prepare('PRAGMA table_info(usuarios)').all();
    console.log('USERS TABLE COLUMNS:');
    usuariosInfo.forEach(c => console.log(`- ${c.name} (${c.type})`));

    const asignacionesInfo = db.prepare('PRAGMA table_info(asignaciones)').all();
    console.log('\nASSIGNMENTS TABLE COLUMNS:');
    asignacionesInfo.forEach(c => console.log(`- ${c.name} (${c.type})`));
} catch (e) {
    console.error('ERROR:', e);
}
db.close();
