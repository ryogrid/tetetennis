// Register the service worker for offline play. Paths are derived from Vite's
// BASE_URL so the same code works at the dev root ("/") and under the GitHub
// Pages project path ("/tetetennis/").
export function registerPWA() {
  if (!('serviceWorker' in navigator)) return;
  // Only in production: a cache-first worker would serve stale modules and
  // break Vite's HMR during `npm run dev`.
  if (!import.meta.env.PROD) return;
  const base = import.meta.env.BASE_URL; // ends with "/"
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${base}sw.js`, { scope: base })
      .catch((err) => console.warn('SW registration failed:', err));
  });
}
