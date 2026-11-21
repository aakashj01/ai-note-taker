import { getMeeting, saveMeeting, deleteMeeting } from '../db.js';
import { formatTime, displaySpeaker, toMarkdown } from '../notes.js';
import { processMeeting, regenerateNotes, isRunning, onJobChange, NO_KEY } from '../process.js';
import { h, header, toast, formatDate, meetingDuration } from './dom.js';
import { createPlayer } from './player.js';

export async function renderMeeting(root, id) {
  let m = await getMeeting(id);
  if (!m) { location.hash = '#/'; return; }
  const player = createPlayer(m);
  const body = h('section', { class: 'content' });
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

  const sourceBtn = t => h('button', { class: 'src-btn', 'aria-label': 'Show source', title: `Hear it at ${formatTime(t)}`, onclick: () => showSource(t) }, '↗');

  function notesView() {
    const n = m.notes;
    return [
      h('h2', {}, 'Summary'),
      h('p', { class: 'summary' }, n.summary || '—'),
      h('h2', {}, 'To-dos'),
      n.todos.length ? h('ul', { class: 'todos' }, n.todos.map(t => h('li', { class: 'todo' + (t.done ? ' done' : '') },
        h('label', { class: 'todo-main' },
          h('input', { type: 'checkbox', checked: t.done, onchange: e => { t.done = e.target.checked; save(); draw(); } }),
          h('span', {},
            t.owner ? h('strong', { class: 'owner' }, displaySpeaker(t.owner, m.speakers) + ': ') : null,
            t.text,
            t.due ? h('span', { class: 'due' }, ' · ' + t.due) : null)),
        sourceBtn(t.source)))) : h('p', { class: 'muted' }, 'No to-dos were mentioned.'),
      h('h2', {}, 'Key ideas'),
      n.keyIdeas.length ? h('ul', { class: 'ideas' }, n.keyIdeas.map(k => h('li', {}, h('span', {}, k.text), sourceBtn(k.source))))
        : h('p', { class: 'muted' }, 'No key ideas found.'),
    ];
  }

  function transcriptView() {
    const segs = m.transcript || [];
    let hlIndex = -1;
    if (highlightAt != null) segs.forEach((s, i) => { if (s.start <= highlightAt + 0.5) hlIndex = i; });
    return h('details', { class: 'transcript', open: transcriptOpen, ontoggle: e => { transcriptOpen = e.target.open; } },
      h('summary', {}, `Transcript (${segs.length} lines) — tap text to correct it`),
      segs.map((s, i) => h('div', { class: 'seg' + (i === hlIndex ? ' hl' : '') },
        h('button', { class: 'seg-time', onclick: () => player.playFrom(s.start), 'aria-label': `Play from ${formatTime(s.start)}` }, '▶ ' + formatTime(s.start)),
        h('span', { class: 'seg-speaker' }, displaySpeaker(s.speaker, m.speakers)),
        h('div', {
          class: 'seg-text', contentEditable: 'plaintext-only', spellcheck: false,
          onblur: e => { const v = e.target.textContent.trim(); if (v !== s.text) { s.text = v; m.edited = true; save(); toast('Saved. Tap "Regenerate notes" to update the notes.'); } },
        }, s.text))));
  }

  function draw() {
    const running = isRunning(id) || m.status === 'processing';
    const gaps = (m.parts || []).length > 1;
    const title = h('input', {
      class: 'title-input', value: m.title, 'aria-label': 'Meeting title',
      onchange: e => { m.title = e.target.value.trim() || m.title; save(); },
    });

    body.replaceChildren(...[
      title,
      h('p', { class: 'muted meta' }, `${formatDate(m.createdAt)} · ${formatTime(meetingDuration(m))}`,
        gaps ? ` · recorded in ${m.parts.length} parts (interrupted at ${m.parts.slice(1).map(p => formatTime(p.startOffset)).join(', ')})` : ''),
      m.error ? h('div', { class: 'alert' }, m.error === NO_KEY ? [NO_KEY, ' ', h('a', { href: '#/settings' }, 'Open Settings')] : m.error) : null,
      running ? h('div', { class: 'working' }, h('div', { class: 'spinner' }), h('p', {}, 'Making notes… this can take a minute for long meetings. You can leave this screen.')) : null,
      !running && !m.notes ? h('button', { class: 'btn btn-primary btn-big', onclick: () => make(processMeeting) }, 'Make notes') : null,
      m.notes ? notesView() : null,
      m.notes ? h('div', { class: 'row' },
        h('button', { class: 'btn btn-secondary', onclick: share }, 'Share'),
        h('a', { class: 'btn btn-secondary', href: `#/m/${id}/speakers`, role: 'link' }, 'Name speakers')) : null,
      m.transcript?.length ? transcriptView() : null,
      m.notes ? h('div', { class: 'fix' },
        h('h2', {}, 'Something wrong?'),
        h('p', { class: 'muted' }, 'Correct the transcript above, or add context here (e.g. "we meant the Q3 budget"), then regenerate.'),
        h('textarea', { rows: 3, 'aria-label': 'Context for the AI', placeholder: 'Add context…', value: m.context || '', oninput: e => { m.context = e.target.value; }, onchange: save }),
        h('div', { class: 'row' },
          h('button', { class: 'btn btn-secondary', disabled: running, onclick: async () => { await save(); make(regenerateNotes); } }, 'Regenerate notes'),
          h('button', { class: 'btn btn-ghost', disabled: running, onclick: async () => { await save(); make(processMeeting); } }, 'Re-listen to audio'))) : null,
      h('button', { class: 'btn btn-ghost danger', onclick: remove }, 'Delete meeting'),
    ].flat(Infinity).filter(Boolean));
  }

  async function share() {
    const text = toMarkdown(m);
    try {
      if (navigator.share) await navigator.share({ title: m.title, text });
      else { await navigator.clipboard.writeText(text); toast('Notes copied'); }
    } catch (e) {
      if (e.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('Notes copied'); } catch { toast('Could not share'); } }
    }
  }

  async function remove() {
    if (!confirm('Delete this meeting and its recording? This cannot be undone.')) return;
    await deleteMeeting(id);
    location.hash = '#/';
  }

  const off = onJobChange(async jid => { if (jid === id) { m = await getMeeting(id); draw(); } });

  root.append(header('Meeting', { back: '#/' }), body);
  draw();
  return () => { off(); player.dispose(); };
}
