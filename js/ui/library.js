import { listMeetings, saveMeeting, appendChunk } from '../db.js';
import { formatTime } from '../notes.js';
import { recoverStuck } from '../process.js';
import { h, header, formatDate, meetingDuration, toast } from './dom.js';

const STATUS = { recording: 'Recording', recorded: 'No notes yet', processing: 'Making notes…', ready: 'Notes ready', failed: 'Needs retry' };

function audioDuration(file) {
  return new Promise(resolve => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const finish = d => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
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

  const list = meetings.length
    ? h('ul', { class: 'cards' }, meetings.map(m => h('li', {},
        h('a', { class: 'meeting-card', href: `#/m/${m.id}` },
          h('div', { class: 'card-title' }, m.title),
          h('div', { class: 'card-meta' },
            h('span', {}, formatDate(m.createdAt)), ' · ', h('span', {}, formatTime(meetingDuration(m))),
            h('span', { class: `chip chip-${m.status}` }, STATUS[m.status] || m.status)),
          m.notes?.summary ? h('p', { class: 'card-summary' }, m.notes.summary) : null,
        ))))
    : h('div', { class: 'empty' },
        h('p', {}, 'No meetings yet.'),
        h('p', { class: 'muted' }, 'Tap Record at the start of a meeting. For long meetings where you need to lock the phone, record in Voice Memos and tap Import.'));

  root.append(
    header('Meeting Notes', { actions: [h('a', { href: '#/settings', class: 'icon-btn', 'aria-label': 'Settings' }, '⚙︎')] }),
    h('section', { class: 'content' }, list),
    h('div', { class: 'dock' },
      h('label', { for: 'import-file', class: 'btn btn-secondary', role: 'button' }, 'Import audio'),
      fileInput,
      h('a', { href: '#/record', class: 'btn btn-primary', role: 'button' }, 'Record'),
    ),
  );
}
