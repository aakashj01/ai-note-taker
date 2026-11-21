import { listMeetings, saveMeeting, appendChunk } from '../db.js';
import { formatTime } from '../notes.js';
import { recoverStuck } from '../process.js';
import { h, header, icon, toast, dayGroup, meetingDuration } from './dom.js';

const STATUS = {
  recording: ['Recording', 'attention'], recorded: ['Notes not made yet', ''], processing: ['Making notes…', ''],
  ready: ['', ''], failed: ['Needs another try', 'attention'],
};

function audioDuration(file) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = d => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => finish(a.duration);
    a.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
    a.src = url;
  });
}

async function importFile(file) {
  const partId = crypto.randomUUID();
  const mimeType = file.type || 'audio/mp4';
  await appendChunk(partId, 0, file);
  const m = {
    id: crypto.randomUUID(),
    title: file.name.replace(/\.[^.]+$/, '') || 'Imported meeting',
    createdAt: file.lastModified || Date.now(),
    status: 'recorded', error: null,
    parts: [{ id: partId, mimeType, startOffset: 0, duration: Math.round(await audioDuration(file)) }],
    speakers: {}, context: '', transcript: [], notes: null,
  };
  await saveMeeting(m);
  location.hash = `#/m/${m.id}`;
}

function meetingRow(m) {
  const [label, tone] = STATUS[m.status] || [m.status, ''];
  const time = new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return h('li', {},
    h('a', { class: 'cell meeting-card', href: `#/m/${m.id}` },
      h('div', { class: 'cell-main' },
        h('div', { class: 'cell-title' }, m.title),
        m.notes?.summary
          ? h('div', { class: 'cell-sub clamp' }, m.notes.summary)
          : h('div', { class: 'cell-sub' }, h('span', { class: `badge ${tone}` }, label || time))),
      h('div', { class: 'cell-trail' }, formatTime(meetingDuration(m)), icon('chevron', 16))));
}

export async function renderLibrary(root) {
  const meetings = await listMeetings();
  await recoverStuck(meetings);

  const fileInput = h('input', {
    type: 'file', accept: 'audio/*,.m4a,.mp3,.wav,.aac', class: 'visually-hidden', id: 'import-file',
    onchange: async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      toast('Importing…');
      try { await importFile(f); } catch (err) { toast('Import failed: ' + err.message); }
    },
  });

  const groups = new Map();
  for (const m of meetings) {
    const g = dayGroup(m.createdAt);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(m);
  }

  const body = meetings.length
    ? [...groups].map(([name, list]) => h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, name),
        h('ul', { class: 'group' }, list.map(meetingRow))))
    : h('div', { class: 'empty' },
        icon('waveform', 56),
        h('h2', {}, 'No meetings yet'),
        h('p', {}, 'Tap the red button when your meeting starts. If you need to lock your phone, record in Voice Memos and import the file.'));

  root.append(
    header('Meetings', { large: true, actions: [h('a', { href: '#/settings', class: 'nav-btn', 'aria-label': 'Settings' }, icon('gear', 24))] }),
    h('main', { class: 'page' }, body),
    fileInput,
    h('nav', { class: 'toolbar', 'aria-label': 'Actions' },
      h('label', { for: 'import-file', class: 'toolbar-btn', role: 'button' }, icon('import', 22), 'Import'),
      h('a', { href: '#/record', class: 'rec-btn', role: 'button', 'aria-label': 'Record' }),
      h('span', {})),
  );
}
