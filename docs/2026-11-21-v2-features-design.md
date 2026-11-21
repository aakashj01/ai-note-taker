# Meeting Notes v2: Eight Features (Design)

Date: 2026-11-21 · Status: approved 2026-11-21 (with feature 9 added)

## Why

The owner uses the app for real work meetings and shares the results on WhatsApp. v2 makes notes easier to act on across meetings (to-dos, search, ask), fits notes to the kind of meeting, cuts repeated work (speaker names), lets the owner flag key moments, and protects against losing everything stored on the phone.

## Constraints that shape the design

- **Web app on iPhone.** It cannot write to a fixed file in iCloud Drive by itself, and it has no voiceprint technology.
- **Free Gemini tier.** Each AI call counts against the daily limit. Features that need no AI (search, to-dos, theme, backup) make no calls.
- **Notes stay in IndexedDB on the phone.** Older meetings must keep working, so every new field is optional.

## Features

### 1. Light / dark switch
- Settings gets a segmented control: **System · Light · Dark** (default System).
- The choice is stored on the phone and applied before the first paint, so there's no flash of the wrong theme.

### 2. Ask your meetings
- An **Ask** button on the Meetings screen opens a screen with a question box.
- The question goes to Gemini with all meetings that have notes, newest first: title, date, speaker names, summary, to-dos, key ideas and transcript. If they're too long, older transcripts are trimmed first.
- The answer is in English, quotes which meeting and time it came from, and taps through to that meeting. It says plainly when the meetings don't contain the answer.
- One AI call per question. Past questions aren't saved (YAGNI).

### 3. To-dos across meetings
- A **To-dos** button on the Meetings screen opens a list of every open to-do, grouped by meeting (newest first).
- Filter chips: **Everyone**, then each person by name (speaker names; unnamed speakers are grouped as "Unassigned / Speaker N").
- A "Show done" toggle. Ticking a to-do here updates its meeting. Each row links to its meeting.

### 4. Meeting types
- On the meeting page, a type picker above **Make notes**: **General · Client call · Stand-up · 1:1**. It can be changed later, then **Regenerate notes**.
- Summary, to-dos and key ideas stay for every type. Each type adds its own sections, rendered and copyable like the others:
  - **Stand-up:** one section per person with Done / Doing / Blocked.
  - **Client call:** Client asks, Decisions, Risks or concerns, Next steps.
  - **1:1:** Topics, Feedback, Commitments.
- Implemented as one optional `extra_sections: [{ title, items[] }]` field in the AI output, so the UI and copy work the same for any type.

### 5. Remember people (honest version)
- The app can't recognise voices across meetings. What it does instead:
  - A **People** list grows automatically from names the owner types on the Who spoke? screen.
  - When making notes, the AI gets that list and is told to use a real name only when it's clear from what was said (e.g. "Rahul, can you…", introductions), otherwise "Speaker N".
  - The Who spoke? screen pre-fills those guesses and offers the known people as one-tap suggestions.
  - Meetings of the same type remember the last mapping as a starting suggestion (e.g. stand-ups usually have the same people).
- The owner always confirms. Guesses can be wrong, and the screen says so.

### 6. Search
- A search field under the large "Meetings" title, iOS style.
- Matches title, summary, to-dos, key ideas, extra sections, transcript and speaker names. Case-insensitive, and works for Hinglish in Roman script.
- Results show the matching snippet with the match highlighted. No AI call.

### 7. Bookmark moments
- A **Mark** button (flag) beside Pause while recording. Each tap saves the current meeting time and briefly confirms with a toast and a tick on the waveform.
- The AI is told the marked times and returns `highlights: [{ time, text }]`, a one-line note of what was said at each mark.
- The meeting page shows **Marked moments** at the top. Each has a play button and the line, and is copyable.
- Marks also work on recordings continued after an interruption (they're stored as meeting time).

### 8. Backup and restore
- Settings → **Back up now** builds a single file, `meeting-notes-backup.json`, always with the same name, and opens the iPhone share sheet. Choose **Save to Files → iCloud Drive**.
- When a file with that name is already there, iOS asks **Replace** or Keep both. Choose Replace, and it's the same single backup file. A web app can't overwrite it silently; iOS always asks.
- Toggle **Include recordings** (default on; makes the file much bigger). Without it, notes and transcripts only.
- **Restore from backup** picks the file and merges: meetings already on the phone (same id) are kept; new ones are added. Settings (API key) aren't included in the backup, for safety.
- Settings shows "Last backup: <date>" as a reminder.

### 9. API usage bar and request log
- Gemini doesn't tell browser apps how much free quota is left, so the app counts its own requests. Settings → **API usage** shows, for each model used today, a bar of "requests today / daily limit". The daily limit is a number the owner sets (default 20). It also shows tokens used today and when the count resets (midnight Pacific, shown in local time).
- Settings → **API log** opens a terminal-style screen, monospace on black.
  - Each request is one line: `→ POST model:method  (audio 85 KB)`. Its result is one line: `← 200  8.1 s  in 2,410 / out 612 tokens`. Errors are shown in red with Google's message.
  - Tap an entry to expand the request (prompt text, settings, audio shown as size only) and the response (answer text, usage).
  - **Copy log** and **Clear** buttons. Keeps the last 200 entries. The API key is never logged.
- Implemented by wrapping `fetch` for every Gemini call, so all features (notes, regenerate, ask, model list) are logged the same way.

## Non-goals

- Real voice recognition, automatic background backups, syncing between devices, saving Ask history.

## Build order

Theme → Search → To-dos screen → Backup/restore → API log & usage → Bookmarks → Meeting types → People → Ask. Cheapest and no-AI first; each ships on its own with tests.
