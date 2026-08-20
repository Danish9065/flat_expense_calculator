const UPDATE_INTERVAL_MS = 15 * 60 * 1000;

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  let hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        const activateWaitingWorker = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
        const checkForUpdate = async () => {
          if (!navigator.onLine || reloading) return;
          await registration.update().catch(() => undefined);
          const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
          if (!response?.ok) return;
          const payload = await response.json().catch(() => null) as { version?: string } | null;
          if (payload?.version && payload.version !== __APP_VERSION__) {
            reloading = true;
            window.location.reload();
          }
        };

        activateWaitingWorker();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        window.setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS);
        window.addEventListener('online', () => void checkForUpdate());
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void checkForUpdate();
        });
        void checkForUpdate();
      })
      .catch((error) => console.warn('Service worker registration failed', error));
  });
}
