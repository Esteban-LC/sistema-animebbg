import { NextResponse } from 'next/server';
import { getPublicVapidKey, isPushConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({
        configured: isPushConfigured(),
        publicKey: getPublicVapidKey() || null,
    });
}
