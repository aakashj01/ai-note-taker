import { getMeeting, saveMeeting } from '../db.js';
import { h, header } from './dom.js';
import { createPlayer } from './player.js';

export async function renderSpeakers(root, id) {
  const m = await getMeeting(id);
  if (!m) { location.hash = '#/'; return; }
  const player = createPlayer(m);
  const labels = Object.keys(m.speakers || {});
  const inputs = {};

  const rows = labels.map(label => {
    const sample = (m.transcript || []).find(s => s.speaker === label);
    inputs[label] = h('input', { type: 'text', value: m.speakers[label] || '', placeholder: label, 'aria-label': `Name for ${label}`, autocomplete: 'off' });
    return h('li', { class: 'speaker' },
      h('div', { class: 'speaker-head' },
        h('strong', {}, label),
        sample ? h('button', { class: 'btn btn-ghost small', onclick: () => player.playFrom(sample.start), 'aria-label': `Play ${label}` }, '▶ Play') : null),
      sample ? h('p', { class: 'muted sample' }, `“${sample.text.slice(0, 120)}${sample.text.length > 120 ? '…' : ''}”`) : null,
      inputs[label]);
  });

  async function saveNames() {
    for (const l of labels) m.speakers[l] = inputs[l].value.trim();
    await saveMeeting(m);
    location.hash = `#/m/${id}`;
  }

  root.append(
    header('Who spoke?', { back: `#/m/${id}` }),
    h('section', { class: 'content' },
      h('p', { class: 'muted' }, 'Give each voice a name so the notes and to-dos use it. Leave blank to keep the label.'),
      labels.length ? h('ul', { class: 'speakers' }, rows) : h('p', {}, 'No speakers found.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: saveNames }, 'Save names')),
  );
  return () => player.dispose();
}
