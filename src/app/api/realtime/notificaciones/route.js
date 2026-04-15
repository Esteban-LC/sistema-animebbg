import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getDb } from '@/lib/db';
import { subscribeAssignmentEvent, subscribeNotificationEvent, subscribeProjectEvent, subscribeRankingEvent } from '@/lib/realtime';

export const dynamic = 'force-dynamic';
const REALTIME_SSE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SSE === '1';

async function getSessionUserContext(db) {
    const token = (await cookies()).get('auth_token')?.value;
    if (!token) return null;

    const session = await db.prepare(`
        SELECT u.id as usuario_id, u.roles, u.grupo_id
        FROM sessions s
        JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = ? AND s.expires_at > datetime('now')
    `).get(token);

    if (!session) return null;

    let roles = [];
    try {
        roles = JSON.parse(session.roles || '[]');
    } catch {
        roles = [];
    }

    return {
        userId: Number(session.usuario_id),
        groupId: session.grupo_id ? Number(session.grupo_id) : null,
        isAdmin: roles.includes('Administrador'),
    };
}

export async function GET() {
    if (!REALTIME_SSE_ENABLED) {
        return new Response(null, { status: 204 });
    }

    const db = getDb();
    const context = await getSessionUserContext(db);
    if (!context?.userId) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    let cleanup = null;
    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder();

            const send = (event, payload) => {
                controller.enqueue(encoder.encode(`event: ${event}\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };

            send('connected', { ok: true, ts: Date.now() });

            const unsubscribe = subscribeNotificationEvent((payload) => {
                if (Number(payload?.usuario_id) !== Number(context.userId)) return;
                send('notification', payload);
            });
            const unsubscribeProject = subscribeProjectEvent((payload) => {
                const payloadGroupId = payload?.group_id ? Number(payload.group_id) : null;
                if (!context.isAdmin && payloadGroupId && Number(context.groupId) !== payloadGroupId) return;
                send('project', payload);
            });
            const unsubscribeAssignment = subscribeAssignmentEvent((payload) => {
                const payloadGroupId = payload?.group_id ? Number(payload.group_id) : null;
                const assignedUserId = payload?.usuario_id ? Number(payload.usuario_id) : null;

                if (context.isAdmin) {
                    send('assignment', payload);
                    return;
                }

                if (assignedUserId && assignedUserId === Number(context.userId)) {
                    send('assignment', payload);
                    return;
                }

                if (payloadGroupId && context.groupId && payloadGroupId === Number(context.groupId)) {
                    send('assignment', payload);
                }
            });
            const unsubscribeRanking = subscribeRankingEvent((payload) => {
                send('ranking', payload);
            });

            const heartbeat = setInterval(() => {
                send('ping', { ts: Date.now() });
            }, 25000);

            cleanup = () => {
                clearInterval(heartbeat);
                unsubscribe();
                unsubscribeProject();
                unsubscribeAssignment();
                unsubscribeRanking();
            };
        },
        cancel() {
            if (cleanup) cleanup();
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        },
    });
}
