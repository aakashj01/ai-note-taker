import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecorder } from '../../js/recorder.js';

function setup({ mp4 = true } = {}) {
  const log = { chunks: [], parts: [], interrupted: 0, locks: [], released: 0, opts: null, timeslice: null };
  let clock = 0;
  let current = null;
  class FakeMR {
    static isTypeSupported(t) { return mp4 ? t === 'audio/mp4' : t === 'audio/webm'; }
    constructor(stream, opts) { this.stream = stream; this.state = 'inactive'; log.opts = opts; current = this; }
    start(ts) { this.state = 'recording'; log.timeslice = ts; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    emit(text) { this.ondataavailable({ data: new Blob([text]) }); }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['last']) }); setTimeout(() => this.onstop(), 0); }
  }
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t, f) => { listeners[t] = f; },
    removeEventListener: t => { delete listeners[t]; },
  };
  const track = { stop() { track.stopped = true; }, addEventListener() {} };
  const rec = createRecorder({
    getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
    MediaRecorder: FakeMR,
    wakeLock: { request: async t => { log.locks.push(t); return { release: async () => { log.released++; } }; } },
    doc,
    now: () => clock,
    onChunk: async (partId, seq, blob) => { log.chunks.push({ partId, seq, size: blob.size }); },
    onPartEnd: part => log.parts.push({ ...part }),
    onInterrupted: () => { log.interrupted++; },
  });
  return {
    rec, log, track, doc,
    mr: () => current,
    tick: ms => { clock += ms; },
    hide: () => { doc.visibilityState = 'hidden'; return listeners.visibilitychange(); },
    show: () => { doc.visibilityState = 'visible'; return listeners.visibilitychange(); },
  };
}

test('chunks are delivered with increasing seq at 32 kbps / 5 s slices', async () => {
  const s = setup();
  await s.rec.start(0);
  s.mr().emit('a'); s.mr().emit('b');
  assert.deepEqual(s.log.chunks.map(c => c.seq), [0, 1]);
  assert.equal(s.log.opts.mimeType, 'audio/mp4');
  assert.equal(s.log.opts.audioBitsPerSecond, 32000);
  assert.equal(s.log.timeslice, 5000);
});

test('falls back to webm when mp4 unsupported', async () => {
  const s = setup({ mp4: false });
  await s.rec.start(0);
  assert.equal(s.log.opts.mimeType, 'audio/webm');
});

test('stop ends part with duration excluding paused time', async () => {
  const s = setup();
  await s.rec.start(0);
  s.tick(10000); s.rec.pause(); s.tick(5000); s.rec.resume(); s.tick(2000);
  await s.rec.stop();
  assert.equal(s.log.parts.length, 1);
  assert.equal(s.log.parts[0].duration, 12);
  assert.equal(s.log.parts[0].startOffset, 0);
  assert.equal(s.log.chunks.at(-1).seq, 0);
  assert.ok(s.track.stopped);
  assert.equal(s.rec.state, 'idle');
});

test('going hidden mid-recording ends the part and sets interrupted', async () => {
  const s = setup();
  await s.rec.start(0);
  s.mr().emit('a');
  s.tick(30000);
  await s.hide();
  assert.equal(s.rec.state, 'interrupted');
  assert.equal(s.log.interrupted, 1);
  assert.equal(s.log.parts[0].duration, 30);
  assert.deepEqual(s.log.chunks.map(c => c.seq), [0, 1]);
});

test('start after interrupt creates a new part with the given offset', async () => {
  const s = setup();
  await s.rec.start(0);
  s.tick(30000);
  await s.hide(); await s.show();
  await s.rec.start(30);
  s.tick(5000);
  await s.rec.stop();
  assert.equal(s.log.parts.length, 2);
  assert.notEqual(s.log.parts[0].id, s.log.parts[1].id);
  assert.equal(s.log.parts[1].startOffset, 30);
  assert.equal(s.log.parts[1].duration, 5);
});

test('elapsed counts meeting time from the part offset', async () => {
  const s = setup();
  await s.rec.start(30);
  s.tick(4000);
  assert.equal(s.rec.elapsed(), 34);
});

test('wake lock requested on start, re-requested on visible, released on stop', async () => {
  const s = setup();
  await s.rec.start(0);
  assert.deepEqual(s.log.locks, ['screen']);
  await s.show();
  assert.equal(s.log.locks.length, 2);
  await s.rec.stop();
  assert.ok(s.log.released >= 1);
});

test('exposes the current part id and mime type while recording', async () => {
  const s = setup();
  assert.equal(s.rec.currentPartId, null);
  await s.rec.start(0);
  assert.match(s.rec.currentPartId, /^[0-9a-f-]{36}$/);
  assert.equal(s.rec.currentMimeType, 'audio/mp4');
  s.mr().emit('a');
  assert.equal(s.log.chunks[0].partId, s.rec.currentPartId);
});

test('hasWakeLock is false when the wake lock is unavailable', async () => {
  const s = setup();
  await s.rec.start(0);
  assert.equal(s.rec.hasWakeLock, true);
  const r2 = createRecorder({
    getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }),
    MediaRecorder: s.mr().constructor, wakeLock: undefined, doc: s.doc,
    onChunk: async () => {}, onPartEnd: () => {},
  });
  await r2.start(0);
  assert.equal(r2.hasWakeLock, false);
});

test('a failed chunk save is reported through onError', async () => {
  const errors = [];
  const s = setup();
  const r = createRecorder({
    getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }),
    MediaRecorder: s.mr()?.constructor || (await (async () => { await s.rec.start(0); return s.mr().constructor; })()),
    doc: s.doc, onChunk: async () => { throw new Error('QuotaExceededError'); },
    onPartEnd: () => {}, onError: e => errors.push(e.message),
  });
  await r.start(0);
  s.mr().emit('a');
  await new Promise(res => setTimeout(res, 0));
  assert.deepEqual(errors, ['QuotaExceededError']);
});

test('exposes the live mic stream while recording (for the waveform)', async () => {
  const s = setup();
  assert.equal(s.rec.stream, null);
  await s.rec.start(0);
  assert.ok(s.rec.stream && typeof s.rec.stream.getTracks === 'function');
  await s.rec.stop();
  assert.equal(s.rec.stream, null);
});
