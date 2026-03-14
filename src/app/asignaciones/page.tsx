'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';

interface Asignacion {
    id: number;
    usuario_id: number;
    rol: string;
    descripcion: string;
    estado: string;
    asignado_en: string;
    usuario_nombre: string;
    proyecto_titulo?: string;
    proyecto_imagen?: string;
    capitulo?: number;
}

export default function AsignacionesPage() {
    const { user } = useUser();
    const { socket } = useSocket();
    const [asignaciones, setAsignaciones] = useState<Asignacion[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterStatus, setFilterStatus] = useState('todos');
    const [filterRole, setFilterRole] = useState('todos');

    useEffect(() => {
        async function fetchAsignaciones() {
            try {
                const res = await fetch('/api/asignaciones');
                const data = await res.json();
                if (Array.isArray(data)) {
                    setAsignaciones(data);
                } else {
                    console.error('API Error Response:', {
                        status: res.status,
                        statusText: res.statusText,
                        data: data
                    });
                    setAsignaciones([]);
                }
            } catch (err) {
                console.error(err);
                setAsignaciones([]);
            } finally {
                setLoading(false);
            }
        }
        fetchAsignaciones();

        if (!socket) return;
        const handleContentChanged = () => { fetchAsignaciones(); };
        socket.on('content-changed', handleContentChanged);
        return () => { socket.off('content-changed', handleContentChanged); };
    }, [socket]);

    const filtered = asignaciones.filter(a => {
        if (filterStatus !== 'todos' && a.estado !== filterStatus) return false;
        if (filterRole !== 'todos' && a.rol !== filterRole) return false;
        return true;
    });

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Pendiente': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
            case 'En Proceso': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
            case 'Completado': return 'text-success bg-success/10 border-success/20';
            default: return 'text-gray-400 bg-gray-800 border-gray-700';
        }
    };

    const getRoleIcon = (role: string) => {
        switch (role) {
            case 'Traductor': return 'translate';
            case 'Redrawer': return 'brush';
            case 'Typer': return 'font_download';
            default: return 'work';
        }
    };

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

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            {/* Header - Hidden on mobile because of global navbar, standard on desktop */}
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Asignaciones</span>
                    </h1>
                    <div className="hidden md:flex items-center bg-surface-darker rounded-lg px-3 py-2 w-64 border border-gray-700 focus-within:border-primary transition-colors">
                        <span className="material-icons-round text-gray-400 text-xl mr-2">search</span>
                        <input
                            className="bg-transparent border-none text-sm w-full focus:outline-none p-0 text-white placeholder-gray-400"
                            placeholder="Buscar asignación..."
                            type="text"
                        />
                    </div>
                </div>
                <Link href="/asignaciones/nueva">
                    <button className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/30 transition-all transform hover:scale-105">
                        <span className="material-icons-round text-base">add</span>
                        <span>Nueva Asignación</span>
                    </button>
                </Link>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-6xl mx-auto">

                    {/* Stats - Enhanced */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        {/* Total Card */}
                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-primary/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Total</p>
                                    <div className="bg-primary/20 p-2 rounded-lg shadow-glow shadow-primary/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-primary">assignment</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-primary transition-colors">{asignaciones.length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-primary to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        {/* Pendientes Card */}
                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-yellow-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Pendientes</p>
                                    <div className="bg-yellow-500/20 p-2 rounded-lg shadow-glow shadow-yellow-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-yellow-500">pending</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-yellow-500 transition-colors">{asignaciones.filter(a => a.estado === 'Pendiente').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-yellow-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        {/* En Proceso Card */}
                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-blue-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">En Proceso</p>
                                    <div className="bg-blue-500/20 p-2 rounded-lg shadow-glow shadow-blue-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-blue-500 animate-pulse">sync</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-blue-500 transition-colors">{asignaciones.filter(a => a.estado === 'En Proceso').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-blue-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>

                        {/* Completadas Card */}
                        <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-emerald-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative z-10">
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Completadas</p>
                                    <div className="bg-emerald-500/20 p-2 rounded-lg shadow-glow shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                                        <span className="material-icons-round text-lg text-emerald-500">check_circle</span>
                                    </div>
                                </div>
                                <h3 className="text-3xl font-display font-bold text-white group-hover:text-emerald-500 transition-colors">{asignaciones.filter(a => a.estado === 'Completado').length}</h3>
                                <div className="h-1 w-10 bg-gradient-to-r from-emerald-500 to-transparent rounded-full mt-2 group-hover:w-16 transition-all"></div>
                            </div>
                        </div>
                    </div>

                    {/* Filters */}
                    <div className="bg-surface-dark p-4 rounded-xl border border-gray-800 mb-6 flex flex-wrap gap-4 items-center">
                        <span className="text-muted-dark text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                            <span className="material-icons-round text-base">filter_list</span> Filtros:
                        </span>
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            className="bg-background-dark text-text-light text-sm rounded-lg border border-gray-700 px-3 py-2 focus:outline-none focus:border-primary"
                        >
                            <option value="todos">Todos los Estados</option>
                            <option value="Pendiente">Pendientes</option>
                            <option value="En Proceso">En Proceso</option>
                            <option value="Completado">Completados</option>
                        </select>
                        <select
                            value={filterRole}
                            onChange={e => setFilterRole(e.target.value)}
                            className="bg-background-dark text-text-light text-sm rounded-lg border border-gray-700 px-3 py-2 focus:outline-none focus:border-primary"
                        >
                            <option value="todos">Todos los Roles</option>
                            <option value="Traductor">Traductor</option>
                            <option value="Redrawer">Redrawer</option>
                            <option value="Typer">Typer</option>
                        </select>
                        <div className="flex gap-2 flex-wrap">
                            {['Traductor', 'Typer', 'Redrawer'].map((roleName) => (
                                <span key={roleName} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${getRoleClasses(roleName)}`}>
                                    <span className="material-icons-round text-[12px]">{getRoleIcon(roleName)}</span>
                                    {roleName}
                                </span>
                            ))}
                        </div>
                        <div className="ml-auto">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-primary/30 bg-primary/10 text-primary">
                                <span className="material-icons-round text-[12px]">groups</span>
                                        {String(user?.grupo_nombre || 'Sin Grupo').toUpperCase()}
                            </span>
                        </div>
                    </div>

                    {/* List */}
                    <div className="space-y-4">
                        {loading ? (
                            <>
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="bg-surface-dark rounded-xl p-0 shadow-lg border border-gray-800 animate-pulse">
                                        <div className="flex flex-col md:flex-row">
                                            <div className="w-full md:w-1.5 rounded-t-xl md:rounded-l-xl md:rounded-tr-none h-1 md:h-24 flex-shrink-0 bg-gray-800"></div>
                                            <div className="flex-1 p-5 flex flex-col md:flex-row items-center justify-between gap-4">
                                                <div className="flex items-center gap-4 w-full">
                                                    <div className="bg-surface-darker p-3 rounded-lg border border-gray-800 h-12 w-12"></div>
                                                    <div className="space-y-2 flex-1">
                                                        <div className="h-5 bg-gray-800 rounded w-1/2"></div>
                                                        <div className="flex gap-2">
                                                            <div className="h-4 bg-gray-800 rounded w-24"></div>
                                                            <div className="h-4 bg-gray-800 rounded w-24"></div>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                                                    <div className="hidden md:block text-right space-y-1">
                                                        <div className="h-3 bg-gray-800 rounded w-10 ml-auto"></div>
                                                        <div className="h-4 bg-gray-800 rounded w-16 ml-auto"></div>
                                                    </div>
                                                    <div className="h-8 bg-gray-800 rounded w-24"></div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </>
                        ) : filtered.length > 0 ? (
                            filtered.map((asig, index) => (
                                <Link href={`/asignaciones/${asig.id}`} key={asig.id}>
                                    <div
                                        className="bg-gradient-to-br from-surface-dark to-surface-darker rounded-xl p-0 shadow-card hover:shadow-card-hover border border-gray-800 hover:border-primary/50 transition-all duration-300 cursor-pointer group hover:transform hover:translate-x-2 animate-slide-up"
                                        style={{ animationDelay: `${index * 50}ms` }}
                                    >
                                        <div className="flex flex-row relative overflow-hidden h-full">
                                            {/* Accent Bar */}
                                            <div className={`w-1.5 flex-shrink-0 ${asig.estado === 'Completado' ? 'bg-emerald-500' :
                                                asig.estado === 'En Proceso' ? 'bg-blue-500' :
                                                    'bg-yellow-500'
                                                }`}></div>

                                            <div className="flex-1 p-3 sm:p-4 flex gap-3 sm:gap-5 items-start">
                                                {/* Image */}
                                                <div className="shrink-0 w-16 h-24 sm:w-20 sm:h-28 rounded-lg bg-gray-800 overflow-hidden shadow-md relative group-hover:ring-1 ring-primary/50 transition-all">
                                                    {asig.proyecto_imagen ? (
                                                        <img
                                                            src={asig.proyecto_imagen}
                                                            alt="Portada"
                                                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-surface-darker text-gray-400">
                                                            <span className="material-icons-round text-2xl">{getRoleIcon(asig.rol)}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Content */}
                                                <div className="flex-1 min-w-0 flex flex-col h-full justify-between">
                                                    <div>
                                                        <div className="flex justify-between items-start gap-2 mb-1">
                                                            <div className="flex flex-col">
                                                                <h3 className="font-bold text-base sm:text-lg text-white leading-tight break-words group-hover:text-primary transition-colors">
                                                                    {asig.proyecto_titulo || asig.descripcion}
                                                                </h3>
                                                                {asig.capitulo && (
                                                                    <span className="inline-flex items-center mt-1 w-fit px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-primary/20 text-primary border border-primary/20">
                                                                        Cap. {asig.capitulo}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Status Mobile - Icon Only */}
                                                            <div className={`sm:hidden shrink-0 rounded-full p-1 ${asig.estado === 'Completado' ? 'text-emerald-500 bg-emerald-500/10' :
                                                                asig.estado === 'En Proceso' ? 'text-blue-500 bg-blue-500/10' : 'text-yellow-500 bg-yellow-500/10'
                                                                }`}>
                                                                <span className="material-icons-round text-sm block">
                                                                    {asig.estado === 'Completado' ? 'check' : asig.estado === 'En Proceso' ? 'sync' : 'pending'}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-2 flex-wrap mb-2">
                                                            <div className="flex items-center gap-1.5 bg-background-dark/50 px-2 py-0.5 rounded text-xs text-gray-300 border border-gray-800">
                                                                <span className="material-icons-round text-[10px] text-primary">person</span>
                                                                <span className="truncate max-w-[80px] sm:max-w-none">{asig.usuario_nombre}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-xs text-muted-dark px-2 py-0.5">
                                                                <span className="material-icons-round text-[10px]">event</span>
                                                                {new Date(asig.asignado_en).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between mt-auto">
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded border inline-flex items-center gap-1 ${getRoleClasses(asig.rol)}`}>
                                                            <span className="material-icons-round text-[12px]">{getRoleIcon(asig.rol)}</span>
                                                            {asig.rol}
                                                        </span>

                                                        {/* Desktop Status Badge */}
                                                        <span className={`hidden sm:inline-flex px-2.5 py-1 rounded text-[10px] font-bold uppercase border items-center gap-1.5 ${getStatusColor(asig.estado)}`}>
                                                            <span className="material-icons-round text-xs">
                                                                {asig.estado === 'Completado' ? 'check_circle' :
                                                                    asig.estado === 'En Proceso' ? 'sync' : 'pending'}
                                                            </span>
                                                            {asig.estado}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Hover Shine Effect */}
                                            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000"></div>
                                            </div>
                                        </div>
                                    </div>
                                </Link>
                            ))
                        ) : (
                            <div className="bg-surface-dark rounded-xl border border-gray-800 border-dashed p-12 text-center">
                                <span className="material-icons-round text-6xl text-gray-800 mb-4">assignment_late</span>
                                <h3 className="text-xl font-bold text-white mb-2">No se encontraron asignaciones</h3>
                                <p className="text-muted-dark mb-6">No hay tareas que coincidan con los filtros seleccionados.</p>
                                <button
                                    onClick={() => { setFilterStatus('todos'); setFilterRole('todos'); }}
                                    className="text-primary hover:text-white font-medium hover:underline transition-colors"
                                >
                                    Limpiar filtros
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* FAB eliminado - el botón + está integrado en el BottomNav */}
        </div>
    );
}
