'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSidebar } from '@/context/SidebarContext';
import { useUser } from '@/context/UserContext';
import { useNotifications } from '@/context/NotificationsContext';
import { useState } from 'react';

export default function Sidebar() {
    const { isOpen, close } = useSidebar();
    const { user, logout } = useUser();
    const { unread } = useNotifications();
    const pathname = usePathname();
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    if (!user) return null; // Don't show sidebar if not logged in (handled by layout/middleware usually, but safe guard here)

    const roles = user.roles || [];
    const isAdmin = user.isAdmin || roles.includes('Administrador') || user.role === 'admin';
    const isLeaderOnly = roles.includes('Lider de Grupo') || user.role === 'Lider de Grupo';
    const profileRoleLabel = isAdmin ? 'Administrador' : isLeaderOnly ? 'Lider de Grupo' : 'Staff';
    const canViewSuggestions = isAdmin || isLeaderOnly || user.groupSettings?.showSuggestions !== false;
    const canViewRanking = isAdmin || isLeaderOnly || user.groupSettings?.showRanking !== false;
    const canViewNotifications = isAdmin || isLeaderOnly || user.groupSettings?.showNotifications !== false;

    // Función para determinar si un link está activo
    const isActive = (path: string) => {
        if (path === '/') {
            return pathname === '/';
        }
        return pathname.startsWith(path);
    };

    const notificationsBadge = unread > 0 ? (
        <span className="ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary/20 text-primary text-xs font-bold border border-primary/40 flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
        </span>
    ) : null;

    return (
        <>
            {/* Mobile Overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={close}
                />
            )}

            {/* Sidebar */}
            <aside className={`
                fixed md:static inset-y-0 left-0 z-50
                w-72 bg-gradient-to-b from-surface-dark via-surface-dark to-surface-darker border-r border-gray-800/50 backdrop-blur-xl
                transform transition-transform duration-300 ease-in-out shadow-2xl
                ${isOpen ? 'translate-x-0' : '-translate-x-full'}
                md:translate-x-0 md:flex flex-col justify-between
            `}>
                <div>
                    {/* Logo Header with Gradient */}
                    <div className="h-20 flex items-center justify-between px-6 border-b border-gray-800/50 bg-gradient-to-r from-surface-darker to-surface-dark relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent"></div>
                        <div className="flex items-center gap-3 relative z-10">
                            <div className="bg-gradient-to-br from-primary to-blue-600 p-2.5 rounded-xl shadow-glow shadow-primary/30 animate-glow-pulse">
                                <span className="material-icons-round text-white text-2xl drop-shadow-lg">auto_stories</span>
                            </div>
                            <span className="font-display font-bold text-2xl tracking-wide uppercase text-white drop-shadow-md">
                                {String(user.grupo_nombre || 'Sin Grupo').toUpperCase()}
                            </span>
                        </div>
                        {/* Close button for mobile */}
                        <button onClick={close} className="md:hidden text-gray-400 hover:text-white transition-colors relative z-10">
                            <span className="material-icons-round text-2xl">close</span>
                        </button>
                    </div>

                    <nav className="p-4 space-y-2 select-none">
                        {isAdmin || isLeaderOnly ? (
                            <>
                                {/* Admin Menu */}
                                <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2">
                                    Administración
                                </div>
                                <Link
                                    href="/"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/') && pathname === '/'
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/') && pathname === '/' && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/') && pathname === '/' ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>dashboard</span>
                                    <span className="font-semibold">Dashboard</span>
                                </Link>
                                <Link
                                    href="/proyectos"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/proyectos')
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/proyectos') && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/proyectos') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>library_books</span>
                                    <span className="font-semibold">Proyectos</span>
                                </Link>
                                <Link
                                    href="/asignaciones"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/asignaciones')
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/asignaciones') && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/asignaciones') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>assignment</span>
                                    <span className="font-semibold">Asignaciones</span>
                                </Link>
                                <Link
                                    href="/usuarios"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/usuarios')
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/usuarios') && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/usuarios') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>group</span>
                                    <span className="font-semibold">{isLeaderOnly && !isAdmin ? 'Mi Staff' : 'Staff'}</span>
                                </Link>
                                <Link
                                    href="/historial"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/historial')
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/historial') && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/historial') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>history</span>
                                    <span className="font-semibold">Historial</span>
                                </Link>
                                {canViewSuggestions && (
                                    <Link
                                        href="/sugerencias"
                                        onClick={close}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/sugerencias')
                                            ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                            : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                            }`}
                                    >
                                        {isActive('/sugerencias') && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                        )}
                                        <span className={`material-icons-round transition-all duration-300 ${isActive('/sugerencias') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                            }`}>how_to_vote</span>
                                        <span className="font-semibold">Sugerencias</span>
                                    </Link>
                                )}
                                {canViewRanking && (
                                    <Link
                                        href="/ranking"
                                        onClick={close}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/ranking')
                                            ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                            : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                            }`}
                                    >
                                        {isActive('/ranking') && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                        )}
                                        <span className={`material-icons-round transition-all duration-300 ${isActive('/ranking') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                            }`}>emoji_events</span>
                                        <span className="font-semibold">Ranking</span>
                                    </Link>
                                )}
                                {isAdmin && (
                                    <Link
                                        href="/notificaciones"
                                        onClick={close}
                                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/notificaciones')
                                            ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                            : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                            }`}
                                    >
                                        {isActive('/notificaciones') && (
                                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                        )}
                                        <span className={`material-icons-round transition-all duration-300 ${isActive('/notificaciones') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                            }`}>notifications</span>
                                        <span className="font-semibold">Notificaciones</span>
                                        {notificationsBadge}
                                    </Link>
                                )}
                                <Link
                                    href="/completados"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-300 group relative overflow-hidden ${isActive('/completados')
                                        ? 'bg-gradient-to-r from-primary/20 to-primary/10 text-primary shadow-glow shadow-primary/20'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    {isActive('/completados') && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full shadow-glow shadow-primary/50"></div>
                                    )}
                                    <span className={`material-icons-round transition-all duration-300 ${isActive('/completados') ? 'text-primary scale-110' : 'group-hover:scale-110'
                                        }`}>task_alt</span>
                                    <span className="font-semibold">Completados</span>
                                </Link>
                            </>
                        ) : isLeaderOnly ? (
                            <>
                                <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2">
                                    Gestion Grupo
                                </div>
                                <Link href="/" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">dashboard</span>
                                    <span>Dashboard</span>
                                </Link>
                                <Link href="/proyectos" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/proyectos') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">library_books</span>
                                    <span>Proyectos</span>
                                </Link>
                                <Link href="/asignaciones" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/asignaciones') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">assignment</span>
                                    <span>Asignaciones</span>
                                </Link>
                                <Link href="/usuarios" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/usuarios') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">group</span>
                                    <span>Mi Staff</span>
                                </Link>
                                <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2 mt-2">
                                    General
                                </div>
                                <Link href="/series" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/series') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">auto_stories</span>
                                    <span>Series</span>
                                </Link>
                                <Link href="/historial" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/historial') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">history</span>
                                    <span>Historial</span>
                                </Link>
                                <Link href="/sugerencias" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/sugerencias') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">how_to_vote</span>
                                    <span>Sugerencias</span>
                                </Link>
                                <Link href="/ranking" onClick={close} className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/ranking') ? 'bg-primary/10 text-primary' : 'text-muted-dark hover:bg-surface-darker hover:text-primary'}`}>
                                    <span className="material-icons-round">emoji_events</span>
                                    <span>Ranking</span>
                                </Link>
                            </>
                        ) : (
                            <>
                                {/* Staff Menu */}
                                <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2">
                                    Mi Trabajo
                                </div>
                                <Link
                                    href="/staff"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/staff')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    <span className="material-icons-round">assignment</span>
                                    <span>Mis Tareas</span>
                                </Link>

                                {/* LEADER MENU ADDITIONS */}
                                {isLeaderOnly && (
                                    <>
                                        <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2 mt-2">
                                            Gestión Grupo
                                        </div>
                                        <Link
                                            href="/asignaciones"
                                            onClick={close}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/asignaciones')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                                }`}
                                        >
                                            <span className="material-icons-round">assignment</span>
                                            <span>Asignaciones</span>
                                        </Link>
                                        <Link
                                            href="/proyectos"
                                            onClick={close}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/proyectos')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                                }`}
                                        >
                                            <span className="material-icons-round">library_books</span>
                                            <span>Proyectos</span>
                                        </Link>
                                        <Link
                                            href="/usuarios"
                                            onClick={close}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/usuarios')
                                                ? 'bg-primary/10 text-primary'
                                                : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                                }`}
                                        >
                                            <span className="material-icons-round">group</span>
                                            <span>Mi Staff</span>
                                        </Link>
                                    </>
                                )}

                                <div className="text-xs font-bold text-muted-dark uppercase tracking-wider px-4 py-2 mt-2">
                                    General
                                </div>
                                <Link
                                    href="/series"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/series')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    <span className="material-icons-round">auto_stories</span>
                                    <span>Series</span>
                                </Link>
                                <Link
                                    href="/historial"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/historial')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    <span className="material-icons-round">history</span>
                                    <span>Historial</span>
                                </Link>
                                <Link
                                    href="/sugerencias"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/sugerencias')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    <span className="material-icons-round">how_to_vote</span>
                                    <span>Sugerencias</span>
                                </Link>
                                <Link
                                    href="/ranking"
                                    onClick={close}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all group ${isActive('/ranking')
                                        ? 'bg-primary/10 text-primary'
                                        : 'text-muted-dark hover:bg-surface-darker hover:text-primary'
                                        }`}
                                >
                                    <span className="material-icons-round">emoji_events</span>
                                    <span>Ranking</span>
                                </Link>
                            </>
                        )}
                    </nav>
                </div>

                <div className="p-4 border-t border-gray-800/50 bg-gradient-to-t from-surface-darker/50 to-transparent relative">
                    <div
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-gradient-to-r hover:from-surface-darker hover:to-surface-dark cursor-pointer transition-all duration-300 bg-surface-darker/50 border border-gray-800/50 hover:border-primary/30 hover:shadow-glow hover:shadow-primary/10 group"
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                    >
                        <div className="relative">
                            <div className="w-11 h-11 rounded-full border-2 border-primary shadow-glow shadow-primary/30 group-hover:scale-110 transition-transform duration-300 bg-surface-dark flex items-center justify-center text-primary font-bold text-lg">
                                {user.nombre.substring(0, 2).toUpperCase()}
                            </div>
                            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 rounded-full border-2 border-surface-dark shadow-glow shadow-emerald-500/50"></div>
                        </div>
                        <div className="flex-1 overflow-hidden">
                            <h4 className="font-bold text-sm truncate text-white group-hover:text-primary transition-colors">{user.nombre}</h4>
                            <p className="text-xs text-muted-dark truncate flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                {profileRoleLabel}
                            </p>
                        </div>
                        <span className={`material-icons-round text-gray-500 transition-all duration-300 ${showProfileMenu ? 'rotate-180 text-primary' : 'group-hover:text-primary'}`}>
                            expand_more
                        </span>
                    </div>

                    {/* Profile Dropdown Menu */}
                    {showProfileMenu && (
                        <div className="absolute bottom-full left-4 right-4 mb-2 bg-surface-dark border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-fade-in select-none">
                            <Link
                                href="/perfil"
                                onClick={() => {
                                    setShowProfileMenu(false);
                                    close();
                                }}
                                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-darker transition-colors text-white"
                            >
                                <span className="material-icons-round text-xl text-primary">account_circle</span>
                                <span className="text-sm font-medium">Mi Perfil</span>
                            </Link>
                            <Link
                                href="/configuracion"
                                onClick={() => {
                                    setShowProfileMenu(false);
                                    close();
                                }}
                                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-darker transition-colors text-white border-t border-gray-800"
                            >
                                <span className="material-icons-round text-xl text-gray-300">settings</span>
                                <span className="text-sm font-medium">Configuracion</span>
                            </Link>
                            {!isLeaderOnly && canViewNotifications && (
                                <Link
                                    href="/notificaciones"
                                    onClick={() => {
                                        setShowProfileMenu(false);
                                        close();
                                    }}
                                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-darker transition-colors text-white border-t border-gray-800"
                                >
                                    <span className="material-icons-round text-xl text-blue-300">notifications</span>
                                    <span className="text-sm font-medium">Notificaciones</span>
                                    {notificationsBadge}
                                </Link>
                            )}
                            <button
                                onClick={() => {
                                    setShowProfileMenu(false);
                                    logout();
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 transition-colors text-red-500 border-t border-gray-800"
                            >
                                <span className="material-icons-round text-xl">logout</span>
                                <span className="text-sm font-medium">Cerrar Sesión</span>
                            </button>
                        </div>
                    )}
                </div>
            </aside >
        </>
    );
}
