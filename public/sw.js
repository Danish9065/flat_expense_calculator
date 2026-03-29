const CACHE_NAME = 'splitmate-cache-v3';

self.addEventListener('install', (e) => {
    self.skipWaiting(); // Force the waiting service worker to become the active service worker.
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll([
            '/',
            '/index.html',
        ]))
    );
});

self.addEventListener('activate', (e) => {
    // Clean up old caches
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    return caches.delete(key);
                }
            }));
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    // Only cache GET requests
    if (e.request.method !== 'GET') return;

    // Exclude API calls or InsForge URLs from cache to ensure fresh data
    const url = new URL(e.request.url);
    if (url.hostname.includes('insforge') || url.pathname.startsWith('/api')) {
        return;
    }

    // Network-first strategy for HTML pages (avoid aggressive caching)
    if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
        e.respondWith(
            fetch(e.request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(e.request, responseClone);
                    });
                    return response;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Cache first, network fallback for assets (JS, CSS, Images)
    e.respondWith(
        caches.match(e.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return fetch(e.request).then((networkResponse) => {
                const responseClone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, responseClone);
                });
                return networkResponse;
            });
        })
    );
});
