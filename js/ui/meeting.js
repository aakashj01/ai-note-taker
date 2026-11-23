import { getMeeting, saveMeeting, deleteMeeting } from '../db.js';
import { formatTime, displaySpeaker, sectionText, toChatText, audioFileName } from '../notes.js';
import { getPartBlob } from '../db.js';
import { shareOrDownload } from '../backup.js';
import { processMeeting, regenerateNotes, isRunning, onJobChange, jobStatus, NO_KEY } from '../process.js';
import { h, header, icon, toast, copyText, formatDate, meetingDuration } from './dom.js';
import { createPlayer } from './player.js';
import { MEETING_TYPES } from '../prompt.js';

export async function renderMeeting(root, id) {
  let m = await getMeeting(id);
  if (!m) { location.hash = '#/'; return; }
  const player = createPlayer(m);
  const body = h('main', { class: 'page' });
  const shareSlot = h('span', {});
  let transcriptOpen = false, highlightAt = null;

  const save = () => saveMeeting(m).catch(e => toast('Could not save: ' + e.message));

  async function make(fn) {
    const firstTime = !m.notes;
    draw();
    m = await fn(id);
    if (m.status === 'ready' && firstTime && !m.error && Object.keys(m.speakers || {}).length) {
      location.hash = `#/m/${id}/speakers`;
      return;
    }
    draw();
  }

  function showSource(t) {
    transcriptOpen = true; highlightAt = t;
    draw();
    const seg = body.querySelector('.seg.hl');
    seg?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    player.playFrom(t);
  }

  const sourceBtn = t => h('button', { class: 'src-btn', 'aria-label': 'Show source', title: `Hear it at ${formatTime(t)}`, onclick: () => showSource(t) }, icon('waveform', 20));
  const section = (head, ...kids) => h('section', { class: 'section' }, head ? h('h2', { class: 'section-head' }, head) : null, kids);
  // Section with a Copy button that copies just that part, formatted for WhatsApp/chat.
  const copySection = (head, which, ...kids) => h('section', { class: 'section' },
    h('div', { class: 'section-bar' },
      h('h2', { class: 'section-head' }, head),
      h('button', {
        class: 'copy-btn', 'aria-label': `Copy ${head.toLowerCase()}`,
        onclick: async () => toast(await copyText(sectionText(m, which)) ? `${head} copied` : 'Could not copy'),
      }, icon('copy', 16), 'Copy')),
    kids);

  function notesView() {
    const n = m.notes;
    return [
      n.highlights?.length ? copySection('Marked moments', 'highlights',
        h('ul', { class: 'group' }, n.highlights.map(x => h('li', { class: 'cell idea', style: '--inset:16px' },
          h('button', { class: 'seg-time', onclick: () => showSource(x.time), 'aria-label': `Play from ${formatTime(x.time)}` }, icon('play', 12), formatTime(x.time)),
          h('div', { class: 'cell-main' }, x.text))))) : null,
      copySection('Summary', 'summary', h('p', { class: 'summary' }, n.summary || 'No summary.')),
      copySection('To-dos', 'todos', n.todos.length
        ? h('ul', { class: 'group' }, n.todos.map(t => h('li', { class: 'cell todo' + (t.done ? ' done' : '') },
            h('input', { type: 'checkbox', class: 'check', checked: t.done, 'aria-label': `Done: ${t.text}`, onchange: e => { t.done = e.target.checked; save(); draw(); } }),
            h('div', { class: 'cell-main todo-text' },
              t.owner ? h('span', { class: 'todo-owner' }, displaySpeaker(t.owner, m.speakers) + ': ') : null,
              t.text,
              t.due ? h('span', { class: 'todo-due' }, 'Due ' + t.due) : null),
            sourceBtn(t.source))))
        : h('p', { class: 'summary' }, 'No to-dos were mentioned.')),
      copySection('Key ideas', 'ideas', n.keyIdeas.length
        ? h('ul', { class: 'group' }, n.keyIdeas.map(k => h('li', { class: 'cell idea' },
            h('span', { class: 'dot' }), h('div', { class: 'cell-main' }, k.text), sourceBtn(k.source))))
        : h('p', { class: 'summary' }, 'No key ideas found.')),
      ...(n.extraSections || []).map((sec, i) => copySection(displaySpeaker(sec.title, m.speakers), `extra:${i}`,
        sec.items.length
          ? h('ul', { class: 'group' }, sec.items.map(item => h('li', { class: 'cell idea' }, h('span', { class: 'dot' }), h('div', { class: 'cell-main' }, item))))
          : h('p', { class: 'summary' }, 'Nothing for this one.'))),
      section('Speakers', h('ul', { class: 'group' }, h('li', {},
        h('a', { class: 'cell', href: `#/m/${id}/speakers` },
          h('span', { style: 'color: var(--tint)' }, icon('people', 22)),
          h('div', { class: 'cell-main' }, 'Name speakers'),
          h('div', { class: 'cell-trail' }, Object.values(m.speakers || {}).filter(Boolean).join(', ') || `${Object.keys(m.speakers || {}).length} voices`, icon('chevron', 16)))))),
    ];
  }

  function transcriptView() {
    const segs = m.transcript || [];
    let hlIndex = -1;
    if (highlightAt != null) segs.forEach((s, i) => { if (s.start <= highlightAt + 0.5) hlIndex = i; });
    return section('Transcript',
      h('details', { class: 'transcript', open: transcriptOpen, ontoggle: e => { transcriptOpen = e.target.open; } },
        h('summary', {}, h('span', {}, `${segs.length} lines`), icon('chevron', 16)),
        segs.map((s, i) => h('div', { class: 'seg' + (i === hlIndex ? ' hl' : '') },
          h('div', { class: 'seg-head' },
            h('button', { class: 'seg-time', onclick: () => player.playFrom(s.start), 'aria-label': `Play from ${formatTime(s.start)}` }, icon('play', 12), formatTime(s.start)),
            h('span', { class: 'seg-speaker' }, displaySpeaker(s.speaker, m.speakers))),
          h('div', {
            class: 'seg-text', contentEditable: 'plaintext-only', spellcheck: false,
            onblur: e => { const v = e.target.textContent.trim(); if (v !== s.text) { s.text = v; m.edited = true; save(); toast('Saved. Tap Regenerate notes to update them.'); } },
          }, s.text)))),
      h('p', { class: 'section-foot' }, 'Tap any line to correct it.'));
  }

  function draw() {
    const running = isRunning(id) || m.status === 'processing';
    const gaps = (m.parts || []).length > 1;
    const title = h('input', {
      class: 'title-input', value: m.title, 'aria-label': 'Meeting title',
      onchange: e => { m.title = e.target.value.trim() || m.title; save(); },
    });
    shareSlot.replaceChildren(m.notes ? h('button', { class: 'nav-btn', 'aria-label': 'Share', onclick: share }, icon('share', 22)) : '');

    body.replaceChildren(...[
      title,
      h('p', { class: 'meta' }, `${formatDate(m.createdAt)}, ${formatTime(meetingDuration(m))} long`,
        gaps ? `, recorded in ${m.parts.length} parts (interrupted at ${m.parts.slice(1).map(p => formatTime(p.startOffset)).join(', ')})` : '',
        m.bookmarks?.length && !m.notes?.highlights?.length ? h('span', { class: 'meta-marks' }, icon('flag', 14), m.bookmarks.length === 1 ? '1 marked moment' : `${m.bookmarks.length} marked moments`) : null),
      h('div', { class: 'segmented type-picker', role: 'radiogroup', 'aria-label': 'Meeting type' },
        Object.entries(MEETING_TYPES).map(([value, t]) => h('label', {},
          h('input', { type: 'radio', name: 'mtype', value, checked: (m.type || 'general') === value, disabled: running,
            onchange: () => { m.type = value; save(); if (m.notes) toast('Tap Regenerate notes to use this meeting type'); } }),
          t.label))),
      m.error ? h('div', { class: 'banner warn', role: 'alert' }, h('div', {}, m.error === NO_KEY ? [NO_KEY, '. ', h('a', { href: '#/settings' }, 'Open Settings')] : m.error)) : null,
      running ? h('div', { class: 'banner working' }, h('div', { class: 'spinner' }), h('div', {}, jobStatus(id) || 'Making notes. This can take a minute or two for long meetings, so keep the app open.')) : null,
      m.notice ? h('div', { class: 'banner warn' }, m.notice) : null,
      !running && !m.notes ? section(null,
        h('button', { class: 'btn btn-filled btn-block', onclick: () => make(processMeeting) }, icon('sparkle', 20), 'Make notes'),
        h('a', { class: 'btn btn-plain btn-block', href: `#/record/${id}` }, 'Continue recording this meeting')) : null,
      m.notes ? notesView() : null,
      m.transcript?.length ? transcriptView() : null,
      m.notes ? section('Something wrong?',
        h('ul', { class: 'group' }, h('li', { class: 'cell' },
          h('textarea', { class: 'field', rows: 3, 'aria-label': 'Context for the AI', placeholder: 'Add context, like "we meant the Q3 budget"', value: m.context || '', oninput: e => { m.context = e.target.value; }, onchange: save }))),
        h('ul', { class: 'group', style: 'margin-top: 12px' },
          h('li', {}, h('button', { class: 'cell action', disabled: running, onclick: async () => { await save(); make(regenerateNotes); } }, 'Regenerate notes')),
          h('li', {}, h('button', { class: 'cell action', disabled: running, onclick: async () => { await save(); make(processMeeting); } }, 'Re-listen to the audio'))),
        h('p', { class: 'section-foot' }, 'Regenerate uses your corrected transcript. Re-listen starts again from the recording.')) : null,
      recordingSection(),
      section(null, h('ul', { class: 'group' }, h('li', {}, h('button', { class: 'cell action destructive', onclick: remove }, 'Delete meeting')))),
    ].flat(Infinity).filter(Boolean));
  }

  // Save the audio to Files / AirDrop / WhatsApp via the share sheet (download elsewhere).
  const prepared = new Map();
  async function downloadPart(i, btn) {
    const p = m.parts[i];
    let file = prepared.get(i);
    if (!file) {
      const blob = await getPartBlob(p.id, p.mimeType);
      if (!blob.size) { toast('This recording isn’t on this phone'); return; }
      file = new File([blob], audioFileName(m, i), { type: (p.mimeType || 'audio/mp4').split(';')[0] });
    }
    const download = f => {
      const a = h('a', { href: URL.createObjectURL(f), download: f.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    };
    try {
      const how = await shareOrDownload(file, { canShare: f => navigator.canShare?.(f), share: navigator.share && (d => navigator.share(d)), download });
      if (how === 'needs-tap') { prepared.set(i, file); btn.textContent = 'Ready. Tap again to save'; return; }
      prepared.delete(i);
      if (how === 'downloaded') toast('Recording downloaded');
    } catch (e) {
      if (e.name !== 'AbortError') toast('Could not save the recording: ' + e.message);
    }
  }

  function recordingSection() {
    const parts = m.parts || [];
    if (!parts.length) return null;
    if (m.audioMissing) return section('Recording', h('p', { class: 'summary' }, 'The recording isn’t on this phone. It was restored from a backup without recordings.'));
    const many = parts.length > 1;
    return section('Recording',
      h('ul', { class: 'group' }, parts.map((p, i) => h('li', {},
        h('button', {
          class: 'cell action', 'aria-label': many ? `Download recording part ${i + 1}` : 'Download recording',
          onclick: e => downloadPart(i, e.currentTarget),
        }, icon('import', 20), many ? ` Download part ${i + 1} (from ${formatTime(p.startOffset)})` : ' Download recording')))),
      h('p', { class: 'section-foot' }, many
        ? 'This recording was interrupted, so it’s saved in parts. Choose Save to Files to keep a copy.'
        : 'Choose Save to Files to keep a copy, or send it with AirDrop or WhatsApp.'));
  }

  async function share() {
    const text = toChatText(m);
    try {
      if (navigator.share) await navigator.share({ text });
      else toast(await copyText(text) ? 'All notes copied' : 'Could not copy');
    } catch (e) {
      if (e.name !== 'AbortError') toast(await copyText(text) ? 'All notes copied' : 'Could not share');
    }
  }

  async function remove() {
    if (!confirm('Delete this meeting and its recording? This cannot be undone.')) return;
    await deleteMeeting(id);
    location.hash = '#/';
  }

  const off = onJobChange(async jid => { if (jid === id) { m = await getMeeting(id); draw(); } });

  root.append(header('', { back: '#/', backLabel: 'Meetings', actions: [shareSlot] }), body);
  draw();
  return () => { off(); player.dispose(); };
}
