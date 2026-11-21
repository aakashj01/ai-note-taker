import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, normalizeResult, displaySpeaker, toMarkdown, formatTime } from '../../js/notes.js';

const raw = () => ({
  summary: 'Team agreed to move the launch.',
  key_ideas: [{ text: 'Pricing stays at ₹499', source: '02:10' }],
  todos: [
    { text: 'send deck', owner_speaker: 'Speaker 2', due: 'Fri', source: '99:00' },
    { text: 'book venue', owner_speaker: 'Speaker 1', source: '01:00' },
  ],
  transcript: [
    { start: '00:00', end: '00:05', speaker: 'Speaker 1', text: 'Chalo shuru karte hain' },
    { start: '00:05', end: '00:09', speaker: 'Speaker 2', text: 'Haan, deck main bhej dunga' },
    { start: '00:09', end: '00:12', speaker: 'Speaker 1', text: 'Theek hai' },
  ],
});

test('parseTime handles hh:mm:ss, mm:ss, numbers and junk', () => {
  assert.equal(parseTime('01:02:03'), 3723);
  assert.equal(parseTime('4:05'), 245);
  assert.equal(parseTime(12.5), 12.5);
  assert.equal(parseTime('junk'), 0);
  assert.equal(parseTime(undefined), 0);
});

test('formatTime renders m:ss and h:mm:ss', () => {
  assert.equal(formatTime(245), '4:05');
  assert.equal(formatTime(3723), '1:02:03');
});

test('normalizeResult clamps source beyond duration', () => {
  const r = normalizeResult(raw(), 600);
  assert.equal(r.notes.todos[0].source, 600);
  assert.equal(r.notes.keyIdeas[0].source, 130);
});

test('missing due becomes null and done defaults false', () => {
  const r = normalizeResult(raw(), 600);
  assert.equal(r.notes.todos[1].due, null);
  assert.equal(r.notes.todos[0].due, 'Fri');
  assert.equal(r.notes.todos[0].done, false);
  assert.equal(r.notes.todos[0].owner, 'Speaker 2');
});

test('missing todos becomes []', () => {
  const x = raw(); delete x.todos; delete x.key_ideas;
  const r = normalizeResult(x, 600);
  assert.deepEqual(r.notes.todos, []);
  assert.deepEqual(r.notes.keyIdeas, []);
});

test('speakers lists unique labels in first-appearance order', () => {
  assert.deepEqual(normalizeResult(raw(), 600).speakers, ['Speaker 1', 'Speaker 2']);
});

test('transcript times are parsed to seconds', () => {
  const t = normalizeResult(raw(), 600).transcript;
  assert.deepEqual(t[1], { start: 5, end: 9, speaker: 'Speaker 2', text: 'Haan, deck main bhej dunga' });
});

test('throws on string input and on {}', () => {
  assert.throws(() => normalizeResult('oops', 600), /Bad AI response/);
  assert.throws(() => normalizeResult({}, 600), /Bad AI response/);
});

test('displaySpeaker uses name when set, label otherwise', () => {
  assert.equal(displaySpeaker('Speaker 2', { 'Speaker 2': 'Rahul' }), 'Rahul');
  assert.equal(displaySpeaker('Speaker 1', { 'Speaker 1': '' }), 'Speaker 1');
  assert.equal(displaySpeaker(null, {}), '');
});

test('toMarkdown uses speaker names', () => {
  const r = normalizeResult(raw(), 600);
  const md = toMarkdown({ title: 'Weekly sync', createdAt: Date.UTC(2026, 10, 21), notes: r.notes, speakers: { 'Speaker 2': 'Rahul' } });
  assert.match(md, /^# Weekly sync/);
  assert.match(md, /## Summary\n\nTeam agreed/);
  assert.match(md, /## To-dos\n\n- \[ \] Rahul: send deck \(due Fri\)/);
  assert.match(md, /- \[ \] Speaker 1: book venue\n/);
  assert.match(md, /## Key ideas\n\n- Pricing stays at ₹499/);
});

test('transcriptToText keeps speaker labels and adds a name legend', async () => {
  const { transcriptToText } = await import('../../js/notes.js');
  const txt = transcriptToText([{ start: 5, speaker: 'Speaker 2', text: 'hi' }], { 'Speaker 2': 'Rahul' });
  assert.match(txt, /\[0:05\] Speaker 2: hi/);
  assert.match(txt, /Speaker 2 = Rahul/);
});

test('chat text: each section on its own, WhatsApp-style', async () => {
  const { sectionText, toChatText } = await import('../../js/notes.js');
  const r = normalizeResult(raw(), 600);
  r.notes.todos[1].done = true;
  const m = { title: 'Weekly sync', createdAt: Date.UTC(2026, 10, 21, 6), notes: r.notes, speakers: { 'Speaker 2': 'Rahul' } };
  assert.equal(sectionText(m, 'summary'), '*Summary*\nTeam agreed to move the launch.');
  assert.equal(sectionText(m, 'todos'), '*To-dos*\n☐ Rahul: send deck (due Fri)\n☑ Speaker 1: book venue');
  assert.equal(sectionText(m, 'ideas'), '*Key ideas*\n• Pricing stays at ₹499');
  const all = toChatText(m);
  assert.match(all, /^\*Weekly sync\*\n21 Nov 2026\n\n\*Summary\*/);
  assert.match(all, /\*To-dos\*\n☐ Rahul/);
  assert.match(all, /\*Key ideas\*\n• Pricing/);
  assert.doesNotMatch(all, /#/);
});

test('chat text says so when a section is empty', async () => {
  const { sectionText } = await import('../../js/notes.js');
  const m = { notes: { summary: '', todos: [], keyIdeas: [] }, speakers: {} };
  assert.equal(sectionText(m, 'todos'), '*To-dos*\nNone');
});

test('highlights are normalised and copyable; v1 meetings have none', async () => {
  const { sectionText, toChatText } = await import('../../js/notes.js');
  const r = normalizeResult({ ...raw(), highlights: [{ time: '00:45', text: 'Budget approved' }, { time: '1:00', text: '' }] }, 600);
  assert.deepEqual(r.notes.highlights, [{ time: 45, text: 'Budget approved' }]);
  assert.deepEqual(normalizeResult(raw(), 600).notes.highlights, []);
  const m = { title: 't', createdAt: 0, notes: r.notes, speakers: {} };
  assert.equal(sectionText(m, 'highlights'), '*Marked moments*\n⭐ 0:45 Budget approved');
  assert.match(toChatText(m), /\*Marked moments\*\n⭐ 0:45/);
  const v1 = { title: 't', createdAt: 0, notes: { summary: 's', todos: [], keyIdeas: [] }, speakers: {} };
  assert.doesNotMatch(toChatText(v1), /Marked moments/);
});

test('extra sections are normalised, copied with speaker names, and in the full share', async () => {
  const { sectionText, toChatText } = await import('../../js/notes.js');
  const r = normalizeResult({ ...raw(), extra_sections: [{ title: 'Speaker 2', items: ['Done: deck draft', '', 'Blocked: pricing sign-off'] }, { title: '', items: ['x'] }] }, 600);
  assert.deepEqual(r.notes.extraSections, [{ title: 'Speaker 2', items: ['Done: deck draft', 'Blocked: pricing sign-off'] }]);
  const m = { title: 't', createdAt: 0, notes: r.notes, speakers: { 'Speaker 2': 'Rahul' } };
  assert.equal(sectionText(m, 'extra:0'), '*Rahul*\n• Done: deck draft\n• Blocked: pricing sign-off');
  assert.match(toChatText(m), /\*Rahul\*\n• Done: deck draft/);
  assert.deepEqual(normalizeResult(raw(), 600).notes.extraSections, []);
});
