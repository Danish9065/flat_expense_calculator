const CACHE_NAME = 'splitmate-cache-v1';

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll([
            '/',
            '/index.html',
        ]))
    );
});

self.addEventListener('fetch', (e) => {
    // Only cache GET requests
    if (e.request.method !== 'GET') return;

    // Exclude API calls or InsForge URLs from cache to ensure fresh data
    const url = new URL(e.request.url);
    if (url.hostname.includes('insforge') || url.pathname.startsWith('/api')) {
        return;
    }

    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
