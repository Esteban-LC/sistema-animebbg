import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const db = getDb();
        const grupos = await db.prepare('SELECT * FROM grupos ORDER BY nombre').all();
        return NextResponse.json(grupos);
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(request) {
    try {
        const { nombre } = await request.json();
        const db = getDb();

        if (!nombre) {
            return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 });
        }

        const result = await db.prepare('INSERT INTO grupos (nombre) VALUES (?)').run(nombre);

        return NextResponse.json({ id: result.lastInsertRowid, nombre });
    } catch (error) {
        // Check for unique constraint violation
        if (error.message.includes('UNIQUE constraint failed')) {
            return NextResponse.json({ error: 'El grupo ya existe' }, { status: 400 });
        }
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
