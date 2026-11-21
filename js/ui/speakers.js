import { getMeeting, saveMeeting } from '../db.js';
import { h, header, icon } from './dom.js';
import { createPlayer } from './player.js';

export async function renderSpeakers(root, id) {
  const m = await getMeeting(id);
  if (!m) { location.hash = '#/'; return; }
  const player = createPlayer(m);
  const labels = Object.keys(m.speakers || {});
  const inputs = {};

  const groups = labels.map(label => {
    const sample = (m.transcript || []).find(s => s.speaker === label);
    inputs[label] = h('input', { class: 'field', type: 'text', value: m.speakers[label] || '', placeholder: 'Name', 'aria-label': `Name for ${label}`, autocomplete: 'off', autocapitalize: 'words' });
    return h('section', { class: 'section' },
      h('h2', { class: 'section-head' }, label),
      h('ul', { class: 'group' },
        sample ? h('li', { class: 'cell' },
          h('button', { class: 'round-btn', style: 'width:36px;height:36px;color:var(--tint)', onclick: () => player.playFrom(sample.start), 'aria-label': `Play ${label}` }, icon('play', 16)),
          h('div', { class: 'cell-main sample' }, `“${sample.text.slice(0, 140)}${sample.text.length > 140 ? '…' : ''}”`)) : null,
        h('li', { class: 'cell' }, inputs[label])));
  });

  async function saveNames() {
    for (const l of labels) m.speakers[l] = inputs[l].value.trim();
    await saveMeeting(m);
    location.hash = `#/m/${id}`;
  }

  root.append(
    header('Who spoke?', { large: true, back: `#/m/${id}`, backLabel: 'Meeting' }),
    h('main', { class: 'page' },
      h('p', { class: 'section-foot', style: 'margin: 0 4px' }, 'Play a line to hear each voice, then type their name. To-dos and notes will use it.'),
      labels.length ? groups : h('p', { class: 'summary', style: 'margin-top:16px' }, 'No speakers were found in this meeting.'),
      h('section', { class: 'section' }, h('button', { class: 'btn btn-filled btn-block', onclick: saveNames }, 'Save names'))),
  );
  return () => player.dispose();
}
