import { listMeetings, getMeeting, saveMeeting } from '../db.js';
import { collectTodos, peopleFromTodos, ownerName, UNASSIGNED } from '../todos.js';
import { formatDate, h, header, icon, toast } from './dom.js';

export async function renderTodos(root) {
  let meetings = await listMeetings();
  let person = null, showDone = false;
  const chips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Filter by person' });
  const list = h('div', {});
  const doneSwitch = h('button', {
    class: 'switch', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Show done',
    onclick: () => { showDone = !showDone; doneSwitch.setAttribute('aria-checked', String(showDone)); draw(); },
  });

  async function tick(meetingId, index, done) {
    const m = await getMeeting(meetingId);
    if (!m?.notes?.todos?.[index]) return;
    m.notes.todos[index].done = done;
    await saveMeeting(m);
    meetings = meetings.map(x => (x.id === m.id ? m : x));
    if (done && !showDone) toast('Marked done');
    draw();
  }

  function draw() {
    const people = peopleFromTodos(meetings);
    if (person && !people.includes(person)) person = null;
    const chip = (value, label) => h('label', { class: 'chip' },
      h('input', { type: 'radio', name: 'person', checked: person === value, onchange: () => { person = value; draw(); } }), label);
    chips.replaceChildren(chip(null, 'Everyone'), ...people.map(p => chip(p, p)));

    const groups = collectTodos(meetings, { person, showDone });
    list.replaceChildren(...(groups.length ? groups.map(({ meeting, items }) => h('section', { class: 'section' },
      h('a', { class: 'todo-meeting-link', href: `#/m/${meeting.id}` },
        h('span', { class: 'section-head' }, meeting.title), h('span', { class: 'cell-sub' }, formatDate(meeting.createdAt))),
      h('ul', { class: 'group' }, items.map(({ todo, index }) => {
        const owner = ownerName(meeting, todo);
        return h('li', { class: 'cell todo' + (todo.done ? ' done' : '') },
          h('input', { type: 'checkbox', class: 'check', checked: todo.done, 'aria-label': `Done: ${todo.text}`, onchange: e => tick(meeting.id, index, e.target.checked) }),
          h('div', { class: 'cell-main todo-text' },
            owner !== UNASSIGNED ? h('span', { class: 'todo-owner' }, owner + ': ') : null,
            todo.text,
            todo.due ? h('span', { class: 'todo-due' }, 'Due ' + todo.due) : null));
      })))) : [h('div', { class: 'empty' }, icon('sparkle', 48),
        h('h2', {}, showDone ? 'No to-dos' : 'All done'),
        h('p', {}, person ? `Nothing open for ${person}.` : 'To-dos from your meetings show up here.'))]));
  }

  root.append(
    header('To-dos', { large: true, back: '#/', backLabel: 'Meetings' }),
    h('main', { class: 'page' },
      chips,
      h('ul', { class: 'group', style: 'margin-top:14px' }, h('li', { class: 'cell' }, h('div', { class: 'cell-main' }, 'Show done'), doneSwitch)),
      list),
  );
  draw();
}
