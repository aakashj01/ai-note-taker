import { saveMeeting, appendChunk, getMeeting, listMeetings } from '../db.js';
import { createRecorder } from '../recorder.js';
import { formatTime } from '../notes.js';
import { recoverStuck } from '../process.js';
import { h, header, icon, toast } from './dom.js';

const KEEP_ON = 'Keep this screen open. It will stay on while you record.';
const NO_LOCK = 'Your phone may lock itself and stop the recording. Set Settings › Display & Brightness › Auto-Lock to Never, or record in Voice Memos and import.';

const offsetOf = m => m.parts.reduce((n, p) => Math.max(n, p.startOffset + p.duration), 0);

// A meeting left "recording" by a page that iOS threw away in the background.
async function findCutOff() {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  return (await listMeetings()).find(m => m.status === 'recording' && m.createdAt > cutoff
    && !recoverStuck.activeRecording.has(m.id) && m.parts.length);
}

// Voice Memos-style scrolling level meter. Also proof the mic is really hearing the room.
function createWave(canvas) {
  const levels = [];
  let ctx = null, analyser = null, raf = 0, data = null;
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = hgt * dpr; }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const step = 5, bar = 3, mid = hgt / 2, n = Math.floor(w / step);
    g.fillStyle = css('--label-3');
    for (let i = 0; i < n; i++) g.fillRect(i * step, mid - 0.5, bar, 1);
    g.fillStyle = css('--red');
    const shown = levels.slice(-n);
    shown.forEach((lv, i) => {
      const x = w - (shown.length - i) * step;
      const bh = Math.max(2, Math.min(hgt, lv * hgt * 2.6));
      g.beginPath();
      g.roundRect ? g.roundRect(x, mid - bh / 2, bar, bh, 1.5) : g.rect(x, mid - bh / 2, bar, bh);
      g.fill();
    });
  }

  let last = 0;
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (!analyser || t - last < 50) return;
    last = t;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
    levels.push(Math.sqrt(sum / data.length));
    if (levels.length > 600) levels.splice(0, levels.length - 600);
    draw();
  }

  return {
    draw,
    start(stream) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        data = new Uint8Array(analyser.fftSize);
        ctx.createMediaStreamSource(stream).connect(analyser);
        raf = requestAnimationFrame(loop);
      } catch { /* the meter is a nice-to-have */ }
    },
    stop() {
      cancelAnimationFrame(raf);
      analyser = null;
      ctx?.close().catch(() => {});
      ctx = null;
      draw();
    },
  };
}

export async function renderRecord(root, continueId) {
  let meeting = null;
  let saving = Promise.resolve();
  const persist = () => { const m = meeting; saving = saving.then(() => saveMeeting(m)).catch(e => toast('Could not save: ' + e.message)); return saving; };

  const titleEl = h('p', { class: 'rec-title' }, 'New recording');
  const timer = h('div', { class: 'timer', role: 'timer', 'aria-label': 'Recording time' }, '0:00');
  const canvas = h('canvas', { class: 'wave', 'aria-hidden': 'true' });
  const wave = createWave(canvas);
  const status = h('p', { class: 'rec-note' }, KEEP_ON);
  const actions = h('div', { class: 'rec-actions' });
  const extra = h('div', { class: 'rec-extra' });
  const note = (text, isWarn = false) => { status.textContent = text; status.className = 'rec-note' + (isWarn ? ' warn' : ''); };

  const rec = createRecorder({
    getUserMedia: c => navigator.mediaDevices.getUserMedia(c),
    MediaRecorder: window.MediaRecorder,
    wakeLock: navigator.wakeLock,
    doc: document,
    onChunk: async (partId, seq, blob) => {
      await appendChunk(partId, seq, blob);
      const p = meeting.parts.find(x => x.id === partId);
      if (p) { p.duration = Math.max(0, Math.round(rec.elapsed() - p.startOffset)); persist(); }
    },
    onPartEnd: part => {
      const i = meeting.parts.findIndex(x => x.id === part.id);
      if (i >= 0) meeting.parts[i] = part; else meeting.parts.push(part);
      persist();
    },
    onInterrupted: () => {
      wave.stop();
      note('Recording paused because the app was closed, the phone locked, or a call took the microphone. Everything so far is saved.', true);
      draw();
    },
    onError: async err => {
      toast('Could not save audio: ' + (err?.message || err));
      note('Saving audio failed. Is the phone storage full? Recording stopped and what was saved so far is kept.', true);
      wave.stop();
      await rec.stop();
      draw();
    },
  });

  function adopt(m) {
    meeting = m;
    recoverStuck.activeRecording.add(m.id);
    titleEl.textContent = m.title;
    timer.textContent = formatTime(offsetOf(m));
    note(`This recording was cut off at ${formatTime(offsetOf(m))}. Continue to keep it in the same meeting.`, true);
  }

  async function begin() {
    try {
      if (!meeting) {
        meeting = {
          id: crypto.randomUUID(),
          title: 'Meeting ' + new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
          createdAt: Date.now(), status: 'recording', error: null,
          parts: [], speakers: {}, context: '', transcript: [], notes: null,
        };
        recoverStuck.activeRecording.add(meeting.id);
        titleEl.textContent = meeting.title;
      }
      const offset = offsetOf(meeting);
      await rec.start(offset);
      if (rec.stream) wave.start(rec.stream);
      if (rec.hasWakeLock) note(KEEP_ON); else note(NO_LOCK, true);
      meeting.status = 'recording';
      draw();
      // Save the part straight away, so even a crash keeps a playable record of it.
      const id = rec.currentPartId;
      if (id && !meeting.parts.some(p => p.id === id)) meeting.parts.push({ id, mimeType: rec.currentMimeType, startOffset: offset, duration: 0 });
      await persist();
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Microphone access is off. Allow it for this site in Safari settings.' : 'Could not start recording: ' + e.message);
      draw();
    }
  }

  async function finish() {
    wave.stop();
    await rec.stop();
    meeting.status = 'recorded';
    await persist();
    recoverStuck.activeRecording.delete(meeting.id);
    location.hash = `#/m/${meeting.id}`;
  }

  function mark() {
    const t = Math.round(rec.elapsed());
    meeting.bookmarks = [...(meeting.bookmarks || []), t];
    persist();
    navigator.vibrate?.(15);
    toast(`Marked ${formatTime(t)}`);
    draw();
  }

  function startOver() {
    recoverStuck.activeRecording.delete(meeting.id);
    meeting.status = 'recorded';
    persist();
    meeting = null;
    titleEl.textContent = 'New recording';
    timer.textContent = '0:00';
    note(KEEP_ON);
    draw();
  }

  function draw() {
    const s = rec.state;
    const live = s === 'recording' || s === 'paused';
    const resumable = (s === 'idle' && meeting?.parts.length) || s === 'interrupted';
    const main = live
      ? h('button', { class: 'rec-btn big stop', 'aria-label': 'Stop', onclick: finish })
      : h('button', { class: 'rec-btn big', 'aria-label': resumable ? 'Continue recording' : 'Start recording', onclick: begin });
    const pauseBtn = s === 'recording'
      ? h('button', { class: 'round-btn', 'aria-label': 'Pause', onclick: () => { rec.pause(); draw(); } }, icon('pause', 22))
      : s === 'paused'
        ? h('button', { class: 'round-btn', 'aria-label': 'Resume', onclick: () => { rec.resume(); draw(); } }, icon('play', 22))
        : null;
    const marks = meeting?.bookmarks?.length || 0;
    const markBtn = live
      ? h('button', { class: 'round-btn mark-btn', 'aria-label': 'Mark this moment', onclick: mark },
          icon('flag', 22), marks ? h('span', { class: 'mark-count', 'aria-hidden': 'true' }, String(marks)) : null)
      : null;
    actions.replaceChildren(h('div', { class: 'side' }, markBtn), main, h('div', { class: 'side' }, pauseBtn));
    extra.replaceChildren(...[
      resumable ? h('button', { class: 'btn btn-tinted btn-block', onclick: finish }, 'Finish and save') : null,
      resumable && s === 'idle' && !continueId ? h('button', { class: 'btn btn-plain btn-block', onclick: startOver }, 'Start a new recording') : null,
    ].filter(Boolean));
    if (s === 'paused') note('Paused. Tap play to carry on.');
  }

  const tick = setInterval(() => { if (rec.state !== 'idle') timer.textContent = formatTime(rec.elapsed()); }, 250);

  const resume = continueId ? await getMeeting(continueId) : await findCutOff();
  if (resume) adopt(resume);

  root.append(
    header('Record', { back: '#/', backLabel: 'Meetings' }),
    h('main', { class: 'recorder' }, titleEl, timer, canvas, status, actions, extra),
  );
  draw();
  requestAnimationFrame(() => wave.draw());

  return async () => {
    clearInterval(tick);
    wave.stop();
    if (meeting && (rec.state === 'recording' || rec.state === 'paused')) {
      await rec.stop();
      meeting.status = 'recorded';
      await persist();
    } else if (meeting && meeting.status === 'recording') {
      meeting.status = 'recorded';
      await persist();
    }
    if (meeting) recoverStuck.activeRecording.delete(meeting.id);
    rec.dispose();
  };
}
