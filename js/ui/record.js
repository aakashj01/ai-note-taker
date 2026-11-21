import { saveMeeting, appendChunk, getMeeting, listMeetings } from '../db.js';
import { createRecorder } from '../recorder.js';
import { formatTime } from '../notes.js';
import { recoverStuck } from '../process.js';
import { h, header, toast } from './dom.js';

const KEEP_ON = 'Keep this screen open while recording. The screen will stay on.';
const NO_LOCK = 'Your phone may lock itself during the meeting, which stops the recording. Set Settings › Display & Brightness › Auto-Lock to Never, or record in Voice Memos and import.';

const offsetOf = m => m.parts.reduce((n, p) => Math.max(n, p.startOffset + p.duration), 0);

// A meeting left "recording" by a page that iOS threw away in the background.
async function findCutOff() {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  return (await listMeetings()).find(m => m.status === 'recording' && m.createdAt > cutoff
    && !recoverStuck.activeRecording.has(m.id) && m.parts.length);
}

export async function renderRecord(root, continueId) {
  let meeting = null;
  let saving = Promise.resolve();
  const persist = () => { const m = meeting; saving = saving.then(() => saveMeeting(m)).catch(e => toast('Could not save: ' + e.message)); return saving; };

  const timer = h('div', { class: 'timer', 'aria-label': 'Recording time' }, '0:00');
  const status = h('p', { class: 'rec-status muted' }, KEEP_ON);
  const warn = text => { status.textContent = text; status.className = 'rec-status warn'; };
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
      warn('Recording paused: the app was closed, the phone locked, or a call took the microphone. Everything so far is saved.');
      draw();
    },
    onError: async err => {
      toast('Could not save audio: ' + (err?.message || err));
      warn('Saving audio failed (is the phone storage full?). Recording stopped; what was saved so far is kept.');
      await rec.stop();
      draw();
    },
  });

  function adopt(m) {
    meeting = m;
    recoverStuck.activeRecording.add(m.id);
    timer.textContent = formatTime(offsetOf(m));
    warn(`“${m.title}” was cut off at ${formatTime(offsetOf(m))}. Tap Continue recording to carry on in the same meeting.`);
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
      }
      const offset = offsetOf(meeting);
      await rec.start(offset);
      if (rec.hasWakeLock) { status.textContent = KEEP_ON; status.className = 'rec-status muted'; } else warn(NO_LOCK);
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
      s === 'idle' && meeting?.parts.length ? [btn('Continue recording', 'btn-primary btn-big', begin), btn('Finish — make it a meeting', 'btn-secondary', finish),
        ...(continueId ? [] : [btn('Start a new recording', 'btn-ghost', () => { recoverStuck.activeRecording.delete(meeting.id); meeting.status = 'recorded'; persist(); meeting = null; status.textContent = KEEP_ON; status.className = 'rec-status muted'; timer.textContent = '0:00'; draw(); })])]
      : s === 'idle' ? [btn('Start recording', 'btn-primary btn-big', begin)]
      : s === 'recording' ? [btn('Pause', 'btn-secondary', () => { rec.pause(); draw(); }), btn('Stop', 'btn-danger', finish)]
      : s === 'paused' ? [btn('Resume', 'btn-primary', () => { rec.resume(); draw(); }), btn('Stop', 'btn-danger', finish)]
      : s === 'interrupted' ? [btn('Continue recording', 'btn-primary btn-big', begin), btn('Stop', 'btn-danger', finish)]
      : []));
  }

  const tick = setInterval(() => { if (rec.state !== 'idle') timer.textContent = formatTime(rec.elapsed()); }, 500);

  const resume = continueId ? await getMeeting(continueId) : await findCutOff();
  if (resume) adopt(resume);

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
