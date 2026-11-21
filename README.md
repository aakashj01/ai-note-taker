# Meeting Notes

A free web app for iPhone that records work meetings and turns them into notes: a **summary**, **key ideas**, and **to-dos with owners**. It understands **English, Hindi and Hinglish**, and tells speakers apart.

Everything (recordings, notes, your API key) stays on your phone. The AI is Google Gemini, called with your own free API key.

## Put it on your iPhone

1. Open the app's link in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**.
3. Open it from the home-screen icon.
4. Go to **Settings** (⚙︎), paste your Gemini API key, and tap **Save**.

### Get a free Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** and copy it.

> **Privacy:** on the free tier, Google may use what you upload to improve its products. Don't use it for meetings you aren't allowed to share with Google.

## Using it

- **Record**: tap Record, then Start recording. **Keep the app open**: iPhone stops web apps from using the mic in the background. The screen stays on while you record. If you leave the app, everything so far is saved; tap **Continue recording** when you're back.
- **Long meetings, or when you need to lock the phone**: record in the **Voice Memos** app instead, then tap **Import audio** here and pick the file (Voice Memos → ••• → Save to Files first).
- **Make notes**: after you stop, tap **Make notes**. It takes about a minute.
- **Name speakers**: the first time, you'll see each voice with a sample line. Type names so to-dos say "Rahul: send deck" instead of "Speaker 2".
- **Check a note**: tap ↗ next to any to-do or idea to jump to that moment in the transcript and hear it.
- **Fix mistakes**: tap any transcript line to correct it, or add context ("we meant the Q3 budget"), then **Regenerate notes**.
- **Share**: sends the notes as text to WhatsApp, Mail, Notes, etc.

## Free tier limits

Each meeting uses **one** Gemini request (plus one for each Regenerate). The free tier has a daily request limit per Google project (it resets at midnight Pacific time) and a per-minute limit. Check your current numbers in AI Studio. If you hit the limit, the app keeps your recording; try again later, or switch to a "flash-lite" model in Settings (it usually has a higher daily limit).

## For developers

Plain HTML/CSS/JS ES modules, no build step. Hosted as static files (GitHub Pages).

```bash
npm install
npm test            # unit tests (Node) + end-to-end test (Playwright/Chromium, fake mic, mocked Gemini)
```

Run locally: serve the folder over HTTP (e.g. `npx serve .`). The mic needs HTTPS or localhost.

| File | What it does |
|---|---|
| `js/recorder.js` | Records in parts; handles iOS interruptions; keeps the screen awake |
| `js/gemini.js`, `js/prompt.js` | Gemini API calls (inline audio ≤14 MB, Files API above), prompt and JSON schema |
| `js/notes.js` | Cleans up the AI's answer, speaker names, Markdown export |
| `js/db.js` | IndexedDB storage on the phone |
| `js/process.js` | Runs note-making jobs, recovers interrupted ones |
| `js/ui/*` | Screens |

Design and plan: `docs/`.
