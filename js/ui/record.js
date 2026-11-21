import { saveMeeting, appendChunk } from '../db.js';
import { createRecorder } from '../recorder.js';
import { formatTime } from '../notes.js';
import { recoverStuck } from '../process.js';
import { h, header, toast } from './dom.js';

export async function renderRecord(root) {
  let meeting = null;
  let saving = Promise.resolve();
  const persist = () => { const m = meeting; saving = saving.then(() => saveMeeting(m)).catch(e => toast('Could not save: ' + e.message)); return saving; };

  const timer = h('div', { class: 'timer', 'aria-label': 'Recording time' }, '0:00');
  const status = h('p', { class: 'rec-status muted' }, 'Keep this screen open while recording. The screen will stay on.');
  const controls = h('div', { class: 'rec-controls' });
  const dot = h('div', { class: 'rec-dot' });

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
      status.textContent = 'Recording paused because the app was closed or the phone was locked. Everything so far is saved.';
      status.className = 'rec-status warn';
      draw();
    },
  });

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
      }
      const offset = meeting.parts.reduce((n, p) => Math.max(n, p.startOffset + p.duration), 0);
      await rec.start(offset);
      status.textContent = 'Keep this screen open while recording. The screen will stay on.';
      status.className = 'rec-status muted';
      meeting.status = 'recording';
      draw();
      // Save the part straight away, so even a crash keeps a playable record of it.
      const id = rec.currentPartId;
      if (id && !meeting.parts.some(p => p.id === id)) meeting.parts.push({ id, mimeType: rec.currentMimeType, startOffset: offset, duration: 0 });
      await persist();
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in Settings › Safari › Microphone.' : 'Could not start recording: ' + e.message);
      draw();
    }
  }

  async function finish() {
    await rec.stop();
    meeting.status = 'recorded';
    await persist();
    recoverStuck.activeRecording.delete(meeting.id);
    location.hash = `#/m/${meeting.id}`;
  }

  function draw() {
    const s = rec.state;
    dot.className = 'rec-dot' + (s === 'recording' ? ' on' : '');
    const btn = (label, cls, fn) => h('button', { class: `btn ${cls}`, onclick: fn }, label);
    controls.replaceChildren(...(
      s === 'idle' ? [btn('Start recording', 'btn-primary btn-big', begin)]
      : s === 'recording' ? [btn('Pause', 'btn-secondary', () => { rec.pause(); draw(); }), btn('Stop', 'btn-danger', finish)]
      : s === 'paused' ? [btn('Resume', 'btn-primary', () => { rec.resume(); draw(); }), btn('Stop', 'btn-danger', finish)]
      : s === 'interrupted' ? [btn('Continue recording', 'btn-primary btn-big', begin), btn('Stop', 'btn-danger', finish)]
      : []));
  }

  const tick = setInterval(() => { timer.textContent = formatTime(rec.elapsed()); }, 500);

  root.append(
    header('Record', { back: '#/' }),
    h('section', { class: 'content record' }, dot, timer, status, controls),
  );
  draw();

  return async () => {
    clearInterval(tick);
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
