// End-to-end: real Chromium with a fake microphone, Gemini replaced by a canned reply.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');
const ROOT = new URL('../..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const CANNED = {
  transcript: [
    { start: '00:00', end: '00:02', speaker: 'Speaker 1', text: 'Chalo, launch ki baat karte hain' },
    { start: '00:02', end: '00:04', speaker: 'Speaker 2', text: 'Main Friday tak deck bhej dunga' },
  ],
  summary: 'The team discussed moving the launch date.',
  key_ideas: [{ text: 'Launch moves to next month', source: '00:01' }],
  todos: [{ text: 'Send the deck', owner_speaker: 'Speaker 2', due: 'Friday', source: '00:02' }],
};

let server, browser, page, base, geminiCalls = 0;

before(async () => {
  server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || (path === '/' ? 'text/html' : 'application/octet-stream') });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  await context.route('https://generativelanguage.googleapis.com/**', route => {
    geminiCalls++;
    const sent = route.request().postData() || '';
    if (/team stand-up/.test(sent)) {
      const reply = { ...CANNED, extra_sections: [{ title: 'Speaker 2', items: ['Doing: the investor deck'] }] };
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] })}\r\n\r\n` });
    }
    route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }] } }] })}\r\n\r\n` +
      `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(CANNED) }] } }] })}\r\n\r\n` });
  });
  page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => { throw e; });
  await page.goto(base);
});

after(async () => { await browser?.close(); server?.close(); });

async function recordFor(ms) {
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Stop' }).waitFor();
  await page.waitForTimeout(ms);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Make notes' }).waitFor();
}

test('no key shows settings prompt and does not call Gemini', async () => {
  await recordFor(1500);
  await page.getByRole('button', { name: 'Make notes' }).click();
  await page.getByText('Add your Gemini key in Settings').waitFor();
  assert.equal(geminiCalls, 0);
});

test('record → stop → make notes shows summary, to-do and idea', async () => {
  await page.goto(base + '#/settings');
  await page.getByText('App version 12').waitFor();
  await page.getByLabel('Gemini API key').fill('test-key');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Back' }).click();
  await recordFor(3000);
  await page.getByRole('button', { name: 'Make notes' }).click();
  // first successful run goes to the speaker naming screen
  await page.getByLabel('Name for Speaker 2').waitFor();
  assert.equal(geminiCalls, 1);
  await page.getByRole('button', { name: 'Save names' }).click();
  await page.getByText('The team discussed moving the launch date.').waitFor();
  await page.getByText('Launch moves to next month').waitFor();
  await page.getByText('Send the deck').waitFor();
});

test('naming Speaker 2 "Rahul" updates the to-do owner', async () => {
  await page.getByRole('link', { name: 'Name speakers' }).click();
  await page.getByLabel('Name for Speaker 2').fill('Rahul');
  await page.getByRole('button', { name: 'Save names' }).click();
  await page.locator('.todo', { hasText: 'Send the deck' }).getByText('Rahul').waitFor();
});

test('each section can be copied on its own for WhatsApp', async () => {
  await page.getByRole('button', { name: 'Copy summary' }).click();
  await page.getByText('Summary copied').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '*Summary*\nThe team discussed moving the launch date.');
  await page.getByRole('button', { name: 'Copy to-dos' }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^\*To-dos\*\n☐ Rahul: Send the deck \(due Friday\)$/);
  await page.getByRole('button', { name: 'Copy key ideas' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '*Key ideas*\n• Launch moves to next month');
});

test('search finds a meeting by a word in its notes', async () => {
  await page.goto(base);
  await page.getByRole('searchbox', { name: 'Search meetings' }).fill('deck');
  await page.locator('.meeting-card mark', { hasText: 'deck' }).first().waitFor();
  await page.getByRole('searchbox', { name: 'Search meetings' }).fill('zebra');
  await page.getByText('No results for “zebra”').waitFor();
  await page.getByRole('searchbox', { name: 'Search meetings' }).fill('');
  await page.goBack().catch(() => {});
  await page.goto(base + '#/m/' + (await page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('meeting-notes'); q.onsuccess = () => r(q.result); });
    return new Promise(r => { const q = db.transaction('meetings').objectStore('meetings').getAll(); q.onsuccess = () => r(q.result.find(m => m.notes).id); });
  })));
  await page.getByText('The team discussed moving the launch date.').waitFor();
});

test('to-dos screen lists open to-dos, filters by person, ticks through to the meeting', async () => {
  await page.goto(base);
  await page.getByRole('link', { name: 'To-dos' }).click();
  await page.getByText('Send the deck').waitFor();
  await page.getByRole('radio', { name: 'Rahul' }).check();
  await page.getByText('Send the deck').waitFor();
  await page.getByRole('checkbox', { name: 'Done: Send the deck' }).check();
  await page.getByRole('switch', { name: 'Show done' }).click();
  await page.locator('.todo.done', { hasText: 'Send the deck' }).waitFor();
  await page.locator('.todo-meeting-link').first().click();
  assert.equal(await page.getByRole('checkbox', { name: 'Done: Send the deck' }).isChecked(), true);
  await page.getByRole('checkbox', { name: 'Done: Send the deck' }).uncheck();
});

test('backup downloads one fixed-name file, and restoring it keeps existing meetings', async () => {
  await page.goto(base + '#/settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up now' }).click()]);
  assert.equal(download.suggestedFilename(), 'meeting-notes-backup.json');
  const file = await download.path();
  await page.getByText(/Last backup:/).waitFor();
  await page.locator('#restore-file').setInputFiles(file);
  await page.getByText(/Restored 0 meetings \(2 already on this phone\)/).waitFor();
  await page.goto(base + '#/m/' + (await page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('meeting-notes'); q.onsuccess = () => r(q.result); });
    return new Promise(r => { const q = db.transaction('meetings').objectStore('meetings').getAll(); q.onsuccess = () => r(q.result.find(m => m.notes).id); });
  })));
  await page.getByText('The team discussed moving the launch date.').waitFor();
});

test('reload keeps the meeting', async () => {
  await page.reload();
  await page.getByText('The team discussed moving the launch date.').waitFor();
  await page.goto(base);
  assert.equal(await page.locator('.meeting-card').count(), 2);
});

test('layout has no horizontal scroll at 390px width', async () => {
  for (const hash of ['#/', '#/settings']) {
    await page.goto(base + hash);
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), hash);
  }
  await page.goto(base + '#/');
  const cards = page.locator('.meeting-card');
  await cards.first().click();
  await page.getByRole('button', { name: 'Share' }).waitFor();
  await page.locator('details.transcript summary').click();
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 390), 'meeting');
});

test('a recording cut off by a page reload can be continued as the same meeting', async () => {
  await page.goto(base + '#/record');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Stop' }).waitFor();
  await page.getByRole('button', { name: 'Mark this moment' }).click();
  await page.getByText(/Marked 0:0/).waitFor();
  await page.waitForTimeout(6500); // at least one 5 s chunk saved
  await page.reload(); // what iOS does to a backgrounded home-screen app
  await page.getByRole('button', { name: /Continue recording/ }).click();
  await page.getByRole('button', { name: 'Stop' }).waitFor();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByText(/recorded in 2 parts/).waitFor();
  await page.getByText('1 marked moment').waitFor();
  await page.goto(base);
  assert.equal(await page.locator('.meeting-card').count(), 3);
});

test('theme: choosing Dark sets data-theme=dark and survives reload', async () => {
  await page.goto(base + '#/settings');
  await page.getByRole('radio', { name: 'Dark' }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(bg, 'rgb(0, 0, 0)');
  await page.goto(base + '#/settings');
  await page.getByRole('radio', { name: 'System' }).check();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
});

test('settings shows today\'s API usage, and the log shows requests without the key', async () => {
  await page.goto(base + '#/settings');
  await page.getByText('1 of 20 requests').waitFor();
  await page.getByRole('link', { name: 'API log' }).click();
  await page.locator('.term').getByText('→ POST gemini-flash-latest:streamGenerateContent').first().waitFor();
  await page.locator('.term').getByText(/← 200/).first().waitFor();
  const all = await page.locator('.term').innerText();
  assert.doesNotMatch(all, /test-key/);
  await page.locator('.term-entry summary').first().click();
  await page.locator('.term').getByText(/\[audio .* KB audio\/(mp4|webm)\]/).first().waitFor();
});

test('meeting type: choosing Stand-up and regenerating adds a section per person', async () => {
  await page.goto(base + '#/m/' + (await page.evaluate(async () => {
    const db = await new Promise(r => { const q = indexedDB.open('meeting-notes'); q.onsuccess = () => r(q.result); });
    return new Promise(r => { const q = db.transaction('meetings').objectStore('meetings').getAll(); q.onsuccess = () => r(q.result.find(m => m.notes).id); });
  })));
  await page.getByRole('radio', { name: 'Stand-up' }).check();
  await page.getByRole('button', { name: 'Regenerate notes' }).click();
  await page.getByRole('heading', { name: 'Rahul' }).waitFor();
  await page.getByText('Doing: the investor deck').waitFor();
  await page.getByRole('button', { name: 'Copy rahul' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '*Rahul*\n• Doing: the investor deck');
  await page.reload();
  assert.equal(await page.getByRole('radio', { name: 'Stand-up' }).isChecked(), true);
});
