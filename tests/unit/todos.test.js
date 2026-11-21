import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTodos, peopleFromTodos } from '../../js/todos.js';

const M = [
  { id: 'old', createdAt: 1, speakers: { 'Speaker 1': 'Asha' }, notes: { todos: [
    { text: 'Book venue', owner: 'Speaker 1', done: true },
    { text: 'Call vendor', owner: null, done: false }] } },
  { id: 'new', createdAt: 2, speakers: { 'Speaker 2': 'Rahul', 'Speaker 3': '' }, notes: { todos: [
    { text: 'Send deck', owner: 'Speaker 2', done: false },
    { text: 'Fix bug', owner: 'Speaker 3', done: false }] } },
  { id: 'v1', createdAt: 3, status: 'recorded', notes: null },
];

test('open only by default, newest meeting first', () => {
  const r = collectTodos(M, {});
  assert.deepEqual(r.map(g => g.meeting.id), ['new', 'old']);
  assert.deepEqual(r[1].items.map(i => i.todo.text), ['Call vendor']);
  assert.equal(r[1].items[0].index, 1);
});

test('showDone includes done', () => {
  const r = collectTodos(M, { showDone: true });
  assert.deepEqual(r[1].items.map(i => i.todo.text), ['Book venue', 'Call vendor']);
});

test('filter by display name', () => {
  const r = collectTodos(M, { person: 'Rahul' });
  assert.deepEqual(r.map(g => g.meeting.id), ['new']);
  assert.deepEqual(r[0].items.map(i => i.todo.text), ['Send deck']);
});

test('unassigned bucket covers no owner and unnamed speakers', () => {
  const r = collectTodos(M, { person: 'Unassigned' });
  assert.deepEqual(r.flatMap(g => g.items.map(i => i.todo.text)), ['Fix bug', 'Call vendor']);
});

test('people list: names sorted, Unassigned last', () => {
  assert.deepEqual(peopleFromTodos(M), ['Asha', 'Rahul', 'Unassigned']);
});
