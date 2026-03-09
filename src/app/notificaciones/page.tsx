'use client';

import { useEffect, useMemo, useState } from 'react';

interface Notificacion {
    id: number;
    tipo: string;
    titulo: string;
    mensaje: string;
    leida: number;
    creado_en: string;
}

const NOTIFICATIONS_PAGE_POLL_MS = process.env.NODE_ENV === 'production' ? 30000 : 8000;

export default function NotificacionesPage() {
    const [items, setItems] = useState<Notificacion[]>([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);
    const [processingId, setProcessingId] = useState<number | null>(null);

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
            fetchNotifications(true);
        };

        fetchNotifications();
        const id = window.setInterval(runRefresh, NOTIFICATIONS_PAGE_POLL_MS);
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchNotifications(true);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
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
                    <div className="bg-surface-dark border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                        <div>
                            <p className="text-xs uppercase tracking-wider text-muted-dark">Resumen</p>
                            <p className="text-white font-bold text-xl">{unread} sin leer</p>
                        </div>
                        <span className="material-icons-round text-primary text-3xl">notifications</span>
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
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <p className="text-white font-bold truncate">{item.titulo}</p>
                                            {!item.leida && <span className="w-2 h-2 rounded-full bg-primary"></span>}
                                        </div>
                                        <p className="text-sm text-gray-300 mt-1">{item.mensaje}</p>
                                        <p className="text-xs text-muted-dark mt-2">
                                            {new Date(item.creado_en).toLocaleString('es-ES')}
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
