import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PATCH(request, { params }) {
    try {
        const { id } = await params;
        const { activo } = await request.json();
        const db = getDb();

        const result = await db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(activo, id);

        if (result.changes === 0) {
            return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
        }

        return NextResponse.json({ message: 'Estado actualizado' });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
