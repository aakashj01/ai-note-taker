import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRequest, summarizeResponse, createLoggedFetch, usageToday, nextReset } from '../../js/apilog.js';
import { addLog, listLogs, clearLogs } from '../../js/db.js';

const GEN = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:streamGenerateContent?alt=sse';
const body = { contents: [{ parts: [{ inline_data: { mime_type: 'audio/mp4', data: 'A'.repeat(116000) } }, { text: 'Prompt here' }] }], generationConfig: { maxOutputTokens: 10 } };

test('key never logged', () => {
  const r = summarizeRequest(GEN + '&key=SECRET', { method: 'POST', headers: { 'x-goog-api-key': 'SECRET' }, body: JSON.stringify(body) });
  assert.doesNotMatch(JSON.stringify(r), /SECRET/);
  assert.equal(r.model, 'gemini-flash-lite-latest');
  assert.equal(r.action, 'streamGenerateContent');
  assert.equal(r.method, 'POST');
});

test('audio replaced by its size', () => {
  const r = summarizeRequest(GEN, { method: 'POST', body: JSON.stringify(body) });
  const s = JSON.stringify(r.body);
  assert.match(s, /\[audio 85 KB audio\/mp4\]/);
  assert.doesNotMatch(s, /AAAA/);
  assert.match(s, /Prompt here/);
});

test('upload body summarised', () => {
  const r = summarizeRequest('https://up/session', { method: 'POST', body: new Blob([new Uint8Array(3.2 * 1024 * 1024)]) });
  assert.equal(r.body, '[upload 3.2 MB]');
});

test('SSE answer and usage parsed, thoughts kept apart', () => {
  const sse = [
    { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: '{"a":' }] } }] },
    { candidates: [{ content: { parts: [{ text: '1}' }] } }], usageMetadata: { promptTokenCount: 2410, candidatesTokenCount: 612, thoughtsTokenCount: 80 } },
  ].map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const r = summarizeResponse(sse);
  assert.equal(r.text, '{"a":1}');
  assert.deepEqual(r.usage, { in: 2410, out: 612, thoughts: 80 });
});

test('error JSON response keeps the message', () => {
  const r = summarizeResponse('{"error":{"code":503,"message":"high demand"}}');
  assert.equal(r.error, 'high demand');
});

test('logged fetch saves request, status and timing; failed request logged with error', async () => {
  const saved = [];
  let t = 1000;
  const lf = createLoggedFetch({
    fetch: async url => { if (url.includes('fail')) throw new TypeError('Load failed'); t += 500; return new Response('{"error":{"message":"busy"}}', { status: 503 }); },
    save: async e => { saved.push(e); }, now: () => t,
  });
  const res = await lf(GEN, { method: 'POST', body: '{}' });
  assert.equal(res.status, 503);
  await assert.rejects(lf('https://x/fail', {}), TypeError);
  await new Promise(r => setTimeout(r, 20));
  const ok = saved.find(e => e.status === 503);
  assert.equal(ok.ms, 500);
  assert.equal(ok.error, 'busy');
  const bad = saved.find(e => e.status === 0);
  assert.equal(bad.error, 'Load failed');
});

test('usage counts only today in Pacific time, generate calls only, not 429s', () => {
  const now = Date.parse('2026-11-21T12:00:00Z'); // 04:00 Pacific, Nov 21
  const e = (iso, action, status, usage) => ({ at: Date.parse(iso), status, usage, request: { model: 'm', action } });
  const logs = [
    e('2026-11-21T09:00:00Z', 'streamGenerateContent', 200, { in: 100, out: 50, thoughts: 0 }), // 01:00 Pacific today
    e('2026-11-21T07:00:00Z', 'streamGenerateContent', 200, { in: 999, out: 0 }),               // 23:00 Pacific yesterday
    e('2026-11-21T10:00:00Z', 'streamGenerateContent', 429, null),
    e('2026-11-21T10:30:00Z', 'models', 200, null),
    e('2026-11-21T11:00:00Z', 'streamGenerateContent', 503, null),
  ];
  assert.deepEqual(usageToday(logs, now), { m: { requests: 2, tokens: 150 } });
});

test('next reset is the coming midnight in Pacific time', () => {
  assert.equal(nextReset(Date.parse('2026-11-21T12:00:00Z')).toISOString(), '2026-11-22T08:00:00.000Z');
  assert.equal(nextReset(Date.parse('2026-07-01T12:00:00Z')).toISOString(), '2026-07-02T07:00:00.000Z');
});

test('log store keeps the newest 200', async () => {
  await clearLogs();
  for (let i = 0; i < 205; i++) await addLog({ at: i, request: {}, status: 200 });
  const logs = await listLogs();
  assert.equal(logs.length, 200);
  assert.equal(logs[0].at, 204);
});

test('usage is kept in its own daily counter, so clearing the log does not reset it', async () => {
  const { usageDelta, laDay } = await import('../../js/apilog.js');
  const { addUsage, getUsage } = await import('../../js/db.js');
  const at = Date.parse('2026-11-21T12:00:00Z');
  const entry = { at, status: 200, usage: { in: 10, out: 5, thoughts: 1 }, request: { model: 'm', action: 'streamGenerateContent' } };
  assert.deepEqual(usageDelta(entry), { day: '2026-11-21', model: 'm', tokens: 16 });
  assert.equal(usageDelta({ ...entry, status: 429 }), null);
  assert.equal(usageDelta({ ...entry, request: { model: 'm', action: 'file-status' } }), null);
  await addUsage(usageDelta(entry));
  await addUsage(usageDelta(entry));
  await clearLogs();
  assert.deepEqual(await getUsage(laDay(at)), { m: { requests: 2, tokens: 32 } });
});

test('logged fetch also counts usage', async () => {
  const counted = [];
  const lf = createLoggedFetch({ fetch: async () => new Response('{}', { status: 200 }), save: async () => {}, count: async d => { counted.push(d); } });
  await lf('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent', { method: 'POST', body: '{}' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(counted.length, 1);
  assert.equal(counted[0].model, 'm');
});
