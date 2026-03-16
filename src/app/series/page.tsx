'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';

interface Serie {
    id: number;
    titulo: string;
    tipo: string;
    genero: string;
    capitulos_actuales: number;
    capitulos_totales: number | null;
    estado: string;
    imagen_url: string;
}

interface ProgresoData {
    proyecto: { id: number; titulo: string; capitulos_totales: number | null };
    summary: {
        total_capitulos: number;
        traductor_completados: number;
        typer_completados: number;
        redrawer_completados: number;
        completos_todos_los_roles?: number;
    };
    missing: { traductor: string[]; typer: string[]; redrawer: string[] };
    chapters: Array<{
        numero: number;
        label: string;
        traductor: boolean;
        typer: boolean;
        redrawer: boolean;
    }>;
}

export default function SeriesPage() {
    const { user } = useUser();
    const { socket } = useSocket();
    const [items, setItems] = useState<Serie[]>([]);
    const [loading, setLoading] = useState(true);
    const [progressProject, setProgressProject] = useState<Serie | null>(null);
    const [progressData, setProgressData] = useState<ProgresoData | null>(null);
    const [progressLoading, setProgressLoading] = useState(false);

    const fetchSeries = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/series');
            const data = await res.json();
            const list = Array.isArray(data) ? data : [];
            const visibles = list.filter((item) => String(item?.estado || '').trim().toLowerCase() !== 'cancelado');
            setItems(visibles);
        } catch (e) {
            setItems([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSeries();

        if (!socket) return;
        const handleContentChanged = () => {
             fetchSeries();
        };
        socket.on('content-changed', handleContentChanged);

        return () => {
            socket.off('content-changed', handleContentChanged);
        };
    }, [socket]);

    const calculateProgress = (curr: number, total: number | null) => {
        if (!total) return 100;
        return Math.min((curr / total) * 100, 100);
    };

    const openProgress = async (serie: Serie) => {
        setProgressProject(serie);
        setProgressData(null);
        setProgressLoading(true);
        try {
            const res = await fetch(`/api/series/${serie.id}/progreso`);
            const data = await res.json();
            if (res.ok) setProgressData(data);
        } catch (e) {
            setProgressData(null);
        } finally {
            setProgressLoading(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                    <span className="text-primary">Series</span>
                </h1>
                <p className="text-xs uppercase tracking-wider text-muted-dark">Solo Lectura</p>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-[1600px] mx-auto">
                    {loading ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {[...Array(8)].map((_, i) => (
                                <div key={i} className="bg-surface-dark rounded-xl border border-gray-800 h-[360px] animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                            {items.map((p) => (
                                <div key={p.id} className="bg-surface-dark rounded-xl overflow-hidden border border-gray-800 flex flex-col h-full">
                                    <div className="relative aspect-[2/3] overflow-hidden bg-gradient-to-br from-gray-900 to-gray-800">
                                        <img
                                            alt={p.titulo}
                                            className="w-full h-full object-cover"
                                            src={p.imagen_url || 'https://via.placeholder.com/300x450?text=No+Cover'}
                                            loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent"></div>
                                        <div className="absolute bottom-0 left-0 w-full p-4">
                                            <h3 className="text-lg font-display font-bold text-white line-clamp-2">{p.titulo}</h3>
                                        </div>
                                    </div>

                                    <div className="p-4">
                                        <div className="flex justify-between mb-2">
                                            <div>
                                                <span className="text-[10px] uppercase font-bold text-muted-dark block">Realizados</span>
                                                <span className="text-xl font-display font-bold text-white">{p.capitulos_actuales}</span>
                                            </div>
                                            <div className="text-right">
                                                <span className="text-[10px] uppercase font-bold text-muted-dark block">Raw</span>
                                                <span className="text-xl font-display font-bold text-gray-400">{p.capitulos_totales || '?'}</span>
                                            </div>
                                        </div>
                                        <div className="w-full bg-surface-darker rounded-full h-1.5 overflow-hidden mb-4">
                                            <div className="h-full bg-gradient-to-r from-emerald-500 to-blue-400" style={{ width: `${calculateProgress(p.capitulos_actuales, p.capitulos_totales)}%` }} />
                                        </div>
                                        <button
                                            onClick={() => openProgress(p)}
                                            className="w-full py-2.5 bg-surface-darker hover:bg-blue-500/20 text-gray-300 border border-gray-700 hover:border-blue-400 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-colors"
                                        >
                                            <span className="material-icons-round text-lg">insights</span>
                                            Ver Progreso
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    {!loading && items.length === 0 && (
                        <div className="bg-surface-dark border border-gray-800 rounded-xl p-8 text-center text-muted-dark mt-6">
                            No hay series disponibles para tu grupo actualmente.
                        </div>
                    )}
                </div>
            </div>

            {progressProject && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                    <div className="bg-surface-dark w-full max-w-3xl rounded-2xl border border-gray-800 shadow-2xl overflow-hidden">
                        <div className="bg-surface-darker p-4 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="font-display font-bold text-xl text-white">Progreso por Rol</h3>
                            <button onClick={() => setProgressProject(null)} className="text-gray-400 hover:text-white">
                                <span className="material-icons-round">close</span>
                            </button>
                        </div>
                        <div className="p-6 space-y-5 max-h-[80vh] overflow-y-auto">
                            <div>
                                <p className="text-white font-bold text-lg">{progressProject.titulo}</p>
                                <p className="text-xs text-muted-dark">Avance real por Traduccion, Typeo y Redraw para asignar parejo.</p>
                            </div>
                            {progressLoading ? (
                                <div className="space-y-3">
                                    <div className="h-20 rounded-xl bg-gray-800/40 animate-pulse"></div>
                                    <div className="h-20 rounded-xl bg-gray-800/40 animate-pulse"></div>
                                </div>
                            ) : progressData ? (
                                <>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Capitulos Base</p>
                                            <p className="text-2xl font-display font-bold text-white">{progressData.summary.total_capitulos}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Traducidos</p>
                                            <p className="text-2xl font-display font-bold text-primary">{progressData.summary.traductor_completados}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Typeados</p>
                                            <p className="text-2xl font-display font-bold text-blue-400">{progressData.summary.typer_completados}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-[10px] uppercase text-muted-dark font-bold">Redraw</p>
                                            <p className="text-2xl font-display font-bold text-emerald-400">{progressData.summary.redrawer_completados}</p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Traduccion</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.traductor.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Typeo</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.typer.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                        <div className="p-3 rounded-xl border border-gray-800 bg-background-dark">
                                            <p className="text-xs font-bold text-white mb-2">Pendientes Redraw</p>
                                            <p className="text-xs text-muted-dark break-words">{progressData.missing.redrawer.slice(0, 20).join(', ') || 'Ninguno'}</p>
                                        </div>
                                    </div>
                                    <div className="border border-gray-800 rounded-xl overflow-hidden">
                                        <div className="grid grid-cols-4 bg-surface-darker text-[10px] uppercase font-bold tracking-wider text-muted-dark">
                                            <div className="p-2">Cap</div>
                                            <div className="p-2 text-center">Trad</div>
                                            <div className="p-2 text-center">Type</div>
                                            <div className="p-2 text-center">Redraw</div>
                                        </div>
                                        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
                                            {progressData.chapters.map((c) => (
                                                <div key={c.label} className="grid grid-cols-4 text-sm text-gray-200">
                                                    <div className="p-2 font-bold">{c.label}</div>
                                                    <div className="p-2 text-center">
                                                        <span className={`material-icons-round text-base ${c.traductor ? 'text-emerald-400' : 'text-gray-500'}`}>
                                                            {c.traductor ? 'check_box' : 'remove'}
                                                        </span>
                                                    </div>
                                                    <div className="p-2 text-center">
                                                        <span className={`material-icons-round text-base ${c.typer ? 'text-emerald-400' : 'text-gray-500'}`}>
                                                            {c.typer ? 'check_box' : 'remove'}
                                                        </span>
                                                    </div>
                                                    <div className="p-2 text-center">
                                                        <span className={`material-icons-round text-base ${c.redrawer ? 'text-emerald-400' : 'text-gray-500'}`}>
                                                            {c.redrawer ? 'check_box' : 'remove'}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
                                    No se pudo cargar el progreso del proyecto.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
