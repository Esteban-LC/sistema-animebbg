'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatActivityDate } from '@/utils/date';
import { useSocket } from '@/context/SocketContext';

interface Notificacion {
    id: number;
    tipo: string;
    titulo: string;
    mensaje: string;
    leida: number;
    creado_en: string;
    asignacion_id?: number | null;
    target_url?: string;
}

const NOTIFICATIONS_PAGE_POLL_MS = process.env.NODE_ENV === 'production' ? 30000 : 8000;

export default function NotificacionesPage() {
    const { socket } = useSocket();
    const router = useRouter();
    const [items, setItems] = useState<Notificacion[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<number | null>(null);
    const [hasRealtimeActivity, setHasRealtimeActivity] = useState(false);

    const fetchNotifications = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await fetch('/api/notificaciones?limit=100', { cache: 'no-store' });
            const data = await res.json();
            setItems(Array.isArray(data?.items) ? data.items : []);
            setUnread(Number(data?.unread || 0));
        } catch {
            if (!silent) {
                setItems([]);
                setUnread(0);
            }
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        const runRefresh = () => {
            if (document.visibilityState !== 'visible') return;
            if (hasRealtimeActivity) return;
            fetchNotifications(true);
        };

        fetchNotifications();
        const id = window.setInterval(runRefresh, NOTIFICATIONS_PAGE_POLL_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !hasRealtimeActivity) {
                fetchNotifications(true);
            }
        };

        const onRealtimeUpdate = (event: Event) => {
            const detail = (event as CustomEvent<{ type?: string }>).detail;
            if (detail?.type !== 'notification') return;
            setHasRealtimeActivity(true);
            fetchNotifications(true);
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('realtime:update', onRealtimeUpdate as EventListener);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('realtime:update', onRealtimeUpdate as EventListener);
        };
    }, [hasRealtimeActivity]);

    // WebSocket: refresca cuando hay cambio de contenido en el sistema
    useEffect(() => {
        if (!socket) return;
        const handleSocketChange = () => fetchNotifications(true);
        socket.on('content-changed', handleSocketChange);
        return () => { socket.off('content-changed', handleSocketChange); };
    }, [socket]);

    // Notificación push recibida (web push o Capacitor): actualiza lista al instante
    useEffect(() => {
        const handlePushReceived = () => fetchNotifications(true);
        window.addEventListener('notifications:changed', handlePushReceived);
        return () => { window.removeEventListener('notifications:changed', handlePushReceived); };
    }, []);

    const markOneRead = async (id: number) => {
        setProcessingId(id);
        try {
            await fetch(`/api/notificaciones/${id}`, { method: 'PATCH' });
            setItems((prev) => prev.map((item) => item.id === id ? { ...item, leida: 1 } : item));
            setUnread((prev) => Math.max(0, prev - 1));
            window.dispatchEvent(new Event('notifications:changed'));
        } finally {
            setProcessingId(null);
        }
    };

    const markAllRead = async () => {
        setProcessingId(-1);
        try {
            await fetch('/api/notificaciones/read-all', { method: 'PATCH' });
            setItems((prev) => prev.map((item) => ({ ...item, leida: 1 })));
            setUnread(0);
            window.dispatchEvent(new Event('notifications:changed'));
        } finally {
            setProcessingId(null);
        }
    };

    const deleteOne = async (id: number) => {
        setProcessingId(id);
        try {
            const item = items.find((x) => x.id === id);
            await fetch(`/api/notificaciones/${id}`, { method: 'DELETE' });
            setItems((prev) => prev.filter((x) => x.id !== id));
            if (item && Number(item.leida) === 0) {
                setUnread((prev) => Math.max(0, prev - 1));
            }
            window.dispatchEvent(new Event('notifications:changed'));
        } finally {
            setProcessingId(null);
        }
    };

    const openNotification = async (item: Notificacion) => {
        if (processingId !== null) return;
        if (!item.target_url) return;

        if (!item.leida) {
            setProcessingId(item.id);
            try {
                await fetch(`/api/notificaciones/${item.id}`, { method: 'PATCH' });
                setItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, leida: 1 } : entry));
                setUnread((prev) => Math.max(0, prev - 1));
                window.dispatchEvent(new Event('notifications:changed'));
            } finally {
                setProcessingId(null);
            }
        }

        router.push(item.target_url);
    };

    const grouped = useMemo(() => items, [items]);

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                    <span className="text-primary">Notificaciones</span>
                </h1>
                <button
                    onClick={markAllRead}
                    disabled={processingId !== null || unread === 0}
                    className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-primary disabled:opacity-50"
                >
                    Marcar Todo Leido
                </button>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-4xl mx-auto space-y-4">
                    <div className="bg-surface-dark border border-gray-800 rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <p className="text-xs uppercase tracking-wider text-muted-dark">Resumen</p>
                                <p className="text-white font-bold text-xl">{unread} sin leer</p>
                            </div>
                            <div className="hidden md:flex items-center gap-3">
                                <span className="material-icons-round text-primary text-3xl">notifications</span>
                            </div>
                            <span className="material-icons-round text-primary text-3xl md:hidden">notifications</span>
                        </div>
                        <button
                            onClick={markAllRead}
                            disabled={processingId !== null || unread === 0}
                            className="mt-3 w-full md:hidden px-4 py-2.5 text-sm rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-primary disabled:opacity-50"
                        >
                            Marcar todo como leido
                        </button>
                    </div>

                    {loading ? (
                        [...Array(5)].map((_, i) => (
                            <div key={i} className="h-24 rounded-xl border border-gray-800 bg-surface-dark animate-pulse"></div>
                        ))
                    ) : grouped.length === 0 ? (
                        <div className="bg-surface-dark rounded-xl border border-gray-800 border-dashed p-12 text-center">
                            <h3 className="text-xl font-bold text-white mb-2">Sin notificaciones</h3>
                            <p className="text-muted-dark">No hay actividad reciente.</p>
                        </div>
                    ) : (
                        grouped.map((item) => (
                            <div key={item.id} className={`rounded-xl border p-4 ${item.leida ? 'bg-surface-dark border-gray-800' : 'bg-surface-darker border-primary/40'}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1 text-left">
                                        <div className="flex items-center gap-2">
                                            {item.target_url && item.tipo === 'entrega_revision' ? (
                                                <button
                                                    type="button"
                                                    onClick={() => openNotification(item)}
                                                    disabled={processingId !== null}
                                                    className="text-white font-bold truncate hover:text-primary transition-colors disabled:opacity-60"
                                                >
                                                    {item.titulo}
                                                </button>
                                            ) : (
                                                <p className="text-white font-bold truncate">{item.titulo}</p>
                                            )}
                                            {!item.leida && <span className="w-2 h-2 rounded-full bg-primary"></span>}
                                        </div>
                                        <p className="text-sm text-gray-300 mt-1">{item.mensaje}</p>
                                        <p className="text-xs text-muted-dark mt-2">
                                            {formatActivityDate(item.creado_en)}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {!item.leida && (
                                            <button
                                                onClick={() => markOneRead(item.id)}
                                                disabled={processingId !== null}
                                                className="px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-primary disabled:opacity-50"
                                            >
                                                Leida
                                            </button>
                                        )}
                                        <button
                                            onClick={() => deleteOne(item.id)}
                                            disabled={processingId !== null}
                                            className="px-3 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-300 hover:text-red-200 hover:border-red-400 disabled:opacity-50"
                                        >
                                            Eliminar
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
