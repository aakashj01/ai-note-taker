// Talks to the Gemini REST API using the owner's own key. fetch/sleep are injectable for tests.
import { buildPrompt, buildRegeneratePrompt, RESPONSE_SCHEMA, NOTES_SCHEMA } from './prompt.js';
import { buildAskPrompt, ASK_SCHEMA } from './ask.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
export const INLINE_LIMIT = 14 * 1024 * 1024;
const POLL_MS = 2000, POLL_MAX = 60;

export class GeminiError extends Error {
  constructor(message, status = 0, truncated = false) { super(message); this.name = 'GeminiError'; this.status = status; this.truncated = truncated; }
}

async function check(res) {
  if (res.ok) return res;
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch { /* not JSON */ }
  if (res.status === 429) throw new GeminiError('Gemini free limit reached, try again in a minute (or tomorrow if the daily limit is used up).', 429);
  if (res.status === 400 && /api key/i.test(msg)) throw new GeminiError('Your Gemini API key was rejected. Check it in Settings.', 400);
  throw new GeminiError(`Gemini error ${res.status}${msg ? `: ${msg}` : ''}`, res.status);
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function listModels({ apiKey, fetch = globalThis.fetch }) {
  const res = await check(await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }));
  const { models = [] } = await res.json();
  return models
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .sort((a, b) => (b.includes('flash') - a.includes('flash')) || a.localeCompare(b));
}

export const FALLBACK_MODEL = 'gemini-flash-lite-latest';
const BUSY = [500, 502, 503, 504];
const BUSY_WAITS = [5000, 15000];

export function createGemini({
  apiKey, model, fetch = globalThis.fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  fallbackModel = FALLBACK_MODEL, onStatus = () => {},
}) {
  const auth = { 'x-goog-api-key': apiKey };

  async function upload(blob, mimeType) {
    const start = await check(await fetch(UPLOAD, {
      method: 'POST',
      headers: {
        ...auth,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(blob.size),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: 'meeting-audio' } }),
    }));
    const url = start.headers.get('x-goog-upload-url');
    if (!url) throw new GeminiError('Upload to Gemini failed (no upload URL).');
    const up = await check(await fetch(url, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0', 'Content-Type': mimeType },
      body: blob,
    }));
    let file = (await up.json()).file;
    for (let i = 0; file.state !== 'ACTIVE'; i++) {
      if (file.state === 'FAILED') throw new GeminiError('Gemini could not process this audio file.');
      if (i >= POLL_MAX) throw new GeminiError('Gemini took too long to process the audio. Try again.');
      await sleep(POLL_MS);
      file = await (await check(await fetch(`${BASE}/${file.name}`, { headers: auth }))).json();
    }
    return { file_data: { mime_type: mimeType, file_uri: file.uri } };
  }

  // One streamed request. Streaming (with thought summaries) keeps bytes arriving, so iPhone
  // Safari doesn't drop the connection while Gemini is still listening to a long recording.
  async function generateOnce(m, parts, schema, thinking) {
    const generationConfig = { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 65536 };
    if (thinking) generationConfig.thinkingConfig = { includeThoughts: true };
    const res = await check(await fetch(`${BASE}/models/${m}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    }));
    let text = '', finish = null, block = null, buf = '';
    const onLine = line => {
      if (!line.startsWith('data:')) return;
      let d;
      try { d = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (d.promptFeedback?.blockReason) block = d.promptFeedback.blockReason;
      const cand = d.candidates?.[0];
      for (const p of cand?.content?.parts || []) if (!p.thought && p.text) text += p.text;
      if (cand?.finishReason) finish = cand.finishReason;
    };
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      }
      buf += dec.decode();
    } else {
      buf = await res.text();
    }
    buf.split(/\r?\n/).forEach(onLine);
    if (!text) throw new GeminiError(`Gemini returned no notes${block ? ` (blocked: ${block})` : ''}.`);
    try {
      return JSON.parse(text);
    } catch {
      const cut = finish === 'MAX_TOKENS';
      throw new GeminiError(cut
        ? 'The AI\'s answer was cut off because the meeting is very long. Try again.'
        : 'Could not read the AI\'s answer. Try again.', 0, cut);
    }
  }

  // Retries busy errors, then moves to the lighter model (it has its own free quota).
  async function generate(parts, schema = RESPONSE_SCHEMA) {
    const models = fallbackModel && fallbackModel !== model ? [model, fallbackModel] : [model];
    let thinking = true, netRetried = false;
    for (let mi = 0; mi < models.length; mi++) {
      const m = models[mi];
      const waits = mi === 0 ? BUSY_WAITS : BUSY_WAITS.slice(0, 1);
      for (let attempt = 0; ; attempt++) {
        try {
          return await generateOnce(m, parts, schema, thinking);
        } catch (e) {
          if (e.status === 400 && thinking && /thinking/i.test(e.message)) { thinking = false; attempt--; continue; }
          if (e instanceof TypeError && !netRetried) { netRetried = true; attempt--; continue; }
          const busy = BUSY.includes(e.status);
          if (busy && attempt < waits.length) {
            onStatus(`Gemini is busy right now. Trying again in ${waits[attempt] / 1000} s…`);
            await sleep(waits[attempt]);
            continue;
          }
          if ((busy || e.status === 429) && mi < models.length - 1) {
            onStatus(`Switching to the lighter model (${models[mi + 1]})…`);
            break;
          }
          if (e.status === 503) throw new GeminiError('Gemini is very busy right now (high demand on Google\'s side). Your recording is saved. Try again in a few minutes.', 503);
          throw e;
        }
      }
    }
    throw new GeminiError('Gemini could not make notes. Try again.');
  }

  return {
    async processAudio(parts, context, opts = {}) {
      const total = parts.reduce((n, p) => n + p.blob.size, 0);
      const audio = [];
      for (const p of parts) {
        audio.push(total <= INLINE_LIMIT
          ? { inline_data: { mime_type: p.mimeType, data: await blobToBase64(p.blob) } }
          : await upload(p.blob, p.mimeType));
      }
      try {
        return await generate([...audio, { text: buildPrompt({ parts, context, ...opts }) }]);
      } catch (e) {
        if (!e.truncated) throw e;
        // Too long for transcript + notes in one answer: get the notes alone, same audio.
        const notes = await generate([...audio, { text: buildPrompt({ parts, context, notesOnly: true, ...opts }) }], NOTES_SCHEMA);
        return { ...notes, transcript: [], transcriptDropped: true };
      }
    },
    ask(question, context) {
      return generate([{ text: buildAskPrompt(question, context) }], ASK_SCHEMA);
    },
    regenerate(transcriptText, context, opts = {}) {
      return generate([{ text: buildRegeneratePrompt({ transcriptText, context, ...opts }) }], NOTES_SCHEMA);
    },
  };
}
