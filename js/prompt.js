// What we ask Gemini for, and the JSON shape it must answer in.
import { formatTime } from './notes.js';

const RULES = `Language rules:
- The meeting is in English, Hindi, or Hinglish (both mixed, often in one sentence).
- Transcript text: write exactly what was said, in Roman (Latin) script. Keep Hinglish as Hinglish. Do NOT translate and do NOT use Devanagari.
- Notes (summary, key ideas, to-dos): write in clear English. Keep Hindi-only terms and people's names as said, in Roman script.
- If a stretch of speech cannot be understood, write [unclear] in the transcript rather than guessing.

Accuracy rules:
- Never invent to-dos, decisions, owners, or dates. Only include what was actually said.
- A to-do needs someone committing or being asked to do something. owner_speaker is that person's speaker label; leave it empty if unclear. due is only filled when a time was said (e.g. "Friday", "end of month").

Speakers:
- Label distinct voices "Speaker 1", "Speaker 2", ... in order of first speaking. Use the same label for the same voice throughout.

Times:
- All times (start, end, source) are in meeting time, formatted mm:ss or hh:mm:ss. "source" is when the idea or to-do was said.`;

const OUTPUT = `Return JSON with:
- summary: 3-6 sentence summary of the meeting.
- key_ideas: the main ideas, decisions and points discussed.
- todos: action items.
- transcript: segments in order, a new segment at each change of speaker (split long turns at ~30 s).`;

export function buildPrompt({ parts, context, notesOnly = false }) {
  const partLines = parts.length > 1
    ? `The audio comes in ${parts.length} parts because recording was interrupted. ` +
      parts.map((p, i) => `Part ${i + 1} starts at ${formatTime(p.startOffset)}`).join('; ') +
      ' of meeting time. Add each part\'s start time to times inside that part. Gaps between parts are interruptions, not silence.'
    : 'The audio is one continuous recording starting at 0:00.';
  return [
    'You are a careful meeting note-taker for a work meeting.',
    partLines,
    RULES,
    context ? `Extra context from the person who recorded this (trust it over what you hear):\n${context}` : '',
    notesOnly ? OUTPUT.replace(/\n- transcript:.*$/, '') + '\nDo not include a transcript.' : OUTPUT,
  ].filter(Boolean).join('\n\n');
}

export function buildRegeneratePrompt({ transcriptText, context }) {
  return [
    'You are a careful meeting note-taker. Below is a corrected transcript of a work meeting, already checked by the person who recorded it. Re-write the notes from it.',
    RULES,
    context ? `Extra context from the person who recorded this (trust it over the transcript):\n${context}` : '',
    `Return JSON with:
- summary: 3-6 sentence summary of the meeting.
- key_ideas: the main ideas, decisions and points discussed (source = the [m:ss] time it was said).
- todos: action items. owner_speaker must be a label like "Speaker 2" (see the name list), not a name.`,
    `Transcript:\n${transcriptText}`,
  ].filter(Boolean).join('\n\n');
}

const S = { type: 'STRING' };
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: S,
    key_ideas: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: S, source: S }, required: ['text'] } },
    todos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: S, owner_speaker: S, due: S, source: S }, required: ['text'] } },
    transcript: { type: 'ARRAY', items: { type: 'OBJECT', properties: { start: S, end: S, speaker: S, text: S }, required: ['start', 'speaker', 'text'] } },
  },
  required: ['summary', 'key_ideas', 'todos', 'transcript'],
  propertyOrdering: ['transcript', 'summary', 'key_ideas', 'todos'],
};

// Used for "Regenerate notes" and as the fallback when a long meeting's answer gets cut off.
export const NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: S,
    key_ideas: RESPONSE_SCHEMA.properties.key_ideas,
    todos: RESPONSE_SCHEMA.properties.todos,
  },
  required: ['summary', 'key_ideas', 'todos'],
  propertyOrdering: ['summary', 'key_ideas', 'todos'],
};
