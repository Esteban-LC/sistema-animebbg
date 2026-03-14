'use client';

import { useEffect } from 'react';
import { useUser } from '@/context/UserContext';

export default function CapacitorPushInit() {
    const { user } = useUser();

    useEffect(() => {
        if (!user) return;
        if (typeof window === 'undefined') return;
        if (!(window as any).Capacitor) return;

        let cleanup: (() => void) | null = null;

        const init = async () => {
            try {
                const { PushNotifications } = await import('@capacitor/push-notifications');

                const permResult = await PushNotifications.checkPermissions();
                let perm = permResult.receive;

                if (perm === 'prompt') {
                    const req = await PushNotifications.requestPermissions();
                    perm = req.receive;
                }

                if (perm !== 'granted') return;

                await PushNotifications.register();

                const tokenHandler = await PushNotifications.addListener('registration', async (token) => {
                    try {
                        await fetch('/api/push/fcm-token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token: token.value }),
                        });
                    } catch {
                        // ignore
                    }
                });

                const notifHandler = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
                    window.dispatchEvent(new CustomEvent('notifications:changed'));
                });

                cleanup = () => {
                    tokenHandler.remove();
                    notifHandler.remove();
                };
            } catch {
                // ignore if plugin not available
            }
        };

        init();
        return () => { cleanup?.(); };
    }, [user]);

    return null;
}
