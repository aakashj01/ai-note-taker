// One JSON file with every meeting (and optionally the audio). Same file name every time,
// so saving it to the same iCloud Drive folder makes iOS offer "Replace".
import { listMeetings, saveMeeting, getMeeting, appendChunk, getPartBlob } from './db.js';
import { blobToBase64 } from './gemini.js';

export const BACKUP_NAME = 'meeting-notes-backup.json';
const NOT_BACKUP = 'This is not a Meeting Notes backup.';

function base64ToBlob(data, type) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function buildBackup({ includeAudio = true } = {}) {
  const meetings = await listMeetings();
  const data = { app: 'meeting-notes', version: 1, exportedAt: new Date().toISOString(), meetings };
  if (includeAudio) {
    data.audio = {};
    for (const m of meetings) {
      for (const p of m.parts || []) {
        const blob = await getPartBlob(p.id, p.mimeType);
        if (blob.size) data.audio[p.id] = { mimeType: p.mimeType, data: await blobToBase64(blob) };
      }
    }
  }
  return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), count: meetings.length };
}

export async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error(NOT_BACKUP); }
  if (!data || data.app !== 'meeting-notes' || !Array.isArray(data.meetings)) throw new Error(NOT_BACKUP);
  let added = 0, skipped = 0;
  for (const m of data.meetings) {
    if (!m?.id || await getMeeting(m.id)) { skipped++; continue; }
    for (const p of m.parts || []) {
      const a = data.audio?.[p.id];
      if (a?.data) await appendChunk(p.id, 0, base64ToBlob(a.data, a.mimeType || p.mimeType));
    }
    await saveMeeting(m);
    added++;
  }
  return { added, skipped };
}
