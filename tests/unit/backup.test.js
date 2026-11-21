import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveMeeting, getMeeting, appendChunk, getPartBlob, deleteMeeting, setSetting, listMeetings } from '../../js/db.js';
import { buildBackup, restoreBackup, shareOrDownload, BACKUP_NAME } from '../../js/backup.js';

const meeting = (id, title = id) => ({ id, title, createdAt: 1, status: 'ready', parts: [{ id: id + '-p', mimeType: 'audio/mp4', startOffset: 0, duration: 5 }], notes: { summary: 's', todos: [], keyIdeas: [] }, transcript: [] });

test('round-trips meetings and audio as raw bytes (no base64), key never included', async () => {
  await setSetting('apiKey', 'SECRET-KEY');
  await saveMeeting(meeting('a'));
  await appendChunk('a-p', 0, new Blob(['he']));
  await appendChunk('a-p', 1, new Blob(['llo']));
  const { blob, count } = await buildBackup({ includeAudio: true });
  assert.equal(count, 1);
  const text = await blob.text();
  assert.doesNotMatch(text, /SECRET-KEY/);
  assert.match(text, /^MEETINGNOTES-BACKUP 2 \d+\n/);
  assert.ok(text.endsWith('hello'));
  await deleteMeeting('a');
  assert.deepEqual(await restoreBackup(blob), { added: 1, skipped: 0 });
  assert.equal((await getMeeting('a')).title, 'a');
  assert.equal(await (await getPartBlob('a-p', 'audio/mp4')).text(), 'hello');
  assert.equal(BACKUP_NAME, 'meeting-notes-backup.mnotes');
});

test('without recordings: meetings only, and restored meetings are flagged as having no audio', async () => {
  const { blob } = await buildBackup({ includeAudio: false });
  assert.doesNotMatch(await blob.text(), /hello/);
  await deleteMeeting('a');
  await restoreBackup(blob);
  assert.equal((await getMeeting('a')).audioMissing, true);
});

test('existing meeting kept on restore', async () => {
  await saveMeeting(meeting('b', 'phone version'));
  const v1 = new Blob([JSON.stringify({ app: 'meeting-notes', version: 1, meetings: [meeting('b', 'backup version'), meeting('c')] })]);
  assert.deepEqual(await restoreBackup(v1), { added: 1, skipped: 1 });
  assert.equal((await getMeeting('b')).title, 'phone version');
});

test('old JSON backups with base64 audio still restore', async () => {
  const v1 = new Blob([JSON.stringify({ app: 'meeting-notes', version: 1, meetings: [meeting('j')], audio: { 'j-p': { mimeType: 'audio/mp4', data: btoa('abc') } } })]);
  await restoreBackup(v1);
  assert.equal(await (await getPartBlob('j-p', 'audio/mp4')).text(), 'abc');
});

test('a damaged backup restores nothing at all', async () => {
  const before = (await listMeetings()).length;
  const bad = new Blob([JSON.stringify({ app: 'meeting-notes', version: 1, meetings: [meeting('ok1'), meeting('ok2')], audio: { 'ok2-p': { mimeType: 'audio/mp4', data: '***not base64***' } } })]);
  await assert.rejects(restoreBackup(bad), /damaged, so nothing was restored/);
  const malformed = new Blob([JSON.stringify({ app: 'meeting-notes', version: 1, meetings: [meeting('ok3'), { id: 'c2', notes: 'x', parts: 'zz' }] })]);
  await assert.rejects(restoreBackup(malformed), /damaged, so nothing was restored/);
  assert.equal((await listMeetings()).length, before);
  assert.equal(await getMeeting('ok1'), undefined);
});

test('rejects files from something else', async () => {
  await assert.rejects(restoreBackup(new Blob(['{"hello":1}'])), /not a Meeting Notes backup/);
  await assert.rejects(restoreBackup(new Blob(['%PDF-1.4 …'])), /not a Meeting Notes backup/);
});

test('share refused because the tap expired: asks for one more tap', async () => {
  const file = new Blob(['x']);
  const err = Object.assign(new Error('not allowed'), { name: 'NotAllowedError' });
  assert.equal(await shareOrDownload(file, { canShare: () => true, share: async () => { throw err; }, download: () => {} }), 'needs-tap');
  assert.equal(await shareOrDownload(file, { canShare: () => true, share: async () => {}, download: () => {} }), 'shared');
  let dl = 0;
  assert.equal(await shareOrDownload(file, { canShare: () => false, share: null, download: () => { dl++; } }), 'downloaded');
  assert.equal(dl, 1);
});
