import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('a phone with v1 data opens under v2 with data intact and the log store added', async () => {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('meeting-notes', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('meetings', { keyPath: 'id' }).put({ id: 'old', title: 'From v1', createdAt: 1, parts: [] });
      db.createObjectStore('chunks', { keyPath: ['partId', 'seq'] }).createIndex('partId', 'partId');
      db.createObjectStore('settings');
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
  const { getMeeting, addLog, listLogs } = await import('../../js/db.js');
  assert.equal((await getMeeting('old')).title, 'From v1');
  await addLog({ at: 1, request: {}, status: 200 });
  assert.equal((await listLogs()).length, 1);
});
