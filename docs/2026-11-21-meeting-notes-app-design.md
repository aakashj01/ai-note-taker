# AI Meeting Notes: Design

Date: 2026-11-21 · Status: draft, waiting for approval

## Intent

A free personal web app, used from the iPhone home screen, that records work meetings and turns them into notes. Meetings are in English, Hindi, and Hinglish (both languages mixed in one sentence). Most of the time the owner wants the notes, not a word-for-word script. A transcript is kept only so the owner can check or correct a part the AI got wrong.

## Goals

- Record a meeting on the iPhone, or import a recording made elsewhere (e.g. Voice Memos).
- Produce, for each meeting:
  1. **Summary**: a short paragraph.
  2. **Key ideas discussed**: bullets.
  3. **To-dos**: checkable items, each with an owner (speaker) and due date when one was mentioned.
- Handle English, Hindi, and Hinglish. Notes are written in English. Hindi-only terms and names are kept as said, in Roman script.
- Tell speakers apart ("Speaker 1", "Speaker 2"). The owner names each speaker once per meeting, and the notes then use the names.
- Each note item links to the moment it came from. Tapping it shows that part of the transcript and plays that part of the audio.
- The owner can fix the transcript or add context ("we meant the Q3 budget, not Q2") and regenerate the notes.
- Keep a list of past meetings, stored on the phone. Notes can be shared or copied as text.
- Costs nothing to run.

## Non-goals

- A polished word-for-word transcript, subtitles, or translation.
- Recognising the same speaker by voice across meetings.
- Accounts, sync between devices, or a backend server.
- Live notes during the meeting. Notes are made after recording stops.
- An App Store app.

## Anti-goals (a failure even if it "works")

- Losing a recording. A crash, interruption, or failed AI call must never lose audio.
- Notes that invent action items or decisions nobody said.
- Hinglish coming back as an English translation or in Devanagari script in the transcript, making it unreadable to check.

## Constraints

- **iPhone Safari / home-screen web app.**
- **No background recording.** iOS pauses a web app's microphone when the screen locks or another app opens. The app cannot change this. To handle it:
  - While recording, the app keeps the screen awake (Screen Wake Lock).
  - Audio is saved to the phone every few seconds, so an interruption loses nothing already captured.
  - When the owner returns, the app resumes and marks the gap in the timeline.
  - For meetings where the phone must be locked, record in Voice Memos (which records in the background) and import the file. Import is a first-class feature, not an afterthought.
- **Free.** Uses the owner's own free Google Gemini API key, pasted once into Settings and stored only on the phone. Free-tier rate limits are fine for a few meetings a day.
- **Privacy, accepted by the owner:** on Gemini's free tier, Google may use uploaded content to improve its products. Settings shows a one-line reminder of this.
- **Free static hosting.** Plain HTML/JS/CSS on a free static host (GitHub Pages or similar). HTTPS is required for the microphone.

## Approaches considered

| Approach | Trade-off | Chosen? |
|---|---|---|
| **Gemini API (free key)** for transcription, speakers, and notes in one model | Best free Hinglish handling and speaker labels. The free tier may use the data. | **Yes, picked by the owner** |
| Groq Whisper + a separate free AI for notes | Fast, good Hindi. No speaker labels. Hinglish sometimes translated or in Devanagari. | No |
| On-device Whisper in the browser | Private. Slow on an iPhone, weak Hinglish, no speakers. | No |

Decided outside the table: web app, not native (owner's choice). Notes after the meeting, not live (my call: simpler, and the owner didn't ask for live).

## How it works

1. **Record**: MediaRecorder on the mic (iOS gives AAC/MP4), with chunks saved to IndexedDB as they arrive. Big timer, pause/resume, stop. Or **Import** an audio file.
2. **Process**: upload the audio to the Gemini Files API, then make one request asking for structured JSON:
   - `transcript`: segments `{start, end, speaker, text}`, text in Roman script as spoken (Hinglish stays Hinglish)
   - `summary`, `key_ideas[]`, `todos[] {text, owner_speaker, due, source_start}`
   - each key idea also carries `source_start` so it can link to the transcript
   - The prompt forbids inventing items not said, and tells the model to mark unclear speech as `[unclear]`.
3. **Name speakers**: after processing, a short screen shows each speaker with a sample line to play back. The owner types names, which are swapped in locally. No new AI call is needed.
4. **Review**: the meeting page shows Summary, then To-dos (checkboxes), then Key ideas. Each item has a "source" tap that opens the transcript at that moment with audio playback. "Transcript" is collapsed at the bottom.
5. **Correct**: edit a transcript segment, or add a "context note", then "Regenerate notes". This sends the corrected transcript text (not the audio) back to Gemini.
6. **Library**: a list of meetings by date, plus delete and share/copy as Markdown.

Everything (audio, transcript, notes, settings) lives in IndexedDB on the phone. Failed AI calls keep the audio and offer "Retry".

```
┌─────────────────────────────┐
│ Weekly sync · 21 Nov · 42m  │
│ SUMMARY                     │
│ Team agreed to move launch… │
│ TO-DO                       │
│ ☐ Rahul: send deck · Fri  ↗ │
│ ☐ You: book venue         ↗ │
│ KEY IDEAS                   │
│ • Pricing stays at ₹499   ↗ │
│ ▸ Transcript                │
└─────────────────────────────┘
```

## Left to the builder

- The exact Gemini model ID (use the current best free-tier Flash model that accepts audio; make it a setting).
- Chunk size and how long meetings are handled (Files API supports multi-hour audio; test a 1-hour file).
- Visual styling: clean, readable, light and dark mode, big touch targets.
- Make it installable as a home-screen app (manifest, icon) with offline loading of the app shell.
- Hosting setup, done together with the owner at the end, since it needs their account on the host.
