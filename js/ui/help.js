// "How to use the app": one collapsible section per feature, short steps in plain words.
import { h, header, icon } from './dom.js';

const GUIDE = [
  ['Set up', 'gear', [
    'Get a free Gemini API key at aistudio.google.com/apikey (sign in with Google, tap Create API key, copy it).',
    'In this app, open Settings (gear, top right of Meetings), paste the key under Gemini, and tap Save.',
    'Model: gemini-flash-lite-latest is the most reliable on the free tier. Tap Browse to see every model your key can use.',
    'Add the app to your Home Screen: in Safari tap Share, then Add to Home Screen. Open it from the icon from then on.',
  ]],
  ['Record a meeting', 'waveform', [
    'On Meetings, tap the big red button, then tap it again on the next screen to start.',
    'The red waveform moves when the phone hears you. If it stays flat, check the microphone isn’t covered.',
    'Keep the app open while recording. iPhone stops web apps from recording in the background or when the phone locks. The screen stays on by itself.',
    'Pause with the pause button. Tap the red square to stop and save.',
    'If the app was closed by accident, everything recorded so far is kept. Open Record again and tap Continue recording to carry on in the same meeting.',
    'If your phone asks for the microphone each time, open the site in Safari, tap aA › Website Settings › Microphone › Allow.',
  ]],
  ['Import from Voice Memos', 'import', [
    'Best for long meetings, or when you need to lock the phone: Voice Memos keeps recording in the background.',
    'In Voice Memos, tap the recording › ••• › Save to Files.',
    'In this app, tap Import on the Meetings screen and pick the file.',
  ]],
  ['Make notes', 'sparkle', [
    'Open a meeting and tap Make notes. It takes from a few seconds to a couple of minutes. Keep the app open until the notes appear.',
    'You get a summary, to-dos (with who and when, if it was said), key ideas, and a transcript in Hinglish as it was spoken.',
    'If Gemini is busy, the app waits and tries again, then switches to the lighter model by itself. Your recording is never lost.',
    'Each Make notes uses one request from your free daily limit.',
  ]],
  ['Meeting types', 'checklist', [
    'At the top of a meeting, choose General, Client call, Stand-up or 1:1 before tapping Make notes.',
    'Client call adds Client asks, Decisions, Risks and Next steps. Stand-up adds Done, Doing and Blocked for each person. 1:1 adds Topics, Feedback and Commitments.',
    'Changed your mind? Pick another type, then tap Regenerate notes.',
  ]],
  ['Name speakers', 'people', [
    'After the first notes, the app asks Who spoke?. Tap play to hear each voice, then type or tap a name.',
    'Names you’ve used before appear as buttons. The app may pre-fill a name when someone was called by name in the meeting, or use last time’s names for the same meeting type. Check them: they can be wrong.',
    'Change names any time from the meeting page › Name speakers.',
  ]],
  ['Mark important moments', 'flag', [
    'While recording, tap the flag button whenever something important is said. A number shows how many you’ve marked.',
    'The notes then start with Marked moments: one line on what was said at each mark, with a play button.',
  ]],
  ['Check and fix notes', 'play', [
    'Tap the small waveform icon next to any to-do or idea to jump to that moment in the transcript and hear it.',
    'Tap any transcript line to correct it, or add context under Something wrong? (for example, “we meant the Q3 budget”).',
    'Regenerate notes rewrites the notes from your corrected transcript. Re-listen to the audio starts again from the recording.',
  ]],
  ['Copy and share', 'copy', [
    'Each section (Summary, To-dos, Key ideas and the extra ones) has its own Copy button. Paste straight into WhatsApp or any chat: headings come out bold.',
    'The share button at the top right of a meeting sends all the notes at once.',
  ]],
  ['Download a recording', 'import', [
    'Open a meeting, scroll to Recording and tap Download recording. This works for every meeting still on this phone, including older ones.',
    'Choose Save to Files to keep the audio in iCloud Drive, or send it with AirDrop, WhatsApp or Mail. The file is named after the meeting.',
    'If the recording was interrupted and continued, it’s saved in parts: each part has its own button.',
    'If iPhone says the file is ready, tap the button once more to save it.',
  ]],
  ['To-dos', 'checklist', [
    'Tap To-dos at the bottom of Meetings to see every open to-do from every meeting.',
    'Tap a name to see only that person’s to-dos. Turn on Show done to see finished ones.',
    'Tick a to-do here and it’s ticked in its meeting too. Tap a meeting’s title to open it.',
  ]],
  ['Search', 'waveform', [
    'Type in the search box under Meetings. It looks through titles, notes, to-dos, transcripts and names, and highlights where it matched.',
    'Search works offline and doesn’t use your Gemini limit.',
  ]],
  ['Ask your meetings', 'sparkle', [
    'Tap the sparkle button at the top of Meetings and type a question, like “What did Rahul promise last week?”.',
    'The answer lists which meetings it came from. Tap one to open it. If the meetings don’t say, it tells you so.',
    'Your saved notes and transcripts are sent to Gemini with the question. Each question uses one request.',
  ]],
  ['Back up and restore', 'import', [
    'Everything lives only on this phone. If the app is deleted, so are your meetings, so back up regularly.',
    'Settings › Backup › Back up now, then choose Save to Files › iCloud Drive. Use the same folder each time and tap Replace: you’ll always have one up-to-date backup file.',
    'Include recordings makes the file much bigger. Without it, you keep notes and transcripts only.',
    'If iPhone says the backup is ready, tap the button once more to save it.',
    'Restore from backup adds meetings that aren’t on this phone. It never overwrites ones that are, and a damaged file restores nothing.',
  ]],
  ['API usage and log', 'checklist', [
    'Settings › API usage shows how many requests this app made today for each model, against the daily limit you set.',
    'Google doesn’t tell apps your remaining quota, so set the limit to what AI Studio shows for your key. The count resets at midnight California time (about 1:30 pm in India).',
    'API log shows every request and answer, newest first. Tap one to see details. Your key and audio are never stored there.',
  ]],
  ['Appearance', 'gear', [
    'Settings › Appearance: System follows your phone. Light or Dark always uses that look.',
  ]],
  ['Troubleshooting', 'flag', [
    '“Gemini is busy”: Google’s servers are overloaded. Wait a minute and try again, or use gemini-flash-lite-latest.',
    '“Free limit reached”: you’ve used today’s requests. Try a different model in Settings, or wait for the reset.',
    '“Connection lost”: the app was closed or the internet dropped while working. Keep the app open and tap again.',
    'Not seeing the latest version? Close the app fully (swipe it away) and open it again. The version is shown at the bottom of Settings.',
    'Something odd? Settings › API log shows exactly what was sent and what came back.',
  ]],
];

export function renderHelp(root) {
  root.append(
    header('How to use', { large: true, back: '#/settings', backLabel: 'Settings' }),
    h('main', { class: 'page' },
      h('p', { class: 'section-foot', style: 'margin:0 4px 14px' }, 'Tap a topic to open it.'),
      h('div', { class: 'group help' }, GUIDE.map(([title, ic, steps], i) => h('details', { class: 'help-item', open: i === 0 },
        h('summary', { class: 'cell' },
          h('span', { class: 'help-icon' }, icon(ic, 20)),
          h('span', { class: 'cell-main' }, title),
          icon('chevron', 16)),
        h('ol', { class: 'help-steps' }, steps.map(s => h('li', {}, s))))))),
  );
}
