// Caches the app shell so the home-screen app opens offline. Bump VERSION on each release.
const VERSION = 'v11';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/notes.js', 'js/prompt.js', 'js/gemini.js', 'js/recorder.js', 'js/process.js',
  'js/ui/dom.js', 'js/ui/library.js', 'js/ui/record.js', 'js/ui/meeting.js', 'js/ui/speakers.js', 'js/ui/settings.js', 'js/ui/player.js', 'js/version.js', 'js/theme.js', 'js/search.js', 'js/todos.js', 'js/ui/todos.js', 'js/backup.js', 'js/apilog.js', 'js/ui/log.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first (so updates arrive), cache as the offline fallback.
  // cache: 'no-cache' makes the browser check with GitHub Pages instead of reusing a 10-minute-old copy.
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    const copy = res.clone();
    caches.open(VERSION).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
