import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveMeeting, getMeeting, appendChunk, getPartBlob, deleteMeeting, setSetting } from '../../js/db.js';
import { buildBackup, restoreBackup, BACKUP_NAME } from '../../js/backup.js';

const meeting = (id, title = id) => ({ id, title, createdAt: 1, status: 'ready', parts: [{ id: id + '-p', mimeType: 'audio/mp4', startOffset: 0, duration: 5 }], notes: { summary: 's', todos: [], keyIdeas: [] } });
const asFile = blob => ({ text: () => blob.text() });

test('round-trips meetings and audio', async () => {
  await setSetting('apiKey', 'SECRET-KEY');
  await saveMeeting(meeting('a'));
  await appendChunk('a-p', 0, new Blob(['he']));
  await appendChunk('a-p', 1, new Blob(['llo']));
  const { blob, count } = await buildBackup({ includeAudio: true });
  assert.equal(count, 1);
  const text = await blob.text();
  assert.doesNotMatch(text, /SECRET-KEY/);
  await deleteMeeting('a');
  const r = await restoreBackup(asFile(blob));
  assert.deepEqual(r, { added: 1, skipped: 0 });
  assert.equal((await getMeeting('a')).title, 'a');
  assert.equal(await (await getPartBlob('a-p', 'audio/mp4')).text(), 'hello');
  assert.equal(BACKUP_NAME, 'meeting-notes-backup.json');
});

test('without audio has no audio key', async () => {
  const { blob } = await buildBackup({ includeAudio: false });
  assert.equal(JSON.parse(await blob.text()).audio, undefined);
});

test('existing meeting kept on restore', async () => {
  await saveMeeting(meeting('b', 'phone version'));
  const backup = new Blob([JSON.stringify({ app: 'meeting-notes', version: 1, meetings: [meeting('b', 'backup version'), meeting('c')] })]);
  const r = await restoreBackup(asFile(backup));
  assert.deepEqual(r, { added: 1, skipped: 1 });
  assert.equal((await getMeeting('b')).title, 'phone version');
});

test('rejects JSON from something else', async () => {
  await assert.rejects(restoreBackup(asFile(new Blob(['{"hello":1}']))), /not a Meeting Notes backup/);
});

test('rejects garbage', async () => {
  await assert.rejects(restoreBackup(asFile(new Blob(['%PDF-1.4 …']))), /not a Meeting Notes backup/);
});
