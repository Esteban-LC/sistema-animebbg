const { getDb } = require('./src/lib/db');
const db = getDb();

try {
    console.log('Adding avatar_url to usuarios table...');
    db.prepare('ALTER TABLE usuarios ADD COLUMN avatar_url TEXT').run();
    console.log('Column added successfully.');
} catch (error) {
    if (error.message.includes('duplicate column')) {
        console.log('Column already exists.');
    } else {
        console.error('Error adding column:', error);
    }
}
