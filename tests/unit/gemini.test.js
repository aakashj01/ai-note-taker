import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, GeminiError, listModels, INLINE_LIMIT } from '../../js/gemini.js';
import { buildPrompt, buildRegeneratePrompt, RESPONSE_SCHEMA } from '../../js/prompt.js';

const answer = obj => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(obj) }] } }],
}), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeFetch(handlers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const h = handlers.shift();
    if (!h) throw new Error('unexpected fetch ' + url);
    return typeof h === 'function' ? h(String(url), init) : h;
  };
  fn.calls = calls;
  return fn;
}

const part = (bytes, startOffset = 0) => ({ blob: new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }), mimeType: 'audio/mp4', startOffset });
const RESULT = { summary: 's', key_ideas: [], todos: [], transcript: [] };

test('small audio is sent inline as base64', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'm1', fetch });
  const out = await g.processAudio([part([104, 105])], '');
  assert.deepEqual(out, RESULT);
  const { url, init } = fetch.calls[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/m1:generateContent');
  assert.equal(init.headers['x-goog-api-key'], 'K');
  const body = JSON.parse(init.body);
  const audio = body.contents[0].parts.find(p => p.inline_data);
  assert.equal(audio.inline_data.data, 'aGk=');
  assert.equal(audio.inline_data.mime_type, 'audio/mp4');
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(body.generationConfig.responseSchema, RESPONSE_SCHEMA);
});

test('large audio uses upload then polls until ACTIVE', async () => {
  const fileJson = state => new Response(JSON.stringify({ name: 'files/abc', uri: 'https://x/files/abc', state, mimeType: 'audio/mp4' }));
  const fetch = fakeFetch([
    new Response('{}', { headers: { 'x-goog-upload-url': 'https://up/session1' } }),
    new Response(JSON.stringify({ file: { name: 'files/abc', uri: 'https://x/files/abc', state: 'PROCESSING' } })),
    fileJson('PROCESSING'),
    fileJson('ACTIVE'),
    answer(RESULT),
  ]);
  const sleeps = [];
  const g = createGemini({ apiKey: 'K', model: 'm1', fetch, sleep: ms => { sleeps.push(ms); } });
  await g.processAudio([part(new Array(INLINE_LIMIT + 1).fill(0))], '');
  const [start, upload, poll1, , gen] = fetch.calls;
  assert.equal(start.url, 'https://generativelanguage.googleapis.com/upload/v1beta/files');
  assert.equal(start.init.headers['X-Goog-Upload-Command'], 'start');
  assert.equal(start.init.headers['X-Goog-Upload-Header-Content-Length'], String(INLINE_LIMIT + 1));
  assert.equal(upload.url, 'https://up/session1');
  assert.equal(upload.init.headers['X-Goog-Upload-Command'], 'upload, finalize');
  assert.equal(poll1.url, 'https://generativelanguage.googleapis.com/v1beta/files/abc');
  assert.deepEqual(sleeps, [2000, 2000]);
  const body = JSON.parse(gen.init.body);
  assert.deepEqual(body.contents[0].parts.find(p => p.file_data).file_data, { mime_type: 'audio/mp4', file_uri: 'https://x/files/abc' });
});

test('file processing FAILED throws GeminiError', async () => {
  const fetch = fakeFetch([
    new Response('{}', { headers: { 'x-goog-upload-url': 'https://up/s' } }),
    new Response(JSON.stringify({ file: { name: 'files/abc', uri: 'u', state: 'FAILED' } })),
  ]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch, sleep: () => {} });
  await assert.rejects(g.processAudio([part(new Array(INLINE_LIMIT + 1).fill(0))], ''), GeminiError);
});

test('429 throws GeminiError with friendly message', async () => {
  const fetch = fakeFetch([new Response('{"error":{"message":"quota"}}', { status: 429 })]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && e.status === 429 && /free limit reached/.test(e.message));
});

test('500 throws GeminiError with the server message', async () => {
  const fetch = fakeFetch([new Response('{"error":{"message":"Internal boom"}}', { status: 500 })]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && /Internal boom/.test(e.message));
});

test('non-JSON candidate text throws GeminiError', async () => {
  const fetch = fakeFetch([new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"summary": "cut' }] } }] }))]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && /cut off|could not read/i.test(e.message));
});

test('prompt mentions part start offsets and Roman script', () => {
  const p = buildPrompt({ parts: [{ startOffset: 0 }, { startOffset: 750 }], context: 'Q3 budget' });
  assert.match(p, /Part 2 starts at 12:30/);
  assert.match(p, /Roman/);
  assert.match(p, /\[unclear\]/);
  assert.match(p, /Q3 budget/);
  assert.match(p, /Never invent/i);
});

test('regenerate sends no audio parts', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await g.regenerate('[0:00] Speaker 1: hello', 'ctx');
  const parts = JSON.parse(fetch.calls[0].init.body).contents[0].parts;
  assert.ok(parts.every(p => !p.inline_data && !p.file_data));
  assert.match(buildRegeneratePrompt({ transcriptText: 'T', context: 'C' }), /T[\s\S]*C|C[\s\S]*T/);
});

test('listModels returns generateContent models, flash first', async () => {
  const fetch = fakeFetch([new Response(JSON.stringify({ models: [
    { name: 'models/gemini-pro-x', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
  ] }))]);
  assert.deepEqual(await listModels({ apiKey: 'K', fetch }), ['gemini-flash-latest', 'gemini-pro-x']);
});
