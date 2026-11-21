import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveMeeting, getMeeting, listMeetings, deleteMeeting,
  appendChunk, getPartBlob, getSetting, setSetting,
} from '../../js/db.js';

const meeting = (id, createdAt) => ({ id, title: id, createdAt, status: 'recorded', parts: [] });

test('saves and lists meetings newest first', async () => {
  await saveMeeting(meeting('old', 1));
  await saveMeeting(meeting('new', 2));
  const list = await listMeetings();
  assert.deepEqual(list.slice(0, 2).map(m => m.id), ['new', 'old']);
  assert.equal((await getMeeting('old')).title, 'old');
});

test('getPartBlob joins chunks in seq order', async () => {
  await appendChunk('p1', 1, new Blob(['b']));
  await appendChunk('p1', 0, new Blob(['a']));
  const blob = await getPartBlob('p1', 'audio/mp4');
  assert.equal(await blob.text(), 'ab');
  assert.equal(blob.type, 'audio/mp4');
});

test('deleteMeeting removes its chunks', async () => {
  await saveMeeting({ ...meeting('d', 3), parts: [{ id: 'pd', mimeType: 'audio/mp4' }] });
  await appendChunk('pd', 0, new Blob(['x']));
  await deleteMeeting('d');
  assert.equal(await getMeeting('d'), undefined);
  assert.equal((await getPartBlob('pd', 'audio/mp4')).size, 0);
});

test('getSetting returns fallback when unset', async () => {
  assert.equal(await getSetting('nope', 'fb'), 'fb');
  await setSetting('k', 'v');
  assert.equal(await getSetting('k', 'fb'), 'v');
});
