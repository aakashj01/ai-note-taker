// Runs the AI over a meeting and saves the result. Jobs survive screen re-renders.
import { getMeeting, saveMeeting, getPartBlob, getSetting } from './db.js';
import { createGemini } from './gemini.js';
import { normalizeResult, transcriptToText } from './notes.js';
import { meetingDuration } from './ui/dom.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';
export const NO_KEY = 'Add your Gemini key in Settings';
const jobs = new Map();
const listeners = new Set();

export const isRunning = id => jobs.has(id);
export const onJobChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = id => listeners.forEach(fn => fn(id));

// Gemini wants plain audio types; iOS/Voice Memos give e.g. audio/x-m4a or audio/webm;codecs=opus.
export function geminiMime(type) {
  const t = (type || '').split(';')[0].trim().toLowerCase();
  if (['audio/x-m4a', 'audio/m4a', 'audio/aac', 'video/mp4', 'audio/mp4', ''].includes(t)) return t === 'audio/aac' ? t : 'audio/mp4';
  if (t === 'audio/mpeg') return 'audio/mp3';
  if (t === 'audio/x-wav') return 'audio/wav';
  return t;
}

async function client() {
  const apiKey = await getSetting('apiKey', '');
  if (!apiKey) return null;
  const model = (await getSetting('model', DEFAULT_MODEL)) || DEFAULT_MODEL;
  return createGemini({ apiKey, model });
}

function mergeSpeakers(old = {}, labels) {
  const out = {};
  for (const l of labels) out[l] = old[l] || '';
  return out;
}

async function run(id, work) {
  if (jobs.has(id)) return jobs.get(id);
  const job = (async () => {
    const m = await getMeeting(id);
    const gemini = await client();
    if (!gemini) {
      m.error = NO_KEY; m.status = m.notes ? 'ready' : 'failed';
      await saveMeeting(m);
      return m;
    }
    const prevStatus = m.status;
    m.status = 'processing'; m.error = null;
    await saveMeeting(m); emit(id);
    try {
      const raw = await work(m, gemini);
      const r = normalizeResult(raw, meetingDuration(m));
      m.transcript = r.transcript;
      const doneFlags = new Map((m.notes?.todos || []).map(t => [t.text, t.done]));
      r.notes.todos.forEach(t => { t.done = doneFlags.get(t.text) || false; });
      m.notes = r.notes;
      m.speakers = mergeSpeakers(m.speakers, r.speakers);
      m.status = 'ready';
    } catch (e) {
      m.error = e.message || String(e);
      m.status = prevStatus === 'ready' ? 'ready' : 'failed';
    }
    await saveMeeting(m);
    return m;
  })();
  jobs.set(id, job);
  try { return await job; } finally { jobs.delete(id); emit(id); }
}

export function processMeeting(id) {
  return run(id, async (m, gemini) => {
    const parts = await Promise.all(m.parts.map(async p => ({
      blob: await getPartBlob(p.id, p.mimeType),
      mimeType: geminiMime(p.mimeType),
      startOffset: p.startOffset,
    })));
    const audio = parts.filter(p => p.blob.size > 0);
    if (!audio.length) throw new Error('This recording has no audio.');
    return gemini.processAudio(audio, m.context || '');
  });
}

export function regenerateNotes(id) {
  return run(id, (m, gemini) => gemini.regenerate(transcriptToText(m.transcript || [], m.speakers), m.context || ''));
}

// After a reload no job is running, so anything stuck "processing"/"recording" is recovered.
export async function recoverStuck(meetings) {
  for (const m of meetings) {
    if (m.status === 'processing' && !jobs.has(m.id)) {
      m.status = m.notes ? 'ready' : 'failed';
      m.error = 'Making notes was interrupted. Tap "Make notes" to try again.';
      await saveMeeting(m);
    } else if (m.status === 'recording' && !recoverStuck.activeRecording?.has(m.id)) {
      m.status = 'recorded';
      await saveMeeting(m);
    }
  }
}
recoverStuck.activeRecording = new Set();
