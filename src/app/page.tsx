'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSidebar } from '@/context/SidebarContext';
import { useSocket } from '@/context/SocketContext';
import { useUser } from '@/context/UserContext';

interface Stats {
  total_asignaciones: number;
  pendientes: number;
  en_proceso: number;
  completadas: number;
  por_rol: {
    redraw: number;
    traduccion: number;
    typeo: number;
  };
}

interface Asignacion {
  id: number;
  descripcion: string;
  estado: string;
  asignado_en: string;
  rol: string;
  usuario_nombre: string;
  informe?: string;
  usuario_id: number;
  proyecto_titulo?: string;
  proyecto_imagen?: string;
  capitulo?: number;
}

export default function Dashboard() {
  const { toggle } = useSidebar();
  const { socket } = useSocket();
  const { user } = useUser();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentAssignments, setRecentAssignments] = useState<Asignacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'Pendiente' | 'En Proceso' | 'Completado'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'Traductor' | 'Redrawer' | 'Typer'>('all');

  // ... (useEffect and helper functions remain unchanged)

  useEffect(() => {
    async function fetchData() {
      try {
        const [statsRes, asigRes] = await Promise.allSettled([
          fetch('/api/estadisticas'),
          fetch('/api/asignaciones')
        ]);

        if (statsRes.status === 'fulfilled' && statsRes.value.ok) {
          const statsData = await statsRes.value.json();
          setStats(statsData);
        } else {
          setStats(null);
        }

        if (asigRes.status === 'fulfilled' && asigRes.value.ok) {
          const asigData = await asigRes.value.json();
          setRecentAssignments(Array.isArray(asigData) ? asigData.slice(0, 10) : []);
        } else {
          setRecentAssignments([]);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
        setStats(null);
        setRecentAssignments([]);
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    if (!socket) return;
    const handleContentChanged = () => {
      fetchData();
    };
    socket.on('content-changed', handleContentChanged);
    return () => {
      socket.off('content-changed', handleContentChanged);
    };
  }, [socket]);

  const fallbackStatsFromAssignments: Stats = {
    total_asignaciones: recentAssignments.length,
    pendientes: recentAssignments.filter((item) => item.estado === 'Pendiente').length,
    en_proceso: recentAssignments.filter((item) => item.estado === 'En Proceso').length,
    completadas: recentAssignments.filter((item) => item.estado === 'Completado').length,
    por_rol: {
      redraw: recentAssignments.filter((item) => item.rol === 'Redrawer').length,
      traduccion: recentAssignments.filter((item) => item.rol === 'Traductor').length,
      typeo: recentAssignments.filter((item) => item.rol === 'Typer').length,
    }
  };
  const safeStats = stats && !(stats as any).error ? stats : fallbackStatsFromAssignments;
  const groupLabel = String(user?.grupo_nombre || 'Mi Grupo').toUpperCase();
  const filteredAssignments = useMemo(() => {
    return recentAssignments.filter((item) => {
      const matchesStatus = statusFilter === 'all' || item.estado === statusFilter;
      const matchesRole = roleFilter === 'all' || item.rol === roleFilter;
      return matchesStatus && matchesRole;
    });
  }, [recentAssignments, roleFilter, statusFilter]);
  const hasActiveFilters = statusFilter !== 'all' || roleFilter !== 'all';

  const getRoleLabel = (role: string) => {
    if (role === 'Traductor') return 'TRADUCCIÓN';
    if (role === 'Redrawer') return 'REDRAW';
    if (role === 'Typer') return 'TYPEO';
    return role.toUpperCase();
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));

    if (diffInHours < 1) return 'Hace menos de 1h';
    if (diffInHours < 24) return `Hace ${diffInHours}h`;
    return `Hace ${Math.floor(diffInHours / 24)}d`;
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

  const clearFilters = () => {
    setStatusFilter('all');
    setRoleFilter('all');
  };

  return (
    <>
      <main className="flex-1 flex flex-col h-full overflow-hidden relative bg-background-dark">
        <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                {groupLabel}
              </h1>
              <p className="hidden lg:block text-xs text-muted-dark tracking-widest uppercase">Seguimiento de Producción</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/ranking">
              <button className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/40 rounded-lg text-sm font-medium hover:bg-amber-500/20 transition-colors text-amber-200 hidden sm:flex">
                <span className="material-icons-round text-base">emoji_events</span>
                <span>Ranking</span>
              </button>
            </Link>
            <button
              onClick={() => setShowFilters((prev) => !prev)}
              className={`flex items-center gap-2 px-4 py-2 border rounded-lg text-sm font-medium transition-colors text-white hidden sm:flex ${showFilters || hasActiveFilters ? 'bg-primary/10 border-primary text-primary' : 'bg-surface-darker border-gray-700 hover:border-primary'}`}
            >
              <span className="material-icons-round text-base">filter_list</span>
              <span>Filtros</span>
            </button>
            <Link href="/asignaciones/nueva">
              <button className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-bold shadow-lg shadow-primary/30 transition-all transform hover:scale-105 hidden sm:flex">
                <span className="material-icons-round text-base">add</span>
                <span>Asignar Capítulo</span>
              </button>
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 lg:p-8 bg-background-dark pb-32">
          <div className="max-w-7xl mx-auto space-y-8">

            {loading ? (
              <>
                {/* Stats Skeleton */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="bg-surface-dark p-5 rounded-xl border border-gray-800 shadow-lg relative overflow-hidden animate-pulse">
                      <div className="flex justify-between items-start mb-2">
                        <div className="h-3 bg-gray-800/50 rounded w-1/3"></div>
                        <div className="h-8 w-8 bg-gray-800/50 rounded-full"></div>
                      </div>
                      <div className="h-8 bg-gray-800/50 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>

                {/* Assignments Skeleton */}
                <div className="space-y-4">
                  <div className="h-6 bg-gray-800/50 rounded w-48 mb-4"></div>
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="bg-surface-dark rounded-xl overflow-hidden shadow-lg border border-gray-800 p-4 md:p-6 animate-pulse">
                      <div className="flex justify-between mb-4">
                        <div className="space-y-2 w-2/3">
                          <div className="h-5 bg-gray-800/50 rounded w-3/4"></div>
                          <div className="h-3 bg-gray-800/50 rounded w-1/4"></div>
                        </div>
                        <div className="h-6 bg-gray-800/50 rounded w-20"></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="h-2 bg-gray-800/50 rounded w-10"></div>
                          <div className="h-4 bg-gray-800/50 rounded w-24"></div>
                        </div>
                        <div className="space-y-2">
                          <div className="h-2 bg-gray-800/50 rounded w-10"></div>
                          <div className="h-4 bg-gray-800/50 rounded w-24"></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                {/* Stats Grid - Enhanced */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                  {/* Pendientes Card */}
                  <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-yellow-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden animate-fade-in">
                    {/* Gradient Accent */}
                    <div className="absolute inset-0 bg-gradient-to-br from-yellow-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                    {/* Icon Background */}
                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <span className="material-icons-round text-7xl text-yellow-500">pending_actions</span>
                    </div>

                    {/* Content */}
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Pendientes</p>
                        <div className="bg-yellow-500/20 p-2 rounded-lg shadow-glow shadow-yellow-500/20 group-hover:scale-110 transition-transform">
                          <span className="material-icons-round text-xl text-yellow-500">pending</span>
                        </div>
                      </div>
                      <h3 className="text-4xl font-display font-bold text-white group-hover:text-yellow-500 transition-colors">{safeStats.pendientes}</h3>
                      <div className="h-1 w-12 bg-gradient-to-r from-yellow-500 to-transparent rounded-full mt-3 group-hover:w-20 transition-all"></div>
                    </div>
                  </div>

                  {/* Completados Card */}
                  <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-emerald-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden animate-fade-in" style={{ animationDelay: '100ms' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <span className="material-icons-round text-7xl text-emerald-500">check_circle</span>
                    </div>

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Completados</p>
                        <div className="bg-emerald-500/20 p-2 rounded-lg shadow-glow shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                          <span className="material-icons-round text-xl text-emerald-500">check_circle</span>
                        </div>
                      </div>
                      <h3 className="text-4xl font-display font-bold text-white group-hover:text-emerald-500 transition-colors">{safeStats.completadas}</h3>
                      <div className="h-1 w-12 bg-gradient-to-r from-emerald-500 to-transparent rounded-full mt-3 group-hover:w-20 transition-all"></div>
                    </div>
                  </div>

                  {/* Limpieza Card */}
                  <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-orange-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden animate-fade-in" style={{ animationDelay: '200ms' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <span className="material-icons-round text-7xl text-orange-500">brush</span>
                    </div>

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Limpieza</p>
                        <div className="bg-orange-500/20 p-2 rounded-lg shadow-glow shadow-orange-500/20 group-hover:scale-110 transition-transform">
                          <span className="material-icons-round text-xl text-orange-500">brush</span>
                        </div>
                      </div>
                      <h3 className="text-4xl font-display font-bold text-white group-hover:text-orange-500 transition-colors">{safeStats.por_rol.redraw}</h3>
                      <div className="h-1 w-12 bg-gradient-to-r from-orange-500 to-transparent rounded-full mt-3 group-hover:w-20 transition-all"></div>
                    </div>
                  </div>

                  {/* Typeo Card */}
                  <div className="group bg-gradient-to-br from-surface-dark to-surface-darker p-5 rounded-xl border border-gray-800 hover:border-purple-500/50 shadow-card hover:shadow-card-hover transition-all duration-300 relative overflow-hidden animate-fade-in" style={{ animationDelay: '300ms' }}>
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>

                    <div className="absolute right-0 top-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <span className="material-icons-round text-7xl text-purple-500">font_download</span>
                    </div>

                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Typeo</p>
                        <div className="bg-purple-500/20 p-2 rounded-lg shadow-glow shadow-purple-500/20 group-hover:scale-110 transition-transform">
                          <span className="material-icons-round text-xl text-purple-500">font_download</span>
                        </div>
                      </div>
                      <h3 className="text-4xl font-display font-bold text-white group-hover:text-purple-500 transition-colors">{safeStats.por_rol.typeo}</h3>
                      <div className="h-1 w-12 bg-gradient-to-r from-purple-500 to-transparent rounded-full mt-3 group-hover:w-20 transition-all"></div>
                    </div>
                  </div>
                </div>

                {/* Assignments List */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-bold uppercase tracking-wider text-muted-dark">Asignaciones Recientes</h2>
                    {hasActiveFilters && (
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-primary"
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>

                  {showFilters && (
                    <div className="bg-surface-dark border border-gray-800 rounded-xl p-4 flex flex-col md:flex-row gap-4 md:items-end">
                      <label className="flex flex-col gap-2">
                        <span className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Estado</span>
                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'Pendiente' | 'En Proceso' | 'Completado')}
                          className="bg-surface-darker border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-w-44"
                        >
                          <option value="all">Todos</option>
                          <option value="Pendiente">Pendientes</option>
                          <option value="En Proceso">En proceso</option>
                          <option value="Completado">Completados</option>
                        </select>
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-[10px] font-bold text-muted-dark uppercase tracking-widest">Rol</span>
                        <select
                          value={roleFilter}
                          onChange={(e) => setRoleFilter(e.target.value as 'all' | 'Traductor' | 'Redrawer' | 'Typer')}
                          className="bg-surface-darker border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-w-44"
                        >
                          <option value="all">Todos</option>
                          <option value="Traductor">Traduccion</option>
                          <option value="Redrawer">Limpieza</option>
                          <option value="Typer">Typeo</option>
                        </select>
                      </label>
                    </div>
                  )}

                  {filteredAssignments.map((asig) => (
                    <div key={asig.id} className="bg-surface-dark rounded-xl overflow-hidden shadow-lg border border-gray-800 flex flex-col md:flex-row relative group">
                      {/* Mobile Border Strip */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1.5 md:hidden ${asig.estado === 'Pendiente' ? 'bg-primary' :
                        asig.estado === 'En Proceso' ? 'bg-blue-500' : 'bg-success'
                        }`}></div>

                      {/* Desktop Border Strip */}
                      <div className={`hidden md:block w-2 ${asig.estado === 'Pendiente' ? 'bg-primary' :
                        asig.estado === 'En Proceso' ? 'bg-blue-500' : 'bg-success'
                        }`}></div>

                      <div className="p-4 md:p-6 flex-1 flex flex-row gap-4 sm:gap-6">
                        {/* Image/Icon Block */}
                        <div className="flex shrink-0 w-20 h-28 rounded-xl bg-gradient-to-br from-surface-darker to-background-dark border border-gray-700 items-center justify-center overflow-hidden shadow-md group-hover:border-primary/50 transition-colors">
                          {asig.proyecto_imagen ? (
                            <img
                              src={asig.proyecto_imagen}
                              alt={asig.proyecto_titulo || 'Portada'}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                          ) : (
                            <span className="material-icons-round text-2xl text-gray-400 group-hover:text-primary transition-colors">
                              {getRoleIcon(asig.rol)}
                            </span>
                          )}
                        </div>

                        <div className="flex-1">
                          {/* Header */}
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 min-w-0 pr-2">
                              <h3 className="text-lg font-display font-bold text-white leading-tight mb-0.5 truncate">
                                {asig.proyecto_titulo && asig.capitulo
                                  ? `${asig.proyecto_titulo} - Capitulo ${asig.capitulo}`
                                  : asig.descripcion}
                              </h3>
                              <div className="text-xs text-muted-dark md:hidden">
                                {getTimeAgo(asig.asignado_en)}
                              </div>
                            </div>
                            <span className={`hidden md:inline-flex px-3 py-1 text-xs font-bold rounded uppercase border shrink-0 ${asig.estado === 'Pendiente' ? 'bg-primary/10 text-primary border-primary/20' :
                              asig.estado === 'En Proceso' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                'bg-success/10 text-success border-success/20'
                              }`}>
                              {asig.estado}
                            </span>
                          </div>

                          {/* Info Grid (Mimicking 3 columns logic visually, though single row here) */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 border-t border-dashed border-gray-800 pt-3 md:border-none md:pt-0">
                            <div className="space-y-0.5">
                              <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded border w-fit ${getRoleClasses(asig.rol)}`}>
                                <span className="material-icons-round text-[12px]">{getRoleIcon(asig.rol)}</span>
                                {getRoleLabel(asig.rol)}
                              </span>
                              <p className="text-sm font-bold text-white">@{asig.usuario_nombre}</p>
                              <p className={`text-sm font-medium ${asig.estado === 'Pendiente' ? 'text-primary' :
                                asig.estado === 'En Proceso' ? 'text-blue-500' : 'text-success'
                                }`}>{asig.estado}</p>
                            </div>

                            {/* Placeholder columns to match aesthetic if needed, or just show empty/other info */}
                            <div className="space-y-0.5 opacity-50 hidden md:block">
                              <span className="text-[10px] text-muted-dark uppercase font-bold tracking-wider">ROL</span>
                              <p className="text-sm font-medium text-gray-400">---</p>
                              <p className="text-sm font-medium text-gray-600">---</p>
                            </div>
                          </div>

                          {/* Report / Note */}
                          {asig.informe && (
                            <div className="pl-3 md:pl-0 mt-3 pt-3 border-t border-gray-800 flex gap-3 items-start">
                              <span className="material-icons-round text-sm text-gray-500 mt-0.5">sticky_note_2</span>
                              <p className="text-sm text-gray-400 italic line-clamp-2">
                                &quot;{asig.informe}&quot;
                              </p>
                            </div>
                          )}

                          {!asig.informe && (
                            <div className="pl-3 md:pl-0 mt-3 pt-3 border-t border-gray-800 flex gap-3 items-start opacity-30">
                              <span className="material-icons-round text-sm text-gray-500 mt-0.5">sticky_note_2</span>
                              <p className="text-sm text-gray-400 italic">Sin informes recientes.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {!filteredAssignments.length && (
                    <div className="bg-surface-dark rounded-xl border border-gray-800 border-dashed p-10 text-center">
                      <h3 className="text-lg font-bold text-white mb-2">Sin resultados</h3>
                      <p className="text-muted-dark">No hay asignaciones recientes para esos filtros.</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Floating Action Buttons (Mobile) */}
        <Link href="/ranking">
          <button className="md:hidden fixed bottom-32 left-6 w-14 h-14 bg-amber-500 text-black rounded-full shadow-[0_4px_20px_rgba(245,158,11,0.35)] flex items-center justify-center z-50 hover:bg-amber-400 transition-transform active:scale-95">
            <span className="material-icons-round text-3xl">emoji_events</span>
          </button>
        </Link>
        <Link href="/asignaciones/nueva">
          <button className="md:hidden fixed bottom-32 right-6 w-14 h-14 bg-primary text-white rounded-full shadow-[0_4px_20px_rgba(255,46,77,0.4)] flex items-center justify-center z-50 hover:bg-primary-dark transition-transform active:scale-95">
            <span className="material-icons-round text-3xl">add</span>
          </button>
        </Link>
      </main>
    </>
  );
}
