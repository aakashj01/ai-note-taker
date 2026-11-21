import { getMeeting, saveMeeting, getSetting, setSetting } from '../db.js';
import { rememberNames, suggestNames, EMPTY_PEOPLE } from '../people.js';
import { h, header, icon } from './dom.js';
import { createPlayer } from './player.js';

const WHY = { speech: 'Suggested from what was said. Check it.', last: 'Same as your last meeting of this type. Check it.' };

export async function renderSpeakers(root, id) {
  const m = await getMeeting(id);
  if (!m) { location.hash = '#/'; return; }
  const player = createPlayer(m);
  const store = await getSetting('peopleStore', EMPTY_PEOPLE);
  const suggestions = suggestNames(m, store);
  const labels = Object.keys(m.speakers || {});
  const inputs = {};

  const groups = labels.map(label => {
    const sample = (m.transcript || []).find(s => s.speaker === label);
    const sug = suggestions[label];
    const hint = h('p', { class: 'section-foot' }, WHY[sug.why] || '');
    inputs[label] = h('input', {
      class: 'field', type: 'text', value: sug.name, placeholder: 'Name', 'aria-label': `Name for ${label}`, autocomplete: 'off', autocapitalize: 'words',
      oninput: () => { hint.textContent = ''; },
    });
    const chips = (store.people || []).slice(0, 12).map(p => h('button', {
      class: 'chip chip-btn', type: 'button', 'aria-label': `Use ${p} for ${label}`,
      onclick: () => { inputs[label].value = p; hint.textContent = ''; },
    }, p));
    return h('section', { class: 'section' },
      h('h2', { class: 'section-head' }, label),
      h('ul', { class: 'group' },
        sample ? h('li', { class: 'cell' },
          h('button', { class: 'round-btn', style: 'width:36px;height:36px;color:var(--tint)', onclick: () => player.playFrom(sample.start), 'aria-label': `Play ${label}` }, icon('play', 16)),
          h('div', { class: 'cell-main sample' }, `“${sample.text.slice(0, 140)}${sample.text.length > 140 ? '…' : ''}”`)) : null,
        h('li', { class: 'cell' }, inputs[label])),
      chips.length ? h('div', { class: 'chips', style: 'margin-top:8px' }, chips) : null,
      hint);
  });

  async function saveNames() {
    for (const l of labels) m.speakers[l] = inputs[l].value.trim();
    await saveMeeting(m);
    await setSetting('peopleStore', rememberNames(m, store));
    location.hash = `#/m/${id}`;
  }

  root.append(
    header('Who spoke?', { large: true, back: `#/m/${id}`, backLabel: 'Meeting' }),
    h('main', { class: 'page' },
      h('p', { class: 'section-foot', style: 'margin: 0 4px' }, 'Play a line to hear each voice, then type or tap their name. To-dos and notes will use it, and the app will remember the names for next time.'),
      labels.length ? groups : h('p', { class: 'summary', style: 'margin-top:16px' }, 'No speakers were found in this meeting.'),
      h('section', { class: 'section' }, h('button', { class: 'btn btn-filled btn-block', onclick: saveNames }, 'Save names'))),
  );
  return () => player.dispose();
}
