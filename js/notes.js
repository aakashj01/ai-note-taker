// Pure helpers: turn the AI's JSON into the app's notes model, and back out as Markdown.

export function parseTime(s) {
  if (typeof s === 'number' && Number.isFinite(s)) return s;
  if (typeof s !== 'string') return 0;
  const bits = s.trim().split(':');
  if (!bits.every(b => /^\d+(\.\d+)?$/.test(b))) return 0;
  return bits.reduce((acc, b) => acc * 60 + Number(b), 0);
}

export function formatTime(sec) {
  const t = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const str = v => (typeof v === 'string' ? v.trim() : '');
const arr = v => (Array.isArray(v) ? v : []);

export function normalizeResult(raw, durationSec) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Bad AI response: not an object');
  }
  if (!str(raw.summary) && !arr(raw.transcript).length) {
    throw new Error('Bad AI response: no summary or transcript');
  }
  const max = durationSec > 0 ? durationSec : Infinity;
  const clamp = t => Math.min(Math.max(parseTime(t), 0), max);

  const transcript = arr(raw.transcript)
    .filter(s => s && str(s.text))
    .map(s => ({ start: clamp(s.start), end: clamp(s.end), speaker: str(s.speaker) || 'Speaker ?', text: str(s.text) }));

  const speakers = [...new Set(transcript.map(s => s.speaker))];

  const notes = {
    summary: str(raw.summary),
    keyIdeas: arr(raw.key_ideas).filter(k => k && str(k.text))
      .map(k => ({ text: str(k.text), source: clamp(k.source) })),
    todos: arr(raw.todos).filter(t => t && str(t.text))
      .map(t => ({ text: str(t.text), owner: str(t.owner_speaker) || null, due: str(t.due) || null, source: clamp(t.source), done: false })),
    highlights: arr(raw.highlights).filter(x => x && str(x.text))
      .map(x => ({ time: clamp(x.time), text: str(x.text) })),
    extraSections: arr(raw.extra_sections).filter(x => x && str(x.title))
      .map(x => ({ title: str(x.title), items: arr(x.items).map(str).filter(Boolean) })),
  };
  return { transcript, notes, speakers };
}

export function displaySpeaker(label, speakers) {
  if (!label) return '';
  return (speakers && str(speakers[label])) || label;
}

// Keeps the labels (so owner_speaker comes back as a label) and adds who-is-who.
export function transcriptToText(transcript, speakers = {}) {
  const lines = transcript.map(s => `[${formatTime(s.start)}] ${s.speaker}: ${s.text}`);
  const legend = Object.entries(speakers).filter(([, n]) => n && n.trim()).map(([l, n]) => `${l} = ${n.trim()}`);
  return (legend.length ? `Speaker names: ${legend.join(', ')}\n\n` : '') + lines.join('\n');
}

export function toMarkdown(meeting) {
  const { notes, speakers = {} } = meeting;
  const date = new Date(meeting.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const lines = [`# ${meeting.title}`, '', date, '', '## Summary', '', notes?.summary || '', '', '## To-dos', ''];
  for (const t of notes?.todos || []) {
    const owner = t.owner ? `${displaySpeaker(t.owner, speakers)}: ` : '';
    lines.push(`- [${t.done ? 'x' : ' '}] ${owner}${t.text}${t.due ? ` (due ${t.due})` : ''}`);
  }
  lines.push('', '## Key ideas', '');
  for (const k of notes?.keyIdeas || []) lines.push(`- ${k.text}`);
  return lines.join('\n') + '\n';
}

// Chat-friendly text (WhatsApp/Slack/Teams): *bold* headings, ☐/☑ for to-dos, no Markdown #.
const HEADS = { summary: 'Summary', todos: 'To-dos', ideas: 'Key ideas', highlights: 'Marked moments' };

export function sectionText(meeting, which) {
  const { notes = {}, speakers = {} } = meeting;
  let lines = [];
  if (which === 'summary') lines = notes.summary ? [notes.summary] : [];
  if (which === 'todos') {
    lines = (notes.todos || []).map(t => {
      const owner = t.owner ? `${displaySpeaker(t.owner, speakers)}: ` : '';
      return `${t.done ? '☑' : '☐'} ${owner}${t.text}${t.due ? ` (due ${t.due})` : ''}`;
    });
  }
  if (which === 'ideas') lines = (notes.keyIdeas || []).map(k => `• ${k.text}`);
  if (which.startsWith('extra:')) {
    const sec = (notes.extraSections || [])[Number(which.slice(6))];
    if (!sec) return '';
    const items = sec.items.map(i => `• ${i}`);
    return `*${displaySpeaker(sec.title, speakers)}*\n${items.length ? items.join('\n') : 'None'}`;
  }
  if (which === 'highlights') lines = (notes.highlights || []).map(x => `⭐ ${formatTime(x.time)} ${x.text}`);
  return `*${HEADS[which]}*\n${lines.length ? lines.join('\n') : 'None'}`;
}

export function toChatText(meeting) {
  const date = new Date(meeting.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const parts = [...(meeting.notes?.highlights?.length ? ['highlights'] : []), 'summary', 'todos', 'ideas',
    ...(meeting.notes?.extraSections || []).map((_, i) => `extra:${i}`)];
  return [`*${meeting.title}*\n${date}`, ...parts.map(w => sectionText(meeting, w))].join('\n\n');
}
