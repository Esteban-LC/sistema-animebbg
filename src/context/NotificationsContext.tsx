'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useUser } from '@/context/UserContext';
import { useToast } from '@/context/ToastContext';
import { useSocket } from '@/context/SocketContext';

interface NotificationsContextType {
    unread: number;
    soundEnabled: boolean;
    setSoundEnabled: (enabled: boolean) => void;
    refreshNotifications: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);
const NOTIFICATION_SOUND_KEY = 'notification:sound:enabled';
const REALTIME_SSE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SSE === '1';
const NOTIFICATION_POLL_INTERVAL_MS = process.env.NODE_ENV === 'production' ? 300000 : 30000;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
    const { user } = useUser();
    const { socket } = useSocket();
    const { showToast } = useToast();
    const pathname = usePathname();

    const [unread, setUnread] = useState(0);
    const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
    const lastProcessedRef = useRef<Set<string>>(new Set());
    const audioContextRef = useRef<AudioContext | null>(null);

    const [soundEnabled, setSoundEnabledState] = useState(() => {
        if (typeof window === 'undefined') return true;
        try {
            const stored = window.localStorage.getItem(NOTIFICATION_SOUND_KEY);
            if (stored === '0') return false;
            if (stored === '1') return true;
        } catch {
            // ignore storage errors
        }
        return true;
    });

    const setSoundEnabled = useCallback((enabled: boolean) => {
        setSoundEnabledState(enabled);
        try {
            window.localStorage.setItem(NOTIFICATION_SOUND_KEY, enabled ? '1' : '0');
        } catch {
            // ignore storage errors
        }
    }, []);

    const getAudioContext = useCallback(() => {
        if (typeof window === 'undefined') return null;
        if (audioContextRef.current) return audioContextRef.current;

        const AudioContextCtor =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

        if (!AudioContextCtor) return null;
        audioContextRef.current = new AudioContextCtor();
        return audioContextRef.current;
    }, []);

    const playNotificationSound = useCallback(async () => {
        if (!soundEnabled) return;

        const ctx = getAudioContext();
        if (!ctx) return;

        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
            } catch {
                return;
            }
        }

        try {
            const now = ctx.currentTime;
            const playPulse = (startAt: number, frequency: number) => {
                const oscillator = ctx.createOscillator();
                const gainNode = ctx.createGain();

                oscillator.type = 'triangle';
                oscillator.frequency.setValueAtTime(frequency, startAt);
                gainNode.gain.setValueAtTime(0.0001, startAt);
                gainNode.gain.exponentialRampToValueAtTime(0.26, startAt + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.20);

                oscillator.connect(gainNode);
                gainNode.connect(ctx.destination);
                oscillator.start(startAt);
                oscillator.stop(startAt + 0.22);
            };

            // Double pulse so the alert is clearly audible.
            playPulse(now, 1040);
            playPulse(now + 0.16, 880);
        } catch {
            // ignore audio playback errors
        }
    }, [getAudioContext, soundEnabled]);

    const refreshNotifications = useCallback(async () => {
        if (!user) {
            setUnread(0);
            return;
        }

        try {
            const res = await fetch('/api/notificaciones?summary=1', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json();
            const unreadCount = Number(data?.unread || 0);
            setUnread(unreadCount);
        } catch {
            // Ignore polling errors
        }
    }, [user]);

    useEffect(() => {
        const enableAudioOnInteraction = () => {
            const ctx = getAudioContext();
            if (!ctx) return;
            if (ctx.state === 'suspended') {
                ctx.resume().catch(() => {
                    // ignore resume errors
                });
            }
        };

        window.addEventListener('pointerdown', enableAudioOnInteraction, { passive: true });
        window.addEventListener('keydown', enableAudioOnInteraction);
        window.addEventListener('touchstart', enableAudioOnInteraction, { passive: true });

        return () => {
            window.removeEventListener('pointerdown', enableAudioOnInteraction);
            window.removeEventListener('keydown', enableAudioOnInteraction);
            window.removeEventListener('touchstart', enableAudioOnInteraction);
        };
    }, [getAudioContext]);


    useEffect(() => {
        const runRefresh = () => {
            if (document.visibilityState !== 'visible') return;
            if (isRealtimeConnected) return;
            refreshNotifications();
        };

        const boot = window.setTimeout(runRefresh, 0);
        const id = window.setInterval(runRefresh, NOTIFICATION_POLL_INTERVAL_MS);

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible' && !isRealtimeConnected) {
                refreshNotifications();
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            window.clearTimeout(boot);
            window.clearInterval(id);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [isRealtimeConnected, refreshNotifications]);
    useEffect(() => {
        const onChanged = () => {
            refreshNotifications();
        };
        window.addEventListener('notifications:changed', onChanged);
        return () => {
            window.removeEventListener('notifications:changed', onChanged);
        };
    }, [refreshNotifications]);

    useEffect(() => {
        if (!socket) return;
        const handleRefresh = (data?: any) => {
            console.log('[Socket] Refresh requested', data);
            refreshNotifications();
        };

        const handleNotification = (payload: any) => {
            console.log('[Socket] Notification received', payload);
            
            // Deduplicación rudimentaria para evitar doble toast (SSE + Socket)
            const nId = payload?.id ? String(payload.id) : `temp-${Date.now()}`;
            if (lastProcessedRef.current.has(nId)) return;
            
            lastProcessedRef.current.add(nId);
            setTimeout(() => lastProcessedRef.current.delete(nId), 10000);

            if (pathname !== '/notificaciones') {
                showToast(payload?.titulo || 'Nueva notificacion', 'info');
            }
            playNotificationSound();
            refreshNotifications();
            
            window.dispatchEvent(new CustomEvent('realtime:update', { detail: { type: 'notification', payload } }));
        };

        socket.on('content-changed', handleRefresh);
        socket.on('notification', handleNotification);

        return () => {
            socket.off('content-changed', handleRefresh);
            socket.off('notification', handleNotification);
        };
    }, [socket, refreshNotifications, pathname, showToast, playNotificationSound]);

    useEffect(() => {
        if (!user || !REALTIME_SSE_ENABLED) return;

        const es = new EventSource('/api/realtime/notificaciones');
        const dispatchRealtimeUpdate = (type: string, payload: unknown) => {
            window.dispatchEvent(new CustomEvent('realtime:update', { detail: { type, payload } }));
        };

        es.addEventListener('connected', () => {
            setIsRealtimeConnected(true);
        });

        es.addEventListener('notification', (ev) => {
            try {
                const payload = JSON.parse((ev as MessageEvent).data || '{}');
                
                // Deduplicación
                const nId = payload?.id ? String(payload.id) : `temp-sse-${Date.now()}`;
                if (lastProcessedRef.current.has(nId)) return;
                lastProcessedRef.current.add(nId);
                setTimeout(() => lastProcessedRef.current.delete(nId), 10000);

                if (pathname !== '/notificaciones') {
                    showToast(payload?.titulo || 'Nueva notificacion', 'info');
                }
                playNotificationSound();
                refreshNotifications();
                dispatchRealtimeUpdate('notification', payload);
            } catch {
                // ignore malformed payload
            }
        });
        es.addEventListener('project', (ev) => {
            try {
                const payload = JSON.parse((ev as MessageEvent).data || '{}');
                dispatchRealtimeUpdate('project', payload);
            } catch {
                // ignore malformed payload
            }
        });
        es.addEventListener('assignment', (ev) => {
            try {
                const payload = JSON.parse((ev as MessageEvent).data || '{}');
                dispatchRealtimeUpdate('assignment', payload);
            } catch {
                // ignore malformed payload
            }
        });
        es.addEventListener('ranking', (ev) => {
            try {
                const payload = JSON.parse((ev as MessageEvent).data || '{}');
                dispatchRealtimeUpdate('ranking', payload);
            } catch {
                // ignore malformed payload
            }
        });

        es.onerror = () => {
            setIsRealtimeConnected(false);
        };

        return () => {
            setIsRealtimeConnected(false);
            es.close();
        };
    }, [pathname, playNotificationSound, refreshNotifications, showToast, user]);

    return (
        <NotificationsContext.Provider value={{ unread, soundEnabled, setSoundEnabled, refreshNotifications }}>
            {children}
        </NotificationsContext.Provider>
    );
}

export function useNotifications() {
    const context = useContext(NotificationsContext);
    if (!context) {
        throw new Error('useNotifications must be used within NotificationsProvider');
    }
    return context;
}
