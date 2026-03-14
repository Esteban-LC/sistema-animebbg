import './globals.css';
import Sidebar from '@/components/Sidebar';
import MobileNavbar from '@/components/MobileNavbar';
import BottomNav from '@/components/BottomNav';
import CapacitorPushInit from '@/components/CapacitorPushInit';
import { SidebarProvider } from '@/context/SidebarContext';
import { UserProvider } from '@/context/UserContext';

export const metadata = {
  title: 'AnimeBBG Dashboard',
  description: 'Sistema de gestión para scanlations',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#0A0E17',
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

import { ToastProvider } from '@/context/ToastContext';
import { NotificationsProvider } from '@/context/NotificationsContext';
import { SocketProvider } from '@/context/SocketContext';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Rajdhani:wght@500;600;700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/icon?family=Material+Icons+Round" rel="stylesheet" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-background-dark text-text-dark font-sans h-screen flex overflow-hidden transition-colors duration-200">
        <SidebarProvider>
          <UserProvider>
            <ToastProvider>
              <NotificationsProvider>
                <SocketProvider>
                  <CapacitorPushInit />
                {/* Provider Wrapper */}
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
                </SocketProvider>
              </NotificationsProvider>
            </ToastProvider>
          </UserProvider>
        </SidebarProvider>
      </body>
    </html>
  );
}
