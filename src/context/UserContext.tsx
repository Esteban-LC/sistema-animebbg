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
    role?: string; // Legacy support
    isDefaultPassword?: boolean;
}

interface UserContextType {
    user: User | null;
    loading: boolean;
    login: (credentials: any) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        checkUser();
    }, []);

    async function checkUser() {
        try {
            const res = await fetch('/api/auth/me');
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

    async function login(credentials: any) {
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

        if (userData.isAdmin || userData.roles?.includes('Administrador')) {
            router.push('/');
        } else {
            router.push('/staff');
        }
    }

    async function logout() {
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
            setUser(null);
            router.push('/login');
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
