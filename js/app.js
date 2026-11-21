// Hash router: #/ library, #/record, #/m/{id}, #/m/{id}/speakers, #/settings
import { renderLibrary } from './ui/library.js';
import { renderRecord } from './ui/record.js';
import { renderMeeting } from './ui/meeting.js';
import { renderSpeakers } from './ui/speakers.js';
import { renderSettings } from './ui/settings.js';
import { renderTodos } from './ui/todos.js';

const root = document.getElementById('app');
let cleanup = null;

async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (typeof cleanup === 'function') { try { await cleanup(); } catch { /* ignore */ } }
  cleanup = null;
  root.replaceChildren();
  window.scrollTo(0, 0);
  let m;
  if (hash === '/') cleanup = await renderLibrary(root);
  else if (hash === '/record') cleanup = await renderRecord(root);
  else if ((m = hash.match(/^\/record\/([^/]+)$/))) cleanup = await renderRecord(root, decodeURIComponent(m[1]));
  else if (hash === '/settings') cleanup = await renderSettings(root);
  else if (hash === '/todos') cleanup = await renderTodos(root);
  else if ((m = hash.match(/^\/m\/([^/]+)\/speakers$/))) cleanup = await renderSpeakers(root, decodeURIComponent(m[1]));
  else if ((m = hash.match(/^\/m\/([^/]+)$/))) cleanup = await renderMeeting(root, decodeURIComponent(m[1]));
  else location.hash = '#/';
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update())
    .catch(() => {});
  // When a new version takes over, reload once so the new code runs.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
