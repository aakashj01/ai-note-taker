// Offline search over everything stored for a meeting. No AI involved.
import { displaySpeaker } from './notes.js';

function fields(m) {
  const n = m.notes || {};
  return [
    m.title,
    ...Object.values(m.speakers || {}),
    n.summary,
    ...(n.todos || []).map(t => `${t.owner ? displaySpeaker(t.owner, m.speakers) + ': ' : ''}${t.text}`),
    ...(n.keyIdeas || []).map(k => k.text),
    ...(n.highlights || []).map(x => x.text),
    ...(n.extraSections || []).flatMap(s => [s.title, ...(s.items || [])]),
    ...(m.transcript || []).map(s => s.text),
  ].filter(v => typeof v === 'string' && v);
}

export function searchMeetings(meetings, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return meetings.map(meeting => ({ meeting, snippet: null }));
  const out = [];
  for (const meeting of meetings) {
    for (const text of fields(meeting)) {
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) continue;
      const start = Math.max(0, i - 40), end = Math.min(text.length, i + q.length + 40);
      out.push({ meeting, snippet: {
        before: (start > 0 ? '…' : '') + text.slice(start, i),
        match: text.slice(i, i + q.length),
        after: text.slice(i + q.length, end) + (end < text.length ? '…' : ''),
      } });
      break;
    }
  }
  return out;
}
