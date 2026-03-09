'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/context/UserContext';
import { ClipboardList, Filter } from 'lucide-react';

interface HistorialItem {
    id: number;
    fecha: string;
    proyecto?: string;
    proyecto_titulo?: string;
    capitulo: string;
    rol: string;
    usuario: string;
    u_id?: number; // Optional if we want to filter by it later in frontend
}

interface Usuario {
    id: number;
    nombre: string;
}

interface ResumenItem {
    usuario_id: number | null;
    usuario: string;
    trabajos: number;
    trabajos_periodo?: number;
    trabajos_total?: number;
    traductor: number;
    typer: number;
    redrawer: number;
}

interface HistorialResponse {
    historial: HistorialItem[];
    resumen: ResumenItem[];
    range?: {
        start: string;
        end: string;
    } | null;
}

export default function HistorialPage() {
    const { user } = useUser();
    const [historial, setHistorial] = useState<HistorialItem[]>([]);
    const [resumen, setResumen] = useState<ResumenItem[]>([]);
    const [usuarios, setUsuarios] = useState<Usuario[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [draftSelectedUser, setDraftSelectedUser] = useState<string>('');
    const [draftStartDate, setDraftStartDate] = useState<string>('');
    const [draftEndDate, setDraftEndDate] = useState<string>('');

    const roles = user?.roles || [];
    const productionRoles = ['Traductor', 'Traductor ENG', 'Traductor KO', 'Traductor JAP', 'Traductor KO/JAP', 'Redrawer', 'Typer'];
    const hasProductionRole = roles.some((role) => productionRoles.includes(role));
    const isLeaderOnly = roles.includes('Lider de Grupo') && !hasProductionRole;
    const isAdmin = Boolean(user?.isAdmin || roles.includes('Administrador'));
    const canViewAll = isAdmin || isLeaderOnly;
    const summaryTitle = !canViewAll
        ? 'Mi conteo de trabajos'
        : isLeaderOnly && !isAdmin
            ? 'Conteo de trabajos del grupo'
            : 'Conteo de trabajos por usuario';

    const getRoleClasses = (role: string) => {
        switch (role) {
            case 'Traductor':
                return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30';
            case 'Typer':
                return 'text-violet-300 bg-violet-500/10 border-violet-500/30';
            case 'Redrawer':
                return 'text-orange-300 bg-orange-500/10 border-orange-500/30';
            default:
                return 'text-gray-300 bg-gray-500/10 border-gray-500/30';
        }
    };

    useEffect(() => {
        if (canViewAll) {
            fetchUsuarios();
        }
    }, [canViewAll]);

    useEffect(() => {
        setDraftSelectedUser(selectedUser);
    }, [selectedUser]);

    useEffect(() => {
        setDraftStartDate(startDate);
        setDraftEndDate(endDate);
    }, [startDate, endDate]);

    useEffect(() => {
        fetchHistorial();
    }, [selectedUser, startDate, endDate, user]);

    const fetchUsuarios = async () => {
        try {
            const res = await fetch('/api/usuarios');
            const data = await res.json();
            setUsuarios(data);
        } catch (error) {
            console.error(error);
        }
    };

    const fetchHistorial = async () => {
        if (!user) return;
        setLoading(true);
        try {
            let url = '/api/historial?include_summary=1';

            // If can't view all, force filter by own ID
            if (!canViewAll) {
                url += `&usuario_id=${user.id}`;
            } else if (selectedUser) {
                // If can view all and selected a specific user
                url += `&usuario_id=${selectedUser}`;
            }
            if (startDate && endDate) {
                url += `&start=${startDate}&end=${endDate}`;
            }

            const res = await fetch(url);
            const data: HistorialResponse | HistorialItem[] = await res.json();
            if (Array.isArray(data)) {
                setHistorial(data);
                setResumen([]);
                return;
            }
            setHistorial(Array.isArray(data?.historial) ? data.historial : []);
            setResumen(Array.isArray(data?.resumen) ? data.resumen : []);
            if (!startDate && !endDate && data?.range?.start && data?.range?.end) {
                setStartDate(data.range.start);
                setEndDate(data.range.end);
            }
        } catch (error) {
            console.error(error);
            setHistorial([]);
            setResumen([]);
        } finally {
            setLoading(false);
        }
    };

    const handleApplyFilters = () => {
        setSelectedUser(draftSelectedUser);
        setStartDate(draftStartDate);
        setEndDate(draftEndDate);
    };

    const handleCancelFilters = () => {
        setDraftSelectedUser(selectedUser);
        setDraftStartDate(startDate);
        setDraftEndDate(endDate);
    };

    const handleResetFilters = () => {
        setDraftSelectedUser('');
        setDraftStartDate('');
        setDraftEndDate('');
        setSelectedUser('');
        setStartDate('');
        setEndDate('');
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Historial</span>
                    </h1>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto">

                    {/* Filters Section (Only for Admins/Leaders) */}
                    {canViewAll && (
                        <div className="mb-6 flex items-center gap-4 bg-surface-dark p-4 rounded-xl border border-gray-800">
                            <div className="flex items-center gap-2 text-muted-dark">
                                <Filter size={18} />
                                <span className="text-xs font-bold uppercase tracking-wider">Filtrar por:</span>
                            </div>
                            <select
                                value={draftSelectedUser}
                                onChange={(e) => setDraftSelectedUser(e.target.value)}
                                className="bg-background-dark border border-gray-700 text-white text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5"
                            >
                                <option value="">Todos los Miembros</option>
                                {usuarios.map(u => (
                                    <option key={u.id} value={u.id}>{u.nombre}</option>
                                ))}
                            </select>
                            <input
                                type="date"
                                value={draftStartDate}
                                onChange={(e) => setDraftStartDate(e.target.value)}
                                className="bg-background-dark border border-gray-700 text-white text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5"
                            />
                            <input
                                type="date"
                                value={draftEndDate}
                                onChange={(e) => setDraftEndDate(e.target.value)}
                                className="bg-background-dark border border-gray-700 text-white text-sm rounded-lg focus:ring-primary focus:border-primary block p-2.5"
                            />
                            <button
                                type="button"
                                onClick={handleApplyFilters}
                                className="bg-primary hover:bg-primary-dark text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors"
                            >
                                Aplicar
                            </button>
                            <button
                                type="button"
                                onClick={handleCancelFilters}
                                className="bg-surface-darker border border-gray-700 hover:border-gray-500 text-white text-sm font-bold rounded-lg px-4 py-2.5 transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleResetFilters}
                                className="bg-surface-darker border border-gray-700 hover:border-primary/60 text-primary text-sm font-bold rounded-lg px-4 py-2.5 transition-colors"
                            >
                                Reiniciar
                            </button>
                        </div>
                    )}

                    {!loading && resumen.length > 0 && (
                        <div className="mb-6 bg-surface-dark p-4 rounded-xl border border-gray-800">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-dark mb-3">
                                {summaryTitle}
                            </p>
                            {startDate && endDate && (
                                <p className="text-xs text-muted-dark mb-3">
                                    Periodo visible: <span className="text-gray-200 font-semibold">{startDate} a {endDate}</span>
                                </p>
                            )}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {resumen.map((item) => (
                                    <div
                                        key={`${item.usuario_id ?? 'none'}-${item.usuario}`}
                                        className="bg-surface-darker border border-gray-700 rounded-lg px-4 py-3"
                                    >
                                        <p className="text-sm font-bold text-white truncate">{item.usuario || 'Usuario eliminado'}</p>
                                        <p className="text-xs text-muted-dark mt-1">
                                            Periodo: <span className="text-primary font-bold">{Number(item.trabajos_periodo ?? item.trabajos ?? 0)}</span>
                                        </p>
                                        {canViewAll && (
                                            <p className="text-xs text-muted-dark">
                                                Total historico: <span className="text-white font-bold">{Number(item.trabajos_total || 0)}</span>
                                            </p>
                                        )}
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 font-bold">
                                                Trad: {Number(item.traductor || 0)}
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 font-bold">
                                                Type: {Number(item.typer || 0)}
                                            </span>
                                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-300 font-bold">
                                                Redraw: {Number(item.redrawer || 0)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Table */}
                    <div className="bg-surface-dark rounded-xl border border-gray-800 shadow-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-surface-darker text-muted-dark uppercase text-xs font-bold tracking-wider">
                                    <tr>
                                        <th className="px-6 py-4">Proyecto</th>
                                        <th className="px-6 py-4">Capítulo</th>
                                        <th className="px-6 py-4">Rol</th>
                                        <th className="px-6 py-4">Realizado Por</th>
                                        <th className="px-6 py-4 text-right">Fecha</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-800">
                                    {loading ? (
                                        [...Array(5)].map((_, i) => (
                                            <tr key={i} className="animate-pulse">
                                                <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-32"></div></td>
                                                <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-12"></div></td>
                                                <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-20"></div></td>
                                                <td className="px-6 py-4"><div className="h-4 bg-gray-800/50 rounded w-24"></div></td>
                                                <td className="px-6 py-4 text-right"><div className="h-4 bg-gray-800/50 rounded w-20 ml-auto"></div></td>
                                            </tr>
                                        ))
                                    ) : historial.length > 0 ? (
                                        historial.map((item) => (
                                            <tr key={item.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-4 font-medium text-white">{item.proyecto_titulo || item.proyecto || '-'}</td>
                                                <td className="px-6 py-4 text-primary font-bold">Cap. {item.capitulo}</td>
                                                <td className="px-6 py-4">
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${getRoleClasses(item.rol)}`}>
                                                        {item.rol}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-white">
                                                    <div className="flex items-center gap-2">
                                                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                                                            {(item.usuario || '?').charAt(0).toUpperCase()}
                                                        </div>
                                                        {item.usuario || 'Usuario Eliminado'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-right text-muted-dark text-sm">
                                                    {new Date(item.fecha).toLocaleDateString()}
                                                </td>
                                            </tr>
                                        ))
                                    ) : (
                                        <tr>
                                            <td colSpan={5} className="px-6 py-12 text-center text-muted-dark">
                                                <div className="flex flex-col items-center gap-2">
                                                    <ClipboardList size={48} className="text-gray-700" />
                                                    <p>No hay historial disponible.</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
