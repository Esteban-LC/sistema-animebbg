'use client';

import { usePathname } from 'next/navigation';
import BottomNav from '@/components/BottomNav';
import MobileNavbar from '@/components/MobileNavbar';
import Sidebar from '@/components/Sidebar';
import { useUser } from '@/context/UserContext';

export default function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const { user, loading } = useUser();

    if (pathname === '/login') {
        return <div className="h-full w-full">{children}</div>;
    }

    if (loading) {
        return (
            <div className="flex h-full w-full items-center justify-center bg-background-dark">
                <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-surface-dark/80 px-5 py-4 text-sm text-muted-dark shadow-2xl backdrop-blur-xl">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-700 border-t-primary" />
                    Verificando sesion...
                </div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <div className="flex h-full w-full">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
                <MobileNavbar />
                <main className="flex-1 relative flex flex-col min-h-0 overflow-hidden">
                    {children}
                </main>
                <BottomNav />
            </div>
        </div>
    );
}
