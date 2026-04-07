import { NextResponse } from 'next/server';
import { isOAuthConnected } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';

export async function GET() {
    const connected = await isOAuthConnected();
    return NextResponse.json({ connected });
}
