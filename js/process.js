// Runs the AI over a meeting and saves the result. Jobs survive screen re-renders.
import { getMeeting, saveMeeting, getPartBlob, getSetting, addLog } from './db.js';
import { createLoggedFetch } from './apilog.js';
import { EMPTY_PEOPLE } from './people.js';
import { buildAskContext } from './ask.js';
import { listMeetings } from './db.js';
import { createGemini } from './gemini.js';
import { normalizeResult, transcriptToText } from './notes.js';
import { meetingDuration } from './ui/dom.js';

export const DEFAULT_MODEL = 'gemini-flash-latest';
export const NO_KEY = 'Add your Gemini key in Settings';
const jobs = new Map();
const statusText = new Map();
export const jobStatus = id => statusText.get(id) || '';
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

// Every Gemini call goes through this, so it shows up in Settings › API log.
export const geminiFetch = createLoggedFetch({ save: addLog });

let geminiFactory = createGemini;
export function setGeminiFactory(fn) { geminiFactory = fn; } // tests

async function client(id) {
  const apiKey = await getSetting('apiKey', '');
  if (!apiKey) return null;
  const model = (await getSetting('model', DEFAULT_MODEL)) || DEFAULT_MODEL;
  return geminiFactory({ apiKey, model, fetch: geminiFetch, onStatus: msg => { statusText.set(id, msg); emit(id); } });
}

function mergeSpeakers(old = {}, labels) {
  const out = {};
  for (const l of labels) out[l] = old[l] || '';
  return out;
}

function friendlyError(e) {
  if (e instanceof TypeError || /load failed|failed to fetch|networkerror|network connection/i.test(e?.message || '')) {
    return 'Connection lost while making notes (was the app closed, or the internet off?). Keep the app open and tap "Make notes" to try again.';
  }
  return e?.message || String(e);
}

// keepTranscript: regenerate only rewrites the notes, never the owner's corrected transcript.
async function run(id, work, { keepTranscript = false } = {}) {
  if (jobs.has(id)) return jobs.get(id);
  const job = (async () => {
    const m = await getMeeting(id);
    const gemini = await client(id);
    if (!gemini) {
      m.error = NO_KEY; m.status = m.notes ? 'ready' : 'failed';
      await saveMeeting(m);
      return m;
    }
    const prevStatus = m.status;
    m.status = 'processing'; m.error = null; m.notice = null;
    await saveMeeting(m); emit(id);
    let result = null, error = null;
    try {
      const raw = await work(m, gemini);
      result = normalizeResult(raw, meetingDuration(m));
      result.dropped = !!raw.transcriptDropped;
    } catch (e) {
      error = friendlyError(e);
    }
    // Re-read so edits made while we waited (title, ticks) are not overwritten.
    const latest = (await getMeeting(id)) || m;
    if (result) {
      const doneFlags = new Map((latest.notes?.todos || []).map(t => [t.text, t.done]));
      result.notes.todos.forEach(t => { t.done = doneFlags.get(t.text) || false; });
      latest.notes = result.notes;
      if (!keepTranscript) {
        latest.transcript = result.transcript;
        latest.speakers = mergeSpeakers(latest.speakers, result.speakers);
        latest.nameGuesses = result.nameGuesses;
        latest.edited = false;
      }
      latest.notice = result.dropped ? 'This meeting was too long for a full transcript, so only the notes were made. The ↗ links still play the audio.' : null;
      latest.status = 'ready'; latest.error = null;
    } else {
      latest.error = error;
      latest.status = prevStatus === 'ready' ? 'ready' : 'failed';
    }
    await saveMeeting(latest);
    return latest;
  })();
  jobs.set(id, job);
  try { return await job; } finally { jobs.delete(id); statusText.delete(id); emit(id); }
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
    return gemini.processAudio(audio, m.context || '', { bookmarks: m.bookmarks || [], type: m.type || 'general', people: (await getSetting('peopleStore', EMPTY_PEOPLE)).people });
  });
}

export function regenerateNotes(id) {
  return run(id, (m, gemini) => gemini.regenerate(transcriptToText(m.transcript || [], m.speakers), m.context || '', { bookmarks: m.bookmarks || [], type: m.type || 'general' }), { keepTranscript: true });
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

export const NO_MEETINGS = 'Make notes for at least one meeting first, then ask about it.';

// One Gemini request with every meeting's notes and transcript as context.
export async function askMeetings(question, onStatus = () => {}) {
  const context = buildAskContext(await listMeetings());
  if (!context) throw new Error(NO_MEETINGS);
  const apiKey = await getSetting('apiKey', '');
  if (!apiKey) throw new Error(NO_KEY);
  const model = (await getSetting('model', DEFAULT_MODEL)) || DEFAULT_MODEL;
  const gemini = geminiFactory({ apiKey, model, fetch: geminiFetch, onStatus });
  try {
    return await gemini.ask(question, context);
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}
