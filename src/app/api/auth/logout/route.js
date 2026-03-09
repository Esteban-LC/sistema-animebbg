import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST() {
    try {
        const cookieStore = await cookies();
        const token = cookieStore.get('auth_token')?.value;

        if (token) {
            const db = getDb();
            // Invalidate session in DB
            await db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
        }

        // Remove cookie
        cookieStore.delete('auth_token');

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
