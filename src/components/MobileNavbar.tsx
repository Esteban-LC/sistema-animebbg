'use client';

import { usePathname } from 'next/navigation';

export default function MobileNavbar() {
    const pathname = usePathname();

    if (pathname === '/login') return null;

    const getTitle = () => {
        if (pathname === '/') return null; // El dashboard muestra logo
        if (pathname.includes('/usuarios')) return 'Staff';
        if (pathname.startsWith('/asignaciones/nueva')) return 'Nueva Tarea';
        if (pathname.startsWith('/asignaciones/')) return 'Detalle';
        if (pathname.includes('/asignaciones')) return 'Asignaciones';
        if (pathname.includes('/proyectos')) return 'Proyectos';
        if (pathname.includes('/series')) return 'Series';
        if (pathname.includes('/sugerencias')) return 'Sugerencias';
        if (pathname.includes('/completados')) return 'Completados';
        if (pathname.includes('/ranking')) return 'Ranking';
        if (pathname.includes('/notificaciones')) return 'Notificaciones';
        if (pathname.includes('/perfil')) return 'Mi Perfil';
        if (pathname.includes('/configuracion')) return 'Configuración';
        if (pathname.includes('/staff')) return 'Mis Tareas';
        return 'GRUPO-C4';
    };

    const title = getTitle();

    return (
        <header className="md:hidden h-14 bg-background-dark/95 backdrop-blur-lg border-b border-gray-800/40 flex items-center justify-center px-4 z-20 shrink-0 relative">
            {/* Logo o título centrado */}
            {pathname === '/' ? (
                <div className="flex items-center gap-2">
                    <div className="bg-gradient-to-br from-primary to-red-600 p-1.5 rounded-lg shadow-glow shadow-primary/40">
                        <span className="material-icons-round text-white text-base">auto_stories</span>
                    </div>
                    <span className="font-display font-bold text-xl uppercase tracking-wider text-white">
                        <span className="text-primary">GRUPO</span>-C4
                    </span>
                </div>
            ) : (
                <h1 className="font-display font-bold text-lg uppercase tracking-widest text-white">
                    <span className="text-primary">{title}</span>
                </h1>
            )}
        </header>
    );
}
