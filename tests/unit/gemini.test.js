import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGemini, GeminiError, listModels, INLINE_LIMIT } from '../../js/gemini.js';
import { buildPrompt, buildRegeneratePrompt, RESPONSE_SCHEMA } from '../../js/prompt.js';

// Gemini streams Server-Sent Events: thought summaries first (keeps iOS from timing out), then the JSON in pieces.
const sse = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const answer = (obj, finishReason = 'STOP') => {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  const mid = Math.floor(text.length / 2);
  return sse([
    { candidates: [{ content: { parts: [{ text: 'Listening to the audio…', thought: true }] } }] },
    { candidates: [{ content: { parts: [{ text: text.slice(0, mid) }] } }] },
    { candidates: [{ content: { parts: [{ text: text.slice(mid) }] }, finishReason }] },
  ]);
};
const err = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status });

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
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/m1:streamGenerateContent?alt=sse');
  assert.equal(JSON.parse(init.body).generationConfig.thinkingConfig.includeThoughts, true);
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
  const fetch = fakeFetch([err(429, 'quota'), err(429, 'quota')]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch, sleep: () => {} });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && e.status === 429 && /free limit reached/.test(e.message));
});

test('500 throws GeminiError with the server message', async () => {
  const fetch = fakeFetch(Array.from({ length: 5 }, () => err(500, 'Internal boom')));
  const g = createGemini({ apiKey: 'K', model: 'm', fetch, sleep: () => {} });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && /Internal boom/.test(e.message));
});

test('non-JSON candidate text throws GeminiError', async () => {
  const fetch = fakeFetch([answer('{"summary": "cut')]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && /could not read/i.test(e.message));
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

test('regenerate uses a notes-only schema (no transcript echo)', async () => {
  const fetch = fakeFetch([answer({ summary: 's', key_ideas: [], todos: [] })]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch });
  await g.regenerate('[0:00] Speaker 1: hi', '');
  const schema = JSON.parse(fetch.calls[0].init.body).generationConfig.responseSchema;
  assert.equal(schema.properties.transcript, undefined);
  assert.ok(!schema.required.includes('transcript'));
});

test('no temperature override (Gemini 3 models loop at low temperature)', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  await createGemini({ apiKey: 'K', model: 'm', fetch }).processAudio([part([1])], '');
  assert.equal(JSON.parse(fetch.calls[0].init.body).generationConfig.temperature, undefined);
});

test('cut-off answer retries once with notes only, reusing the audio', async () => {
  const cut = answer('{"transcript": [', 'MAX_TOKENS');
  const fetch = fakeFetch([cut, answer({ summary: 'short', key_ideas: [], todos: [] })]);
  const out = await createGemini({ apiKey: 'K', model: 'm', fetch }).processAudio([part([104, 105])], '');
  assert.equal(out.summary, 'short');
  assert.equal(out.transcriptDropped, true);
  const second = JSON.parse(fetch.calls[1].init.body);
  assert.equal(second.generationConfig.responseSchema.properties.transcript, undefined);
  assert.equal(second.contents[0].parts.find(p => p.inline_data).inline_data.data, 'aGk=');
});

test('503 high demand: waits and retries, then succeeds', async () => {
  const fetch = fakeFetch([err(503, 'This model is currently experiencing high demand.'), answer(RESULT)]);
  const sleeps = [], status = [];
  const g = createGemini({ apiKey: 'K', model: 'main', fetch, sleep: ms => { sleeps.push(ms); }, onStatus: m => status.push(m) });
  assert.deepEqual(await g.processAudio([part([1])], ''), RESULT);
  assert.deepEqual(sleeps, [5000]);
  assert.match(status[0], /busy/i);
  assert.match(fetch.calls[1].url, /models\/main:/);
});

test('503 keeps happening: switches to the lighter fallback model', async () => {
  const fetch = fakeFetch([err(503, 'high demand'), err(503, 'high demand'), err(503, 'high demand'), answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'main', fetch, sleep: () => {} });
  assert.deepEqual(await g.processAudio([part([1])], ''), RESULT);
  assert.match(fetch.calls[3].url, /models\/gemini-flash-lite-latest:/);
});

test('429 on the main model goes straight to the fallback model', async () => {
  const fetch = fakeFetch([err(429, 'Quota exceeded'), answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'main', fetch, sleep: () => {} });
  assert.deepEqual(await g.processAudio([part([1])], ''), RESULT);
  assert.match(fetch.calls[1].url, /models\/gemini-flash-lite-latest:/);
});

test('everything busy: friendly 503 message', async () => {
  const fetch = fakeFetch(Array.from({ length: 5 }, () => err(503, 'high demand')));
  const g = createGemini({ apiKey: 'K', model: 'main', fetch, sleep: () => {} });
  await assert.rejects(g.processAudio([part([1])], ''), e => e instanceof GeminiError && e.status === 503 && /very busy/i.test(e.message));
});

test('a model that rejects thinking settings is retried without them', async () => {
  const fetch = fakeFetch([err(400, 'Thinking is not supported by this model.'), answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch, sleep: () => {} });
  assert.deepEqual(await g.processAudio([part([1])], ''), RESULT);
  assert.equal(JSON.parse(fetch.calls[1].init.body).generationConfig.thinkingConfig, undefined);
});

test('thought text is never mixed into the answer', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  const out = await createGemini({ apiKey: 'K', model: 'm', fetch }).processAudio([part([1])], '');
  assert.deepEqual(out, RESULT);
});

test('a dropped connection is retried once', async () => {
  const fetch = fakeFetch([() => { throw new TypeError('Load failed'); }, answer(RESULT)]);
  const g = createGemini({ apiKey: 'K', model: 'm', fetch, sleep: () => {} });
  assert.deepEqual(await g.processAudio([part([1])], ''), RESULT);
});

test('bookmarked times reach the prompt and the schema asks for highlights', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  await createGemini({ apiKey: 'K', model: 'm', fetch }).processAudio([part([1])], '', { bookmarks: [45, 190] });
  const body = JSON.parse(fetch.calls[0].init.body);
  const prompt = body.contents[0].parts.at(-1).text;
  assert.match(prompt, /marked important moments at 0:45, 3:10/);
  assert.ok(body.generationConfig.responseSchema.properties.highlights);
});

test('no bookmarks, no highlight instruction', () => {
  assert.doesNotMatch(buildPrompt({ parts: [{ startOffset: 0 }], context: '' }), /marked important/);
});

test('stand-up asks for Done / Doing / Blocked per person; general adds nothing', async () => {
  const { MEETING_TYPES } = await import('../../js/prompt.js');
  const p = buildPrompt({ parts: [{ startOffset: 0 }], context: '', type: 'standup' });
  assert.match(p, /stand-up/i);
  assert.match(p, /Done:.*Doing:.*Blocked:/s);
  assert.doesNotMatch(buildPrompt({ parts: [{ startOffset: 0 }], context: '', type: 'general' }), /extra_sections/);
  assert.deepEqual(Object.keys(MEETING_TYPES), ['general', 'client', 'standup', 'oneonone']);
  assert.match(buildPrompt({ parts: [{ startOffset: 0 }], context: '', type: 'client' }), /Client asks.*Decisions.*Risks.*Next steps/s);
});

test('meeting type reaches the prompt and schema has extra_sections', async () => {
  const fetch = fakeFetch([answer(RESULT)]);
  await createGemini({ apiKey: 'K', model: 'm', fetch }).processAudio([part([1])], '', { type: 'oneonone' });
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.match(body.contents[0].parts.at(-1).text, /Topics.*Feedback.*Commitments/s);
  assert.ok(body.generationConfig.responseSchema.properties.extra_sections);
});

test('known people are offered, with a rule to use names only when clear from speech', () => {
  const p = buildPrompt({ parts: [{ startOffset: 0 }], context: '', people: ['Asha', 'Rahul'] });
  assert.match(p, /Asha, Rahul/);
  assert.match(p, /only when .*clear/i);
  assert.doesNotMatch(buildPrompt({ parts: [{ startOffset: 0 }], context: '' }), /speaker_names/);
  assert.ok(RESPONSE_SCHEMA.properties.speaker_names);
});

test('ask sends the question with the ask schema and no audio', async () => {
  const fetch = fakeFetch([answer({ answer: 'Friday', sources: [] })]);
  const out = await createGemini({ apiKey: 'K', model: 'm', fetch }).ask('When?', 'CTX');
  assert.equal(out.answer, 'Friday');
  const body = JSON.parse(fetch.calls[0].init.body);
  assert.ok(body.generationConfig.responseSchema.properties.sources);
  assert.ok(body.contents[0].parts.every(p => !p.inline_data));
});
