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
