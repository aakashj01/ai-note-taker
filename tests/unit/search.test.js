import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMeetings } from '../../js/search.js';

const meetings = [
  { id: 'a', title: 'Weekly sync', speakers: { 'Speaker 2': 'Rahul' },
    notes: { summary: 'Launch moves.', todos: [{ text: 'Send the deck', owner: 'Speaker 2' }], keyIdeas: [{ text: 'Pricing ₹499' }] },
    transcript: [{ speaker: 'Speaker 1', text: 'Chalo, budget ki baat karte hain aur phir marketing plan dekhenge' }] },
  { id: 'b', title: 'Client call', notes: null, transcript: [] },
];

test('matches transcript Hinglish case-insensitively', () => {
  const r = searchMeetings(meetings, 'BUDGET');
  assert.deepEqual(r.map(x => x.meeting.id), ['a']);
  assert.equal(r[0].snippet.match, 'budget');
});

test('matches a speaker name', () => {
  assert.deepEqual(searchMeetings(meetings, 'rahul').map(x => x.meeting.id), ['a']);
});

test('snippet centred on match with context', () => {
  const { snippet } = searchMeetings(meetings, 'marketing')[0];
  assert.equal(snippet.match, 'marketing');
  assert.ok(snippet.before.endsWith('phir '));
  assert.ok(snippet.after.startsWith(' plan'));
});

test('title matches have no snippet needed but still match', () => {
  assert.deepEqual(searchMeetings(meetings, 'client').map(x => x.meeting.id), ['b']);
});

test('empty query returns all with no snippet', () => {
  const r = searchMeetings(meetings, '  ');
  assert.equal(r.length, 2);
  assert.equal(r[0].snippet, null);
});

test('no match returns []', () => {
  assert.deepEqual(searchMeetings(meetings, 'zebra'), []);
});
