// Records the mic in "parts". iOS stops a web app's mic when it goes to the background,
// so every interruption closes the current part (already saved chunk by chunk) and a new
// part starts when the owner comes back. Browser APIs are injected for testing.

const BITRATE = 32000;
const TIMESLICE = 5000;

export function createRecorder({
  getUserMedia, MediaRecorder, wakeLock, doc,
  onChunk, onPartEnd, onInterrupted = () => {},
  now = () => Date.now(),
}) {
  let state = 'idle';
  let rec = null, stream = null, part = null, lock = null;
  let seq = 0, pending = [], startedAt = 0, accumulated = 0;

  const partSeconds = () => (accumulated + (state === 'recording' ? now() - startedAt : 0)) / 1000;

  async function acquireLock() {
    try { lock = await wakeLock?.request('screen'); } catch { lock = null; }
  }
  async function releaseLock() {
    const l = lock; lock = null;
    try { await l?.release(); } catch { /* already released */ }
  }

  function finishPart() {
    if (!rec) return Promise.resolve();
    const r = rec;
    return new Promise(resolve => {
      r.onstop = async () => {
        await Promise.allSettled(pending);
        stream?.getTracks().forEach(t => t.stop());
        part.duration = Math.round(partSeconds() * 10) / 10;
        rec = null; stream = null; pending = [];
        onPartEnd({ ...part });
        resolve();
      };
      if (state === 'recording') accumulated += now() - startedAt;
      state = 'stopping';
      r.stop();
    });
  }

  async function interrupt() {
    if (state !== 'recording' && state !== 'paused') return;
    await finishPart();
    await releaseLock();
    state = 'interrupted';
    onInterrupted();
  }

  async function onVisibility() {
    if (doc.visibilityState === 'hidden') return interrupt();
    if (state === 'recording' || state === 'paused') await acquireLock();
  }
  doc.addEventListener('visibilitychange', onVisibility);

  return {
    get state() { return state; },
    get currentPartId() { return rec ? part.id : null; },
    get currentMimeType() { return rec ? part.mimeType : null; },
    elapsed() { return (part?.startOffset || 0) + (rec ? partSeconds() : part?.duration || 0); },

    async start(meetingTimeOffset) {
      if (state === 'recording' || state === 'paused') return;
      stream = await getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      // A phone call or Siri can grab the mic: treat it like an interruption.
      stream.getAudioTracks?.().forEach(t => t.addEventListener?.('ended', () => interrupt()));
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : 'audio/webm';
      rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: BITRATE });
      part = { id: crypto.randomUUID(), mimeType, startOffset: meetingTimeOffset, duration: 0 };
      seq = 0; pending = []; accumulated = 0;
      const partId = part.id;
      rec.ondataavailable = e => {
        if (e.data && e.data.size) pending.push(onChunk(partId, seq++, e.data));
      };
      rec.start(TIMESLICE);
      startedAt = now();
      state = 'recording';
      await acquireLock();
    },

    pause() {
      if (state !== 'recording') return;
      rec.pause();
      accumulated += now() - startedAt;
      state = 'paused';
    },

    resume() {
      if (state !== 'paused') return;
      rec.resume();
      startedAt = now();
      state = 'recording';
    },

    async stop() {
      await finishPart();
      await releaseLock();
      state = 'idle';
    },

    dispose() { doc.removeEventListener('visibilitychange', onVisibility); },
  };
}
