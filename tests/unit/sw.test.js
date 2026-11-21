import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('service worker always revalidates with the server (no stale HTTP cache)', async () => {
  const src = await readFile(new URL('../../sw.js', import.meta.url), 'utf8');
  const listeners = {};
  const fetchCalls = [];
  const self = { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: 'https://x.io' } };
  vm.runInNewContext(src, {
    self, location: self.location, URL,
    fetch: (req, init) => { fetchCalls.push(init); return Promise.resolve({ ok: true, clone() { return this; } }); },
    caches: { open: async () => ({ put() {} }), match: async () => undefined },
  });
  let responded;
  listeners.fetch({ request: { method: 'GET', url: 'https://x.io/js/gemini.js' }, respondWith: p => { responded = p; } });
  await responded;
  assert.equal(fetchCalls[0].cache, 'no-cache');
});
