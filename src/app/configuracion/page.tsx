'use client';

import { useEffect, useState } from 'react';
import { useNotifications } from '@/context/NotificationsContext';
import { useToast } from '@/context/ToastContext';

export default function ConfiguracionPage() {
    const { soundEnabled, setSoundEnabled } = useNotifications();
    const { showToast } = useToast();
    const [config, setConfig] = useState({
        notificaciones: true
    });
    const [pushEnabled, setPushEnabled] = useState(false);
    const [pushSupported, setPushSupported] = useState(false);
    const [pushConfigured, setPushConfigured] = useState(false);
    const [pushPublicKey, setPushPublicKey] = useState('');
    const [pushLoading, setPushLoading] = useState(false);
    const [pushTesting, setPushTesting] = useState(false);

    useEffect(() => {
        const supported = typeof window !== 'undefined'
            && 'serviceWorker' in navigator
            && 'PushManager' in window
            && 'Notification' in window;
        setPushSupported(supported);
        if (!supported) return;

        const boot = async () => {
            try {
                const [keyRes, statusRes] = await Promise.all([
                    fetch('/api/push/public-key', { cache: 'no-store' }),
                    fetch('/api/push/subscription', { cache: 'no-store' }),
                ]);
                const keyData = await keyRes.json().catch(() => ({}));
                const statusData = await statusRes.json().catch(() => ({}));
                setPushConfigured(Boolean(keyData?.configured));
                setPushPublicKey(String(keyData?.publicKey || ''));
                setPushEnabled(Boolean(statusData?.enabled));
            } catch {
                // ignore bootstrap errors
            }
        };

        boot();
    }, []);

    const base64ToUint8Array = (base64: string) => {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(normalized);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; i += 1) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    };

    const setSystemNotifications = async (enabled: boolean) => {
        if (!pushSupported) {
            showToast('Este dispositivo no soporta Push web.', 'error');
            return;
        }
        if (!pushConfigured || !pushPublicKey) {
            showToast('Push no configurado en servidor (VAPID).', 'error');
            return;
        }

        setPushLoading(true);
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;

            if (enabled) {
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') {
                    showToast('Permiso de notificaciones denegado.', 'error');
                    setPushEnabled(false);
                    return;
                }

                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64ToUint8Array(pushPublicKey),
                });

                const res = await fetch('/api/push/subscription', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ subscription }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data?.error || 'No se pudo activar notificaciones del sistema');
                }
                setPushEnabled(true);
                showToast('Notificaciones del sistema activadas.', 'success');
                return;
            }

            const existing = await registration.pushManager.getSubscription();
            if (existing) {
                await fetch('/api/push/subscription', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: existing.endpoint }),
                });
                await existing.unsubscribe().catch(() => {
                    // ignore unsubscribe errors
                });
            }

            setPushEnabled(false);
            showToast('Notificaciones del sistema desactivadas.', 'info');
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'No se pudo actualizar push.', 'error');
        } finally {
            setPushLoading(false);
        }
    };

    const playTogglePreview = (enabled: boolean) => {
        if (typeof window === 'undefined') return;

        const AudioContextCtor =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return;

        try {
            const ctx = new AudioContextCtor();
            const now = ctx.currentTime;
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();

            oscillator.type = 'triangle';
            oscillator.frequency.setValueAtTime(enabled ? 920 : 520, now);
            gainNode.gain.setValueAtTime(0.0001, now);
            gainNode.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.18);

            window.setTimeout(() => {
                ctx.close().catch(() => {
                    // ignore close errors
                });
            }, 250);
        } catch {
            // ignore playback errors
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // TODO: Implementar guardado de configuracion
        alert('Configuracion guardada (funcion por implementar)');
    };

    const handlePushTest = async () => {
        setPushTesting(true);
        try {
            const res = await fetch('/api/push/test', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data?.error || 'No se pudo enviar prueba push');
            }
            showToast('Notificacion de prueba enviada.', 'success');
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Error en prueba push.', 'error');
        } finally {
            setPushTesting(false);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-background-dark overflow-hidden">
            {/* Header */}
            <header className="h-20 bg-surface-dark border-b border-gray-800 hidden md:flex items-center justify-between px-6 lg:px-8 z-10 sticky top-0 shrink-0">
                <div className="flex items-center gap-4">
                    <h1 className="font-display font-bold text-2xl lg:text-3xl uppercase tracking-wider text-white">
                        <span className="text-primary">Configuracion</span>
                    </h1>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-4 lg:p-8 pb-32 md:pb-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    {/* Notificaciones */}
                    <div className="bg-surface-dark p-6 rounded-xl border border-gray-800 shadow-lg">
                        <h3 className="font-display font-bold text-xl text-white mb-6 flex items-center gap-2">
                            <span className="material-icons-round text-primary">notifications</span>
                            Notificaciones
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-background-dark rounded-lg border border-gray-800">
                                <div>
                                    <h4 className="text-white font-medium">Notificaciones Generales</h4>
                                    <p className="text-sm text-muted-dark">Recibir notificaciones en la plataforma</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.notificaciones}
                                        onChange={e => setConfig({ ...config, notificaciones: e.target.checked })}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-background-dark rounded-lg border border-gray-800">
                                <div>
                                    <h4 className="text-white font-medium">Sonido de notificaciones</h4>
                                    <p className="text-sm text-muted-dark">Reproducir sonido cuando llegue una notificacion nueva</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={soundEnabled}
                                        onChange={e => {
                                            const enabled = e.target.checked;
                                            playTogglePreview(enabled);
                                            setSoundEnabled(enabled);
                                        }}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-4 bg-background-dark rounded-lg border border-gray-800">
                                <div>
                                    <h4 className="text-white font-medium">Notificaciones del sistema</h4>
                                    <p className="text-sm text-muted-dark">
                                        Mostrar avisos en la barra del celular incluso fuera de la app
                                    </p>
                                    {!pushSupported && (
                                        <p className="text-[11px] text-red-300 mt-1">No compatible en este dispositivo/navegador.</p>
                                    )}
                                    {pushSupported && !pushConfigured && (
                                        <p className="text-[11px] text-red-300 mt-1">Falta configurar claves VAPID en el servidor.</p>
                                    )}
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={pushEnabled}
                                        onChange={(e) => setSystemNotifications(e.target.checked)}
                                        disabled={pushLoading || !pushSupported || !pushConfigured}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-disabled:opacity-40"></div>
                                </label>
                            </div>
                            <div className="p-4 bg-background-dark rounded-lg border border-gray-800">
                                <button
                                    type="button"
                                    onClick={handlePushTest}
                                    disabled={pushTesting || !pushEnabled}
                                    className="w-full sm:w-auto px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-sm"
                                >
                                    {pushTesting ? 'Enviando prueba...' : 'Probar notificacion del sistema'}
                                </button>
                                <p className="text-[11px] text-muted-dark mt-2">
                                    Envia una notificacion real para comprobar que aparece en el panel nativo del celular.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Guardar */}
                    <div className="flex gap-4">
                        <button
                            onClick={handleSubmit}
                            className="flex-1 bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg shadow-lg shadow-primary/20 transition-all transform hover:scale-[1.02] flex items-center justify-center gap-2"
                        >
                            <span className="material-icons-round text-lg">save</span>
                            GUARDAR CONFIGURACION
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
