const { getDb } = require('./src/lib/db');
console.log('---------------- SCHEMA START ----------------');
const db = getDb();
try {
    const usuariosInfo = db.prepare('PRAGMA table_info(usuarios)').all();
    console.log('USERS COLUMNS:', JSON.stringify(usuariosInfo.map(c => c.name), null, 2));

    const asignacionesInfo = db.prepare('PRAGMA table_info(asignaciones)').all();
    console.log('ASSIGNMENTS COLUMNS:', JSON.stringify(asignacionesInfo.map(c => c.name), null, 2));
} catch (e) {
    console.error('ERROR CHECKING SCHEMA:', e);
}
console.log('---------------- SCHEMA END ----------------');
