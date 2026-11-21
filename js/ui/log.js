// Terminal-style list of every Gemini request and response.
import { listLogs, clearLogs } from '../db.js';
import { h, header, icon, toast, copyText } from './dom.js';

const time = t => new Date(t).toLocaleTimeString('en-GB', { hour12: false });
const pad = s => ' '.repeat(s.length + 3);

function extraOf(req) {
  const audio = JSON.stringify(req.body || '').match(/\[audio [^\]]+\]|\[upload [^\]]+\]/g);
  return audio ? `  (${audio.map(a => a.slice(1, -1)).join(', ')})` : '';
}

function lineOut(e) {
  const target = e.request.model ? `${e.request.model}:${e.request.action}` : e.request.action;
  return `→ ${e.request.method} ${target}${extraOf(e.request)}`;
}

function lineIn(e) {
  const secs = `${(e.ms / 1000).toFixed(1)} s`;
  if (!e.status) return `← network error  ${secs}  ${e.error || ''}`;
  const u = e.usage ? `  in ${e.usage.in.toLocaleString('en-IN')} / out ${e.usage.out.toLocaleString('en-IN')}${e.usage.thoughts ? ` / thinking ${e.usage.thoughts.toLocaleString('en-IN')}` : ''} tokens` : '';
  return `← ${e.status}  ${secs}${u}${e.error ? `  ${e.error}` : ''}`;
}

const asText = e => `[${time(e.at)}] ${lineOut(e)}\n${pad(time(e.at))}${lineIn(e)}`;

export async function renderLog(root) {
  const term = h('div', { class: 'term', role: 'log', 'aria-label': 'API log' });
  let logs = [];

  async function draw() {
    logs = await listLogs();
    term.replaceChildren(...(logs.length ? logs.map(e => {
      const t = time(e.at);
      const ok = e.status >= 200 && e.status < 300;
      return h('details', { class: 'term-entry' },
        h('summary', {},
          h('span', { class: 'term-time' }, `[${t}] `), h('span', { class: 'term-out' }, lineOut(e)), '\n',
          h('span', {}, pad(t)), h('span', { class: ok ? 'term-ok' : 'term-err' }, lineIn(e))),
        h('div', { class: 'term-label' }, '# request'),
        h('pre', {}, JSON.stringify(e.request.body ?? null, null, 2)),
        e.thoughts ? [h('div', { class: 'term-label' }, '# thinking'), h('pre', { class: 'term-dim' }, e.thoughts)] : null,
        h('div', { class: 'term-label' }, '# response'),
        h('pre', {}, e.response || e.error || '(empty)'));
    }) : [h('div', { class: 'term-empty' }, '$ no requests yet')]));
  }

  const actions = [
    h('button', { class: 'nav-btn', 'aria-label': 'Copy log', onclick: async () => toast(await copyText(logs.map(asText).join('\n')) ? 'Log copied' : 'Could not copy') }, icon('copy', 20)),
    h('button', { class: 'nav-btn', 'aria-label': 'Clear log', onclick: async () => { if (confirm('Clear the API log?')) { await clearLogs(); draw(); } } }, icon('trash', 20)),
  ];

  root.append(
    header('API log', { back: '#/settings', backLabel: 'Settings', actions }),
    h('main', { class: 'page', style: 'padding-top:12px' },
      h('p', { class: 'section-foot', style: 'margin:0 4px 10px' }, 'Newest first. Tap an entry to see what was sent and what came back. Your API key and audio are never stored here.'),
      term),
  );
  await draw();
}
