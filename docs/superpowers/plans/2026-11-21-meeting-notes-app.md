# AI Meeting Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A free, installable iPhone web app that records (or imports) work meetings and uses the owner's Gemini key to produce a summary, key ideas, owned to-dos, and a speaker-labelled Hinglish transcript, all stored on the phone.

**Architecture:** Static site, no build step: plain ES modules in the browser. Pure logic (notes parsing, prompt, Gemini client, recorder state) lives in small modules with injected dependencies, so it is unit-tested in Node. IndexedDB holds meetings, audio parts, and settings. A service worker caches the app shell for home-screen use.

**Tech Stack:** Vanilla JS (ES2022 modules), HTML, CSS, IndexedDB, MediaRecorder, Screen Wake Lock, Gemini REST API (`generativelanguage.googleapis.com/v1beta`). Tests: `node --test` with `fake-indexeddb` (only devDependency), plus a Playwright e2e using the preinstalled `require('playwright')`.

**Spec:** `docs/2026-11-21-meeting-notes-app-design.md`

## Global Constraints

- Runs in iPhone Safari and as a home-screen web app. No backend, no accounts, no paid services.
- Gemini API key is entered by the owner in Settings and stored only in IndexedDB. Never hard-coded, never committed.
- Settings shows: "Free Gemini tier: Google may use uploaded audio to improve its products."
- Default model `gemini-2.5-flash`, editable in Settings.
- Notes are in English. Hindi terms and names stay as said, in Roman script. Transcript text is Roman-script Hinglish as spoken, never translated, never Devanagari.
- The prompt forbids inventing to-dos or decisions, and marks unclear speech `[unclear]`.
- Audio is never deleted except by an explicit "Delete meeting".
- Recording at `audioBitsPerSecond: 32000`, `timeslice: 5000` ms.
- Inline-audio limit: send inline when total audio bytes ≤ 14 MB, otherwise use the Files API.
- HTTPS hosting (GitHub Pages).

## Review Focus

1. App backgrounded or screen locked mid-recording: the audio captured so far is saved as a finished part, the meeting stays "recording", and on return a "Continue recording" button starts a new part. The timeline shows a gap. (Test in Task 4.)
2. Gemini returns HTTP 429/500, or JSON that is truncated or missing fields: meeting status becomes `failed` with the error text, audio is kept, and Retry works. (Tests in Tasks 2 and 3.)
3. Meeting over 14 MB of audio, or a Files API file still `PROCESSING`: the upload path polls until `ACTIVE` (max 60 tries, 2 s apart), then generates. (Test in Task 3.)
4. No API key set: the record and import buttons still work, and processing shows "Add your Gemini key in Settings" instead of calling the network. (Test in Task 5 e2e.)
5. Model output with a `source` time past the end, an unknown speaker label, or a missing `due`: normalised (time clamped, label kept, due `null`), and the UI renders without crashing. (Test in Task 2.)

---

## File Structure

```
index.html                 app shell, <main id="app">, loads js/app.js
styles.css                 light/dark tokens, mobile layout
manifest.webmanifest       name "Meeting Notes", display standalone, icons
sw.js                      cache-first app shell
icons/icon-192.png, icon-512.png, apple-touch-icon.png
js/db.js                   IndexedDB wrapper
js/notes.js                pure: time parsing, normalise model output, speaker names, markdown
js/prompt.js               pure: prompt text + response schema
js/gemini.js               Gemini client (fetch injected)
js/recorder.js             multi-part recorder + wake lock (browser APIs injected)
js/app.js                  hash router + screen mounting
js/ui/library.js, record.js, meeting.js, speakers.js, settings.js
tests/unit/*.test.js, tests/e2e/smoke.test.js
package.json, .gitignore, README.md
```

## Data model (shared by all tasks)

```js
Meeting = {
  id: string, title: string, createdAt: number /* ms */,
  status: 'recording'|'recorded'|'processing'|'ready'|'failed',
  error: string|null,
  parts: [{ id: string, mimeType: string, startOffset: number /* s, meeting time */, duration: number /* s */ }],
  speakers: { [label: string]: string /* display name, '' = unnamed */ },
  context: string,                 // owner's correction notes
  transcript: [{ start: number, end: number, speaker: string, text: string }],
  notes: { summary: string, keyIdeas: [{ text, source }], todos: [{ text, owner, due, source, done: boolean }] } | null
}
```
`source`, `start`, `end` are seconds in meeting time. Audio bytes are stored separately as `{ partId, seq, blob }` chunks.

---

### Task 1: Project scaffold + storage

**Files:**
- Create: `package.json` (`"type":"module"`, scripts `test:unit` = `node --test tests/unit`, `test:e2e` = `node --test tests/e2e`), `.gitignore` (`node_modules`), `js/db.js`
- Test: `tests/unit/db.test.js` (imports `fake-indexeddb/auto`)

**Interfaces:**
- Produces (`js/db.js`): `openDb(): Promise<IDBDatabase>`, `saveMeeting(m: Meeting): Promise<void>`, `getMeeting(id): Promise<Meeting|undefined>`, `listMeetings(): Promise<Meeting[]>` (newest first), `deleteMeeting(id): Promise<void>` (also deletes its chunks), `appendChunk(partId, seq, blob): Promise<void>`, `getPartBlob(partId, mimeType): Promise<Blob>` (chunks in `seq` order), `getSetting(key, fallback)`, `setSetting(key, value)`. DB name `meeting-notes`, version 1, stores `meetings` (key `id`), `chunks` (key `[partId, seq]`, index `partId`), `settings`.

- [ ] Step 1: `git init`, write `package.json`, `npm i -D fake-indexeddb`.
- [ ] Step 2: Write failing tests: `saves and lists meetings newest first`; `getPartBlob joins chunks in seq order` (append seq 1 then 0, expect text `"ab"`); `deleteMeeting removes its chunks`; `getSetting returns fallback when unset`.
- [ ] Step 3: Run `npm run test:unit`. Expected: FAIL, module not found.
- [ ] Step 4: Implement `js/db.js`.
- [ ] Step 5: Run `npm run test:unit`. Expected: PASS.
- [ ] Step 6: Commit `feat: IndexedDB storage for meetings, audio chunks, settings`.

### Task 2: Notes logic

**Files:** Create `js/notes.js`. Test `tests/unit/notes.test.js`.

**Interfaces:**
- Produces: `parseTime(s: string|number): number` (`"01:02:03"`→3723, `"4:05"`→245, number passes through, junk→0); `normalizeResult(raw: unknown, durationSec: number): { transcript, notes, speakers: string[] }` (throws `Error('Bad AI response: …')` when `raw` isn't an object, or has no `summary` and no `transcript`); `displaySpeaker(label, speakers)` (name if set, else label); `toMarkdown(meeting): string`.

- [ ] Step 1: Failing tests:
  - `parseTime` cases above.
  - `normalizeResult clamps source beyond duration`: `source:"99:00"`, duration 600 → `600`.
  - `missing due becomes null`, `missing todos becomes []`, `done defaults false`.
  - `speakers lists unique labels in first-appearance order`.
  - `throws on string input` and `throws on {}`.
  - `toMarkdown` output contains `## Summary`, `## To-dos`, `- [ ] Rahul: send deck (due Fri)`, `## Key ideas`, using names from `speakers`.
- [ ] Step 2: Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS.
- [ ] Step 5: Commit `feat: normalise AI output, speaker names, markdown export`.

### Task 3: Prompt + Gemini client

**Files:** Create `js/prompt.js`, `js/gemini.js`. Test `tests/unit/gemini.test.js` (a fake `fetch` records calls and returns canned `Response`s).

**Interfaces:**
- Consumes: `normalizeResult` (Task 2).
- Produces:
  - `buildPrompt({ parts, context }): string`. States the language rules from Global Constraints, the no-invention rule, `[unclear]`, and that part *n* starts at `mm:ss` of meeting time (gaps are interruptions). Asks for times as `mm:ss` or `hh:mm:ss` in meeting time, and speakers as `Speaker 1`, `Speaker 2`….
  - `buildRegeneratePrompt({ transcriptText, context }): string`. Same rules; the input is the corrected transcript rather than audio.
  - `RESPONSE_SCHEMA`: an OpenAPI-subset object. `transcript[{start,end,speaker,text}]`, `summary`, `key_ideas[{text,source}]`, `todos[{text,owner_speaker,due,source}]`. Required: `summary`, `key_ideas`, `todos`, `transcript`.
  - `createGemini({ apiKey, model, fetch })` → `{ processAudio(parts: {blob, mimeType, startOffset}[], context): Promise<raw>, regenerate(transcriptText, context): Promise<raw> }`. Uses `POST {base}/models/{model}:generateContent` with header `x-goog-api-key` and `generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }`. Returns parsed JSON from `candidates[0].content.parts[0].text`. Errors throw `GeminiError(message, status)`; 429 gives the message `"Gemini free limit reached, try again in a minute"`.
  - Upload path (total > 14 MB): resumable Files API. Start with `POST https://generativelanguage.googleapis.com/upload/v1beta/files` (headers `X-Goog-Upload-Protocol: resumable`, `X-Goog-Upload-Command: start`, `X-Goog-Upload-Header-Content-Length`, `X-Goog-Upload-Header-Content-Type`), then upload to the returned `x-goog-upload-url` with `X-Goog-Upload-Command: upload, finalize` and `X-Goog-Upload-Offset: 0`. Poll `GET {base}/{file.name}` until `state === 'ACTIVE'` (2 s, max 60 tries; `FAILED` throws). Reference the file as `file_data: { mime_type, file_uri }`.
- [ ] Step 1: Failing tests: `small audio is sent inline as base64`; `large audio uses upload then polls until ACTIVE` (first poll `PROCESSING`, second `ACTIVE`; inject `sleep` as an option so tests don't wait); `429 throws GeminiError with friendly message`; `non-JSON candidate text throws GeminiError`; `prompt mentions part start offsets and Roman script`; `regenerate sends no audio parts`.
- [ ] Step 2: Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS.
- [ ] Step 5: Commit `feat: Gemini client with inline and Files API upload`.

### Task 4: Recorder

**Files:** Create `js/recorder.js`. Test `tests/unit/recorder.test.js` (fake `MediaRecorder` class, fake `getUserMedia`, fake `wakeLock`, fake document with `visibilityState` and an event emitter).

**Interfaces:**
- Consumes: `appendChunk` (Task 1), passed in as `onChunk` so the recorder is storage-agnostic.
- Produces: `createRecorder({ getUserMedia, MediaRecorder, wakeLock, doc, onChunk(partId, seq, blob), onPartEnd(part), onInterrupted(), now })` → `{ start(meetingTimeOffset): Promise<void>, pause(), resume(), stop(): Promise<void>, state: 'idle'|'recording'|'paused'|'interrupted' }`. MIME choice is `audio/mp4` if `MediaRecorder.isTypeSupported`, else `audio/webm`. Each `start` creates a new part with id `crypto.randomUUID()`. When `doc` turns `hidden` while recording, it stops the current recorder (flushing the last chunk), calls `onPartEnd`, sets `interrupted`, and calls `onInterrupted`. Wake lock is acquired on start and re-acquired on `visible`.
- [ ] Step 1: Failing tests: `chunks are delivered with increasing seq`; `stop ends part with duration from now()`; `going hidden mid-recording ends the part and sets interrupted`; `start after interrupt creates a new part with the given offset`; `wake lock requested on start and released on stop`.
- [ ] Step 2: Run, expect FAIL. Step 3: implement. Step 4: run, expect PASS.
- [ ] Step 5: Commit `feat: multi-part recorder with interruption handling`.

### Task 5: UI, PWA shell, end-to-end test

**Files:** Create `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/*` (generate the PNGs with Playwright from an inline SVG: a mic glyph on a solid colour), `js/app.js`, `js/ui/*.js`. Test `tests/e2e/smoke.test.js`.

**Interfaces:** Consumes all of Tasks 1–4. Routes: `#/` library, `#/record`, `#/m/{id}` meeting, `#/m/{id}/speakers`, `#/settings`.

Screen behaviour:
- **Library:** meeting cards (title, date, duration, status chip); buttons **Record** and **Import audio** (`<input type=file accept="audio/*">`, creating a one-part meeting); Settings gear.
- **Record:** large timer, Pause/Resume, Stop. On interruption it shows "Recording paused because the app was closed" and a big **Continue recording** button. Stop sets status `recorded` and goes to the meeting page.
- **Meeting:** editable title. When status is `recorded`/`failed` it shows a **Make notes** button and any error. When `processing` it shows a spinner, and the work continues if the screen is re-rendered. When `ready` it shows Summary, To-dos (checkboxes persist `done`; owner shows the display name), and Key ideas, each with a ↗ that opens the transcript at `source` and plays the audio from there (map meeting time to part + offset). Below: a collapsed Transcript (segments editable inline), an "Add context" textarea, a **Regenerate notes** button, and **Share** (`navigator.share` with Markdown, falling back to clipboard). Also **Name speakers** and **Delete meeting** (confirm).
- **Speakers:** one row per label: a sample line from that speaker, ▶ to play it, and a name input. Shown automatically after the first successful processing.
- **Settings:** API key (password field, show/hide), model, privacy line, a link to `https://aistudio.google.com/apikey`.
- Processing without a key routes to an inline message: "Add your Gemini key in Settings".

- [ ] Step 1: Write `tests/e2e/smoke.test.js`. It serves the repo with a tiny Node static server, launches Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`, and routes `generativelanguage.googleapis.com/**` to a canned JSON reply (2 speakers, 1 to-do, 1 idea). Tests: `no key shows settings prompt`; `record 3s → stop → make notes → summary, to-do and idea visible`; `naming Speaker 2 "Rahul" updates the to-do owner`; `reload keeps the meeting`; `layout has no horizontal scroll at 390px width`.
- [ ] Step 2: Run `npm run test:e2e`, expect FAIL.
- [ ] Step 3: Implement the shell, screens, manifest (`display: standalone`, `theme_color`), `apple-mobile-web-app-capable` meta, `sw.js`, and icons.
- [ ] Step 4: Run `npm run test:unit && npm run test:e2e`, expect PASS. Take a 390×844 screenshot of the meeting page and check it.
- [ ] Step 5: Commit `feat: app screens, PWA shell, e2e smoke test`.

### Task 6: README, GitHub repo, Pages

**Files:** Create `README.md`: what it does, the iPhone install steps (open in Safari → Share → Add to Home Screen), getting a Gemini key, the Voice Memos tip, the privacy note, and how to run the tests.

- [ ] Step 1: Write the README and commit `docs: README`.
- [ ] Step 2: Push to the owner's new GitHub repo (`git push -u origin main`).
- [ ] Step 3: Owner enables Pages (Settings → Pages → Deploy from branch `main`, root). Verify the site loads over HTTPS.
