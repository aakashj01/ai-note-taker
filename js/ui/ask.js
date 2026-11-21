import { askMeetings } from '../process.js';
import { listMeetings } from '../db.js';
import { parseTime, formatTime } from '../notes.js';
import { h, header, icon, toast, copyText } from './dom.js';

const EXAMPLES = ['What did Rahul promise last week?', 'When did we decide the price?', 'What is still blocked?'];

export async function renderAsk(root) {
  const meetings = await listMeetings();
  const byId = new Map(meetings.map(m => [m.id, m]));
  const box = h('textarea', { class: 'field', rows: 3, 'aria-label': 'Your question', placeholder: 'Ask about your meetings', enterkeyhint: 'send' });
  const out = h('div', {});
  const btn = h('button', { class: 'btn btn-filled btn-block', onclick: ask }, icon('sparkle', 20), 'Ask');
  btn.setAttribute('aria-label', 'Ask');

  async function ask() {
    const q = box.value.trim();
    if (!q) { box.focus(); return; }
    btn.disabled = true;
    const status = h('div', {}, 'Reading your meetings…');
    out.replaceChildren(h('div', { class: 'banner working' }, h('div', { class: 'spinner' }), status));
    try {
      const r = await askMeetings(q, msg => { status.textContent = msg; });
      const sources = (r.sources || []).filter(s => byId.has(s.meeting_id));
      out.replaceChildren(h('section', { class: 'section' },
        h('div', { class: 'section-bar' },
          h('h2', { class: 'section-head' }, 'Answer'),
          h('button', { class: 'copy-btn', 'aria-label': 'Copy answer', onclick: async () => toast(await copyText(r.answer) ? 'Answer copied' : 'Could not copy') }, icon('copy', 16), 'Copy')),
        h('p', { class: 'summary' }, r.answer || 'No answer.'),
        sources.length ? h('ul', { class: 'group', style: 'margin-top:12px' }, sources.map(s => {
          const m = byId.get(s.meeting_id);
          const t = s.time ? parseTime(s.time) : null;
          return h('li', {}, h('a', { class: 'cell source-link', href: `#/m/${m.id}` },
            h('div', { class: 'cell-main' }, h('div', { class: 'cell-title' }, m.title),
              h('div', { class: 'cell-sub' }, new Date(m.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + (t != null ? `, at ${formatTime(t)}` : ''))),
            h('div', { class: 'cell-trail' }, icon('chevron', 16))));
        })) : null));
    } catch (e) {
      out.replaceChildren(h('div', { class: 'banner warn', role: 'alert' }, e.message));
    } finally { btn.disabled = false; }
  }

  root.append(
    header('Ask', { large: true, back: '#/', backLabel: 'Meetings' }),
    h('main', { class: 'page' },
      h('ul', { class: 'group' }, h('li', { class: 'cell' }, box)),
      h('div', { class: 'chips', style: 'margin-top:10px' }, EXAMPLES.map(x => h('button', { class: 'chip chip-btn', type: 'button', onclick: () => { box.value = x; box.focus(); } }, x))),
      h('section', { class: 'section', style: 'margin-top:14px' }, btn),
      h('p', { class: 'section-foot' }, 'Your question and your saved notes and transcripts are sent to Gemini. Each question uses one request.'),
      out),
  );
}
