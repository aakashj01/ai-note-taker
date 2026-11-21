// Talks to the Gemini REST API using the owner's own key. fetch/sleep are injectable for tests.
import { buildPrompt, buildRegeneratePrompt, RESPONSE_SCHEMA, NOTES_SCHEMA } from './prompt.js';

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

async function blobToBase64(blob) {
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

export function createGemini({ apiKey, model, fetch = globalThis.fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
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

  async function generate(parts, schema = RESPONSE_SCHEMA) {
    const res = await check(await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, maxOutputTokens: 65536 },
      }),
    }));
    const data = await res.json();
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new GeminiError(`Gemini returned no notes${data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''}.`);
    try {
      return JSON.parse(text);
    } catch {
      const cut = cand?.finishReason === 'MAX_TOKENS';
      throw new GeminiError(cut
        ? 'The AI\'s answer was cut off because the meeting is very long. Try again.'
        : 'Could not read the AI\'s answer. Try again.', 0, cut);
    }
  }

  return {
    async processAudio(parts, context) {
      const total = parts.reduce((n, p) => n + p.blob.size, 0);
      const audio = [];
      for (const p of parts) {
        audio.push(total <= INLINE_LIMIT
          ? { inline_data: { mime_type: p.mimeType, data: await blobToBase64(p.blob) } }
          : await upload(p.blob, p.mimeType));
      }
      try {
        return await generate([...audio, { text: buildPrompt({ parts, context }) }]);
      } catch (e) {
        if (!e.truncated) throw e;
        // Too long for transcript + notes in one answer: get the notes alone, same audio.
        const notes = await generate([...audio, { text: buildPrompt({ parts, context, notesOnly: true }) }], NOTES_SCHEMA);
        return { ...notes, transcript: [], transcriptDropped: true };
      }
    },
    regenerate(transcriptText, context) {
      return generate([{ text: buildRegeneratePrompt({ transcriptText, context }) }], NOTES_SCHEMA);
    },
  };
}
