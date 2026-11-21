import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveMeeting, getMeeting, setSetting, appendChunk } from '../../js/db.js';
import { processMeeting, regenerateNotes, setGeminiFactory } from '../../js/process.js';

const base = id => ({
  id, title: 't', createdAt: 1, status: 'recorded', error: null,
  parts: [{ id: id + 'p', mimeType: 'audio/mp4', startOffset: 0, duration: 60 }],
  speakers: {}, context: '', transcript: [], notes: null,
});

test('regenerate keeps the corrected transcript and speaker names', async () => {
  await setSetting('apiKey', 'K');
  const transcript = [{ start: 0, end: 5, speaker: 'Speaker 2', text: 'Corrected by owner' }];
  await saveMeeting({ ...base('r'), status: 'ready', transcript, speakers: { 'Speaker 2': 'Rahul' },
    notes: { summary: 'old', keyIdeas: [], todos: [] } });
  let sentText = '';
  setGeminiFactory(() => ({ regenerate: async t => { sentText = t; return { summary: 'new', key_ideas: [], todos: [{ text: 'x', owner_speaker: 'Speaker 2' }] }; } }));
  const m = await regenerateNotes('r');
  assert.equal(m.notes.summary, 'new');
  assert.deepEqual(m.transcript, transcript);
  assert.deepEqual(m.speakers, { 'Speaker 2': 'Rahul' });
  assert.match(sentText, /Speaker 2: Corrected by owner/);
});

test('a dropped connection gives a clear retry message', async () => {
  await setSetting('apiKey', 'K');
  await saveMeeting(base('n'));
  await appendChunk('np', 0, new Blob(['x']));
  setGeminiFactory(() => ({ processAudio: async () => { throw new TypeError('Load failed'); } }));
  const m = await processMeeting('n');
  assert.equal(m.status, 'failed');
  assert.match(m.error, /Connection lost/);
  assert.equal((await getMeeting('n')).parts.length, 1);
});

test('notes-only fallback sets a notice and keeps going', async () => {
  await setSetting('apiKey', 'K');
  await saveMeeting(base('f'));
  await appendChunk('fp', 0, new Blob(['x']));
  setGeminiFactory(() => ({ processAudio: async () => ({ summary: 's', key_ideas: [], todos: [], transcriptDropped: true }) }));
  const m = await processMeeting('f');
  assert.equal(m.status, 'ready');
  assert.match(m.notice, /too long for a full transcript/);
});

test('a meeting whose recording is not on this phone says so', async () => {
  await setSetting('apiKey', 'K');
  await saveMeeting({ ...base('nm'), audioMissing: true });
  setGeminiFactory(() => ({ processAudio: async () => { throw new Error('should not be called'); } }));
  const m = await processMeeting('nm');
  assert.match(m.error, /recording isn.t on this phone/);
});

test('ask errors talk about answering, not making notes', async () => {
  const { askMeetings } = await import('../../js/process.js');
  await saveMeeting({ ...base('ready'), status: 'ready', notes: { summary: 's', todos: [], keyIdeas: [] } });
  setGeminiFactory(() => ({ ask: async () => { throw new TypeError('Load failed'); } }));
  await assert.rejects(askMeetings('q'), e => /answering/.test(e.message) && !/Make notes/.test(e.message));
});
