self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {};
    }

    const title = payload.title || 'Nueva notificacion';
    const options = {
        body: payload.body || '',
        icon: payload.icon || '/icon-192x192.png',
        badge: payload.badge || '/icon-192x192.png',
        tag: payload.tag || `push-${Date.now()}`,
        renotify: true,
        data: {
            url: payload.url || '/notificaciones',
        },
    };

    event.waitUntil(
        Promise.all([
            self.registration.showNotification(title, options),
            self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
                for (const client of clientsArr) {
                    client.postMessage({ type: 'PUSH_RECEIVED', payload });
                }
            })
        ])
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = event.notification?.data?.url || '/notificaciones';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
            for (const client of clientsArr) {
                const currentUrl = new URL(client.url);
                const desired = new URL(targetUrl, self.location.origin);
                if (currentUrl.origin === desired.origin) {
                    client.focus();
                    if (currentUrl.pathname !== desired.pathname || currentUrl.search !== desired.search) {
                        return client.navigate(desired.href);
                    }
                    return Promise.resolve();
                }
            }
            return self.clients.openWindow(new URL(targetUrl, self.location.origin).href);
        })
    );
});
