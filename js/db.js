// IndexedDB storage: meetings, audio chunks, settings. Everything stays on the device.
const DB_NAME = 'meeting-notes';
let dbPromise = null;

export function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = e => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('meetings', { keyPath: 'id' });
          const chunks = db.createObjectStore('chunks', { keyPath: ['partId', 'seq'] });
          chunks.createIndex('partId', 'partId');
          db.createObjectStore('settings');
        }
        if (e.oldVersion < 2) db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
      };
      // Another open copy of the app on old code would block the upgrade: it closes itself below.
      req.onblocked = () => {};
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMeeting(m) {
  const tx = (await openDb()).transaction('meetings', 'readwrite');
  tx.objectStore('meetings').put(m);
  return done(tx);
}

export async function getMeeting(id) {
  const tx = (await openDb()).transaction('meetings');
  return request(tx.objectStore('meetings').get(id));
}

export async function listMeetings() {
  const tx = (await openDb()).transaction('meetings');
  const all = await request(tx.objectStore('meetings').getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteMeeting(id) {
  const db = await openDb();
  const m = await getMeeting(id);
  const tx = db.transaction(['meetings', 'chunks'], 'readwrite');
  tx.objectStore('meetings').delete(id);
  const chunks = tx.objectStore('chunks');
  for (const part of m?.parts || []) {
    chunks.delete(IDBKeyRange.bound([part.id, -Infinity], [part.id, Infinity]));
  }
  return done(tx);
}

export async function appendChunk(partId, seq, blob) {
  const tx = (await openDb()).transaction('chunks', 'readwrite');
  tx.objectStore('chunks').put({ partId, seq, blob });
  return done(tx);
}

export async function getPartBlob(partId, mimeType) {
  const tx = (await openDb()).transaction('chunks');
  const rows = await request(tx.objectStore('chunks').index('partId').getAll(partId));
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(rows.map(r => r.blob), { type: mimeType });
}

export async function getSetting(key, fallback) {
  const tx = (await openDb()).transaction('settings');
  const v = await request(tx.objectStore('settings').get(key));
  return v === undefined ? fallback : v;
}

export async function setSetting(key, value) {
  const tx = (await openDb()).transaction('settings', 'readwrite');
  tx.objectStore('settings').put(value, key);
  return done(tx);
}

// API request log (newest 200 kept).
const LOG_MAX = 200;
export async function addLog(entry) {
  const tx = (await openDb()).transaction('logs', 'readwrite');
  const store = tx.objectStore('logs');
  store.add(entry);
  const countReq = store.count();
  countReq.onsuccess = () => {
    let extra = countReq.result - LOG_MAX;
    if (extra <= 0) return;
    store.openCursor().onsuccess = ev => {
      const cur = ev.target.result;
      if (cur && extra-- > 0) { cur.delete(); cur.continue(); }
    };
  };
  return done(tx);
}

export async function listLogs() {
  const tx = (await openDb()).transaction('logs');
  return (await request(tx.objectStore('logs').getAll())).reverse();
}

export async function clearLogs() {
  const tx = (await openDb()).transaction('logs', 'readwrite');
  tx.objectStore('logs').clear();
  return done(tx);
}

// Restore writes every meeting and its audio in ONE transaction: all or nothing.
export async function putRestore(entries) {
  const tx = (await openDb()).transaction(['meetings', 'chunks'], 'readwrite');
  const meetings = tx.objectStore('meetings'), chunks = tx.objectStore('chunks');
  for (const { meeting, audio } of entries) {
    meetings.put(meeting);
    for (const { partId, blob } of audio) chunks.put({ partId, seq: 0, blob });
  }
  return done(tx);
}

// Per-day API usage counter (America/Los_Angeles day, same as Google's reset).
export async function addUsage({ day, model, tokens }) {
  const tx = (await openDb()).transaction('settings', 'readwrite');
  const store = tx.objectStore('settings');
  const key = `usage:${day}`;
  const get = store.get(key);
  get.onsuccess = () => {
    const u = get.result || {};
    const m = u[model] || { requests: 0, tokens: 0 };
    u[model] = { requests: m.requests + 1, tokens: m.tokens + (tokens || 0) };
    store.put(u, key);
  };
  return done(tx);
}

export async function getUsage(day) {
  return getSetting(`usage:${day}`, {});
}
