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
                console.log('[Push] Capacitor detectado, iniciando registro de notificaciones...');
                const { PushNotifications } = await import('@capacitor/push-notifications');

                const permResult = await PushNotifications.checkPermissions();
                let perm = permResult.receive;
                console.log('[Push] Estado de permisos actual:', perm);

                if (perm === 'prompt') {
                    const req = await PushNotifications.requestPermissions();
                    perm = req.receive;
                    console.log('[Push] Permiso solicitado, resultado:', perm);
                }

                if (perm !== 'granted') {
                    console.warn('[Push] Permiso no concedido, cancelando registro.');
                    return;
                }

                await PushNotifications.register();

                // Crear canal de notificación para Android 8+
                if ((window as any).Capacitor.getPlatform() === 'android') {
                    await PushNotifications.createChannel({
                        id: 'default',
                        name: 'Default',
                        description: 'Canal de notificaciones predeterminado',
                        importance: 5,
                        visibility: 1,
                        sound: 'default',
                        vibration: true,
                    });
                    console.log('[Push] Canal de notificación "default" creado.');
                }
                
                console.log('[Push] Registro llamado, esperando token...');

                const tokenHandler = await PushNotifications.addListener('registration', async (token) => {
                    console.log('[Push] Token FCM recibido:', token.value?.slice(0, 20) + '...');
                    try {
                        const res = await fetch('/api/push/fcm-token', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ token: token.value }),
                        });
                        if (res.ok) {
                            console.log('[Push] Token guardado en servidor correctamente.');
                        } else {
                            const err = await res.json().catch(() => ({}));
                            console.error('[Push] Error al guardar token:', err);
                        }
                    } catch (e) {
                        console.error('[Push] Fallo al enviar token al servidor:', e);
                    }
                });

                PushNotifications.addListener('registrationError', (error) => {
                    console.error('[Push] Error de registro FCM:', error);
                });

                const notifHandler = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
                    console.log('[Push] Notificación recibida en foreground:', notification.title);
                    window.dispatchEvent(new CustomEvent('notifications:changed'));
                });

                cleanup = () => {
                    tokenHandler.remove();
                    notifHandler.remove();
                };
            } catch (e) {
                console.error('[Push] Error fatal al inicializar push:', e);
            }
        };

        init();

        // Refresh notifications when app comes back to foreground
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                window.dispatchEvent(new CustomEvent('notifications:changed'));
            }
        };
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            cleanup?.();
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [user]);

    return null;
}
