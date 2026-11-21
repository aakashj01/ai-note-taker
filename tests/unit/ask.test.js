import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAskContext, buildAskPrompt, ASK_SCHEMA } from '../../js/ask.js';

const mk = (id, createdAt, words) => ({
  id, title: `Meeting ${id}`, createdAt, speakers: { 'Speaker 2': 'Rahul' },
  notes: { summary: `Summary ${id}`, todos: [{ text: `Todo ${id}`, owner: 'Speaker 2', due: 'Friday' }], keyIdeas: [{ text: `Idea ${id}` }], extraSections: [], highlights: [] },
  transcript: [{ start: 5, speaker: 'Speaker 2', text: `${id} `.repeat(words) }],
});

test('includes notes, names and transcript, newest first', () => {
  const ctx = buildAskContext([mk('old', 1, 3), mk('new', 2, 3), { id: 'x', createdAt: 3, notes: null }], 100000);
  assert.ok(ctx.indexOf('id=new') < ctx.indexOf('id=old'));
  assert.doesNotMatch(ctx, /id=x/);
  assert.match(ctx, /Rahul: Todo new \(due Friday\)/);
  assert.match(ctx, /\[0:05\] Rahul: new new new/);
});

test('trims the oldest transcripts first when too long', () => {
  const ctx = buildAskContext([mk('old', 1, 400), mk('new', 2, 400)], 3000);
  assert.match(ctx, /id=old/);
  assert.match(ctx, /Summary old/);
  assert.doesNotMatch(ctx, /old old old/);
  assert.match(ctx, /new new new/);
  assert.ok(ctx.length <= 3000);
});

test('no ready meetings gives empty context', () => {
  assert.equal(buildAskContext([{ id: 'x', createdAt: 1, notes: null }], 1000), '');
});

test('prompt carries the question and asks for honesty; schema has sources', () => {
  const p = buildAskPrompt('What did Rahul promise?', 'CTX');
  assert.match(p, /What did Rahul promise\?/);
  assert.match(p, /CTX/);
  assert.match(p, /not in the meetings/i);
  assert.ok(ASK_SCHEMA.properties.sources);
});

test('one huge meeting is trimmed, not dropped', () => {
  const huge = mk('big', 5, 10);
  huge.notes.summary = 'x'.repeat(5000);
  const ctx = buildAskContext([huge], 1000);
  assert.match(ctx, /id=big/);
  assert.ok(ctx.length <= 1000);
});
