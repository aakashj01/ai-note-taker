// "Ask your meetings": packs saved notes + transcripts into one text for Gemini.
import { displaySpeaker, formatTime } from './notes.js';

const S = { type: 'STRING' };
export const ASK_SCHEMA = {
  type: 'OBJECT',
  properties: {
    answer: S,
    sources: { type: 'ARRAY', items: { type: 'OBJECT', properties: { meeting_id: S, time: S }, required: ['meeting_id'] } },
  },
  required: ['answer', 'sources'],
};

function notesBlock(m) {
  const n = m.notes;
  const who = t => (t.owner ? `${displaySpeaker(t.owner, m.speakers)}: ` : '');
  const names = Object.entries(m.speakers || {}).filter(([, v]) => v).map(([l, v]) => `${l} = ${v}`).join(', ');
  return [
    `### Meeting id=${m.id} | "${m.title}" | ${new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ')}`,
    names ? `Speakers: ${names}` : '',
    `Summary: ${n.summary || ''}`,
    n.todos?.length ? 'To-dos:\n' + n.todos.map(t => `- ${who(t)}${t.text}${t.due ? ` (due ${t.due})` : ''}${t.done ? ' [done]' : ''}`).join('\n') : '',
    n.keyIdeas?.length ? 'Key ideas:\n' + n.keyIdeas.map(k => `- ${k.text}`).join('\n') : '',
    ...(n.extraSections || []).map(s => `${displaySpeaker(s.title, m.speakers)}:\n` + s.items.map(i => `- ${i}`).join('\n')),
    n.highlights?.length ? 'Marked moments:\n' + n.highlights.map(x => `- [${formatTime(x.time)}] ${x.text}`).join('\n') : '',
  ].filter(Boolean).join('\n');
}

const transcriptBlock = m => (m.transcript?.length
  ? 'Transcript:\n' + m.transcript.map(s => `[${formatTime(s.start)}] ${displaySpeaker(s.speaker, m.speakers)}: ${s.text}`).join('\n')
  : '');

export function buildAskContext(meetings, limitChars = 400000) {
  const ready = meetings.filter(m => m.notes).sort((a, b) => b.createdAt - a.createdAt);
  const blocks = ready.map(m => ({ notes: notesBlock(m), transcript: transcriptBlock(m) }));
  const size = () => blocks.reduce((n, b) => n + b.notes.length + (b.transcript ? b.transcript.length + 1 : 0) + 2, 0);
  for (let i = blocks.length - 1; i >= 0 && size() > limitChars; i--) blocks[i].transcript = '';
  while (blocks.length && size() > limitChars) blocks.pop();
  return blocks.map(b => (b.transcript ? `${b.notes}\n${b.transcript}` : b.notes)).join('\n\n');
}

export function buildAskPrompt(question, context) {
  return [
    'You answer questions about the user\'s own work meetings, using only the meeting notes and transcripts below.',
    'Meetings may be in English, Hindi or Hinglish. Answer in clear English, keeping names as written.',
    'Be specific: who, what, when. If the answer is not in the meetings, say so plainly; never guess.',
    'In sources, list the meeting id(s) the answer came from and, when you know it, the time (m:ss) in that meeting.',
    `Meetings:\n${context}`,
    `Question: ${question}`,
  ].join('\n\n');
}
