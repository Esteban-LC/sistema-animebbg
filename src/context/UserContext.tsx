'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface User {
    id: number;
    nombre: string;
    discord_username: string;
    roles: string[];
    isAdmin: boolean;
    activo: number;
    avatar_url?: string;
    grupo_id?: number;
    grupo_nombre?: string;
    groupSettings?: {
        showSuggestions: boolean;
        showRanking: boolean;
        showNotifications: boolean;
    };
    role?: string; // Legacy support
    isDefaultPassword?: boolean;
    rango?: number; // 1 = Nuevo, 2 = Staff
}

interface UserContextType {
    user: User | null;
    loading: boolean;
    login: (credentials: LoginCredentials) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

interface LoginCredentials {
    username: string;
    password: string;
    rememberMe?: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);
const PUBLIC_PATHS = ['/login'];

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        checkUser();
    }, []);

    useEffect(() => {
        if (loading) return;

        const isPublicPath = PUBLIC_PATHS.includes(pathname);

        if (!user && !isPublicPath) {
            router.replace('/login');
        }
    }, [loading, pathname, router, user]);

    async function checkUser() {
        try {
            const res = await fetch('/api/auth/me', { cache: 'no-store' });
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
            } else {
                setUser(null);
            }
        } catch (error) {
            console.error('Error checking user:', error);
            setUser(null);
        } finally {
            setLoading(false);
        }
    }

    async function login(credentials: LoginCredentials) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(credentials),
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Error al iniciar sesión');
        }

        const userData = await res.json();
        setUser(userData);

        const roles = Array.isArray(userData.roles) ? userData.roles : [];
        const isGroupLeader = roles.includes('Lider de Grupo') || userData.role === 'Lider de Grupo';

        if (userData.isAdmin || roles.includes('Administrador')) {
            router.push('/');
        } else if (isGroupLeader) {
            router.push('/');
        } else {
            router.push('/staff');
        }
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            setUser(null);
            router.replace('/login');
            router.refresh();
        } catch (error) {
            console.error('Error logging out:', error);
        }
    }

    return (
        <UserContext.Provider value={{ user, loading, login, logout, refreshUser: checkUser }}>
            {children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
}
