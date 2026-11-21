import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberNames, suggestNames, EMPTY_PEOPLE } from '../../js/people.js';

test('remembers typed names (unique, sorted) and the last mapping per meeting type', () => {
  let store = rememberNames({ type: 'standup', speakers: { 'Speaker 1': 'Rahul', 'Speaker 2': '' } }, EMPTY_PEOPLE);
  store = rememberNames({ type: 'standup', speakers: { 'Speaker 1': 'Asha', 'Speaker 2': 'rahul ' } }, store);
  assert.deepEqual(store.people, ['Asha', 'Rahul']);
  assert.deepEqual(store.lastNames.standup, { 'Speaker 1': 'Asha', 'Speaker 2': 'Rahul' });
  assert.deepEqual(EMPTY_PEOPLE.people, []);
});

test('suggestions: typed name, then AI guess from speech, then last time for this type', () => {
  const store = { people: ['Asha', 'Rahul'], lastNames: { standup: { 'Speaker 1': 'Asha', 'Speaker 3': 'Vik' } } };
  const m = { type: 'standup', speakers: { 'Speaker 1': '', 'Speaker 2': '', 'Speaker 3': 'Vikram' }, nameGuesses: { 'Speaker 2': 'Rahul' } };
  assert.deepEqual(suggestNames(m, store), {
    'Speaker 1': { name: 'Asha', why: 'last' },
    'Speaker 2': { name: 'Rahul', why: 'speech' },
    'Speaker 3': { name: 'Vikram', why: 'typed' },
  });
});

test('no store and no guesses gives empty suggestions', () => {
  assert.deepEqual(suggestNames({ speakers: { 'Speaker 1': '' } }, EMPTY_PEOPLE), { 'Speaker 1': { name: '', why: null } });
});
