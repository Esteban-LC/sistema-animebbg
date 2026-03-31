'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useUser } from '@/context/UserContext';
import { useNotifications } from '@/context/NotificationsContext';

export default function BottomNav() {
    const pathname = usePathname();
    const { user, logout } = useUser();
    const { unread } = useNotifications();
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    if (pathname === '/login') return null;

    const roles = user?.roles || [];
    const isAdmin = user?.isAdmin || roles.includes('Administrador') || user?.role === 'admin';
    const isLeaderOnly = roles.includes('Lider de Grupo') || user?.role === 'Lider de Grupo';
    const profileRoleLabel = isAdmin ? 'Administrador' : isLeaderOnly ? 'Lider de Grupo' : 'Staff';
    const canViewSuggestions = isAdmin || isLeaderOnly || user?.groupSettings?.showSuggestions !== false;
    const canViewRanking = isAdmin || isLeaderOnly || user?.groupSettings?.showRanking !== false;
    const canViewNotifications = isAdmin || isLeaderOnly || user?.groupSettings?.showNotifications !== false;

    const isActive = (path: string) => {
        if (path === '/') return pathname === '/';
        return pathname.startsWith(path);
    };

    // ... existing simple helpers ...

    const getFabAction = () => {
        if (pathname.startsWith('/proyectos')) {
            return () => window.dispatchEvent(new Event('open-new-proyecto'));
        }
        if (pathname.startsWith('/asignaciones')) {
            return () => window.location.href = '/asignaciones/nueva';
        }
        return () => window.location.href = '/asignaciones/nueva';
    };

    const getFabIcon = () => {
        if (pathname.startsWith('/proyectos')) return 'library_add';
        if (pathname.startsWith('/asignaciones')) return 'add_task';
        return 'add';
    };

    let navItems = [];

    if (isAdmin) {
        navItems = [
            { href: '/', icon: 'dashboard', label: 'Inicio' },
            { href: '/proyectos', icon: 'auto_stories', label: 'Proyectos' }, // Changed icon to match sidebar better if needed, or keep library_books
            { href: '/asignaciones', icon: 'assignment', label: 'Tareas' },
            { href: '/sugerencias', icon: 'how_to_vote', label: 'Suger.' },
            { href: '/usuarios', icon: 'group', label: 'Staff' },
            { href: '/completados', icon: 'task_alt', label: 'Done' },
            { href: '/historial', icon: 'history', label: 'Historial' },
        ];
    } else if (isLeaderOnly) {
        navItems = [
            { href: '/', icon: 'dashboard', label: 'Inicio' },
            { href: '/proyectos', icon: 'auto_stories', label: 'Proyectos' },
            { href: '/asignaciones', icon: 'assignment', label: 'Tareas' },
            { href: '/usuarios', icon: 'group', label: 'Staff' },
            { href: '/completados', icon: 'task_alt', label: 'Done' },
            { href: '/historial', icon: 'history', label: 'Historial' },
            ...(canViewSuggestions ? [{ href: '/sugerencias', icon: 'how_to_vote', label: 'Suger.' }] : []),
            ...(canViewRanking ? [{ href: '/ranking', icon: 'emoji_events', label: 'Ranking' }] : []),
        ];
    } else {
        navItems = [
            { href: '/staff', icon: 'assignment', label: 'Mis Tareas' },
            { href: '/series', icon: 'auto_stories', label: 'Series' },
            ...(canViewSuggestions ? [{ href: '/sugerencias', icon: 'how_to_vote', label: 'Suger.' }] : []),
            { href: '/historial', icon: 'history', label: 'Historial' },
        ];
    }

    return (
        <>
            {/* ── FLOATING BOTTOM NAV (estilo Telegram - COMPACTO) ── */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 flex justify-center pb-8 pointer-events-none"
                style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom, 0px))' }}>

                {/* Contenedor flotante redondeado */}
                <nav className="pointer-events-auto w-[calc(100vw-16px)] max-w-[680px]">
                    {/* Barra flotante con bordes redondeados - MÁS COMPACTA */}
                    <div className="bg-surface-dark/95 backdrop-blur-xl rounded-full px-1.5 py-2 shadow-2xl border border-gray-800/50 flex items-center gap-1">
                        {/* Navigation Items */}
                        {navItems.map((item) => {
                            const active = isActive(item.href);
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 rounded-2xl transition-all duration-300 ${active
                                        ? 'bg-primary/20 scale-105'
                                        : 'hover:bg-white/5'
                                        }`}
                                >
                                    <span className={`material-icons-round transition-all duration-200 ${active
                                        ? 'text-primary text-[18px]'
                                        : 'text-gray-400 text-[17px]'
                                        }`}>
                                        {item.icon}
                                    </span>

                                    <span className={`text-[7px] leading-none font-semibold tracking-wide transition-colors duration-200 truncate max-w-full ${active ? 'text-primary' : 'text-gray-400'
                                        }`}>
                                        {item.label}
                                    </span>
                                </Link>
                            );
                        })}

                        {/* Profile Button - Opens Bottom Sheet */}
                        <button
                            onClick={() => setShowProfileMenu(true)}
                            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 rounded-2xl transition-all duration-300 hover:bg-white/5"
                        >
                            <div className="relative">
                                <div className="w-5 h-5 rounded-full object-cover border border-gray-600 bg-surface-dark flex items-center justify-center text-primary font-bold text-[8px]">
                                    {user?.nombre.substring(0, 2).toUpperCase()}
                                </div>
                                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-surface-dark" />
                                {!isLeaderOnly && canViewNotifications && unread > 0 && (
                                    <div className="absolute -top-1 -left-1 min-w-[14px] h-[14px] px-1 rounded-full bg-primary text-white text-[8px] font-bold flex items-center justify-center border border-surface-dark">
                                        {unread > 9 ? '9+' : unread}
                                    </div>
                                )}
                            </div>

                            <span className="text-[7px] leading-none font-semibold tracking-wide text-gray-400 truncate max-w-full">
                                Perfil
                            </span>
                        </button>
                    </div>


                </nav>
            </div>

            {/* ── PROFILE MODAL (centered) ── */}
            {showProfileMenu && (
                <>
                    {/* Backdrop */}
                    <div
                        className="md:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] animate-fade-in flex items-center justify-center p-4"
                        onClick={() => setShowProfileMenu(false)}
                    >
                        {/* Modal */}
                        <div
                            className="bg-gradient-to-b from-surface-dark to-surface-darker rounded-3xl shadow-2xl w-full max-w-sm animate-scale-in border border-gray-800/50"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header with User Info */}
                            <div className="p-6 pb-4 border-b border-gray-800/50">
                                <div className="flex items-center gap-4">
                                    <div className="relative">
                                        <div className="w-16 h-16 rounded-full border-2 border-primary shadow-glow shadow-primary/30 object-cover bg-surface-dark flex items-center justify-center text-primary font-bold text-2xl">
                                            {user?.nombre.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-surface-dark" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-white text-lg leading-tight">{user?.nombre}</h3>
                                        <p className="text-sm text-muted-dark mt-0.5">{profileRoleLabel}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Menu Options */}
                            <div className="p-4">
                                <Link
                                    href="/perfil"
                                    onClick={() => setShowProfileMenu(false)}
                                    className="flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-white/5 transition-colors group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center group-hover:bg-primary/25 transition-colors">
                                        <span className="material-icons-round text-xl text-primary">account_circle</span>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-white">Mi Perfil</p>
                                        <p className="text-xs text-muted-dark">Ver y editar información</p>
                                    </div>
                                    <span className="material-icons-round text-gray-600 text-lg">chevron_right</span>
                                </Link>

                                <Link
                                    href="/configuracion"
                                    onClick={() => setShowProfileMenu(false)}
                                    className="flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-white/5 transition-colors group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-gray-700/30 flex items-center justify-center group-hover:bg-gray-700/50 transition-colors">
                                        <span className="material-icons-round text-xl text-gray-400">settings</span>
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-sm font-semibold text-white">Configuración</p>
                                        <p className="text-xs text-muted-dark">Preferencias y ajustes</p>
                                    </div>
                                    <span className="material-icons-round text-gray-600 text-lg">chevron_right</span>
                                </Link>

                                {!isLeaderOnly && canViewNotifications && (
                                    <Link
                                        href="/notificaciones"
                                        onClick={() => setShowProfileMenu(false)}
                                        className="flex items-center gap-4 px-4 py-3.5 rounded-2xl hover:bg-white/5 transition-colors group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center group-hover:bg-blue-500/25 transition-colors">
                                            <span className="material-icons-round text-xl text-blue-400">notifications</span>
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-semibold text-white">Notificaciones</p>
                                            <p className="text-xs text-muted-dark">Avisos y actividad</p>
                                        </div>
                                        {unread > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-bold border border-primary/30">
                                                {unread}
                                            </span>
                                        )}
                                        <span className="material-icons-round text-gray-600 text-lg">chevron_right</span>
                                    </Link>
                                )}
                            </div>

                            {/* Logout Button - Separated */}
                            <div className="p-4 pt-0">
                                <button
                                    onClick={() => {
                                        setShowProfileMenu(false);
                                        logout(); // Assuming logout is available from useUser, wait, let me check strict usage
                                    }}
                                    className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 transition-colors group"
                                >
                                    <span className="material-icons-round text-xl text-red-500">logout</span>
                                    <p className="text-sm font-semibold text-red-500">Cerrar Sesión</p>
                                </button>
                            </div>

                            {/* Cancel Button */}
                            <div className="p-4 pt-2">
                                <button
                                    onClick={() => setShowProfileMenu(false)}
                                    className="w-full px-4 py-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors"
                                >
                                    <p className="text-sm font-semibold text-gray-300">Cancelar</p>
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
