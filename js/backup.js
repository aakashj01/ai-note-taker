// Backup file = one text header line + a JSON manifest (all meetings) + the raw audio bytes.
// Built from Blob pieces, so audio is never copied into memory or turned into base64.
// Same file name every time, so saving it to the same iCloud Drive folder offers "Replace".
import { listMeetings, getMeeting, getPartBlob, putRestore } from './db.js';

export const BACKUP_NAME = 'meeting-notes-backup.mnotes';
const MAGIC = 'MEETINGNOTES-BACKUP';
const NOT_BACKUP = 'This is not a Meeting Notes backup.';
const DAMAGED = 'This backup is damaged, so nothing was restored.';
const enc = new TextEncoder();

export async function buildBackup({ includeAudio = true } = {}) {
  const meetings = await listMeetings();
  const audio = [], pieces = [];
  let offset = 0;
  if (includeAudio) {
    for (const m of meetings) {
      for (const p of m.parts || []) {
        const blob = await getPartBlob(p.id, p.mimeType);
        if (!blob.size) continue;
        audio.push({ partId: p.id, mimeType: p.mimeType, offset, size: blob.size });
        pieces.push(blob);
        offset += blob.size;
      }
    }
  }
  const manifest = enc.encode(JSON.stringify({ app: 'meeting-notes', version: 2, exportedAt: new Date().toISOString(), includesAudio: includeAudio, meetings, audio }));
  const blob = new Blob([`${MAGIC} 2 ${manifest.length}\n`, manifest, ...pieces], { type: 'application/octet-stream' });
  return { blob, count: meetings.length };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isArrOrNone = v => v === undefined || v === null || Array.isArray(v);
function validMeeting(m) {
  return m && typeof m.id === 'string' && m.id && isNum(m.createdAt) && typeof (m.title ?? '') === 'string'
    && Array.isArray(m.parts) && m.parts.every(p => p && typeof p.id === 'string' && typeof p.mimeType === 'string' && isNum(p.startOffset ?? 0) && isNum(p.duration ?? 0))
    && isArrOrNone(m.transcript)
    && (m.notes == null || (typeof m.notes === 'object' && !Array.isArray(m.notes)
      && ['todos', 'keyIdeas', 'highlights', 'extraSections'].every(k => isArrOrNone(m.notes[k]))));
}

function base64ToBlob(data, type) {
  const bin = atob(data); // throws on damaged data, before anything is written
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Returns [{ meeting, audio: [{ partId, blob }] }] for every meeting in the file. Throws before writing.
async function readEntries(file) {
  const head = await file.slice(0, 64).text();
  const m = head.match(/^MEETINGNOTES-BACKUP (\d+) (\d+)\n/);
  if (m) {
    const start = m[0].length, len = Number(m[2]);
    let data;
    try { data = JSON.parse(await file.slice(start, start + len).text()); } catch { throw new Error(DAMAGED); }
    if (data?.app !== 'meeting-notes' || !Array.isArray(data.meetings)) throw new Error(DAMAGED);
    const base = start + len;
    const byPart = new Map();
    for (const a of data.audio || []) {
      if (typeof a?.partId !== 'string' || !isNum(a.offset) || !isNum(a.size) || a.offset < 0 || base + a.offset + a.size > file.size) throw new Error(DAMAGED);
      byPart.set(a.partId, file.slice(base + a.offset, base + a.offset + a.size, a.mimeType));
    }
    return { entries: data.meetings.map(mt => ({ meeting: mt, audio: (mt?.parts || []).filter(p => byPart.has(p?.id)).map(p => ({ partId: p.id, blob: byPart.get(p.id) })) })), includesAudio: data.includesAudio !== false };
  }
  // Older JSON backups (app versions 9–14).
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error(NOT_BACKUP); }
  if (!data || data.app !== 'meeting-notes' || !Array.isArray(data.meetings)) throw new Error(NOT_BACKUP);
  try {
    return { entries: data.meetings.map(mt => ({ meeting: mt, audio: (mt?.parts || []).filter(p => data.audio?.[p?.id]?.data).map(p => ({ partId: p.id, blob: base64ToBlob(data.audio[p.id].data, data.audio[p.id].mimeType || p.mimeType) })) })), includesAudio: !!data.audio };
  } catch { throw new Error(DAMAGED); }
}

export async function restoreBackup(file) {
  const { entries } = await readEntries(file);
  if (!entries.every(e => validMeeting(e.meeting))) throw new Error(DAMAGED);
  const fresh = [];
  let skipped = 0;
  for (const e of entries) {
    if (await getMeeting(e.meeting.id)) { skipped++; continue; }
    const hasAudio = e.audio.length > 0;
    fresh.push({ meeting: hasAudio ? e.meeting : { ...e.meeting, audioMissing: true }, audio: e.audio });
  }
  await putRestore(fresh);
  return { added: fresh.length, skipped };
}

// iPhone Safari only allows the share sheet right after a tap; building a big backup can take
// longer than that. Then the caller keeps the file and asks for one more tap.
export async function shareOrDownload(file, { canShare, share, download }) {
  if (share && canShare?.({ files: [file] })) {
    try { await share({ files: [file] }); return 'shared'; } catch (e) {
      if (e.name === 'NotAllowedError') return 'needs-tap';
      throw e;
    }
  }
  download(file);
  return 'downloaded';
}
