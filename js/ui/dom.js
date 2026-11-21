// Tiny DOM builder. Text always goes in as text (never HTML), so AI output can't inject markup.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || (k in el && k !== 'list' && typeof v !== 'string')) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// SF Symbols-style line icons, drawn on a 24px grid.
const PATHS = {
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 6l6 6-6 6',
  gear: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-3.6l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-1.8-3.1 1.6-1.2a7 7 0 0 1 0-2.3L3.4 10l1.8-3.1 1.9.7a7 7 0 0 1 2-1.2l.3-2h3.6l.3 2a7 7 0 0 1 2 1.2l1.9-.7 1.8 3.1-1.6 1.2a7 7 0 0 1 0 2.3z',
  share: 'M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1',
  import: 'M12 3v12M8 11l4 4 4-4M5 15v6h14v-6',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  waveform: 'M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  copy: 'M9 8h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h3',
  checklist: 'M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17M11 6h9M11 12h9M11 18h9',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
};
const FILLED = new Set(['play', 'pause']);

export function icon(name, size = 22) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', PATHS[name]);
  if (FILLED.has(name)) { p.setAttribute('fill', 'currentColor'); }
  else {
    p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.9'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(p);
  return svg;
}

// iOS navigation bar. With `large`, a 34pt title sits under the bar and the bar's small title
// fades in once the large one scrolls away, like UINavigationBar's large titles.
export function header(title, { back, backLabel = 'Back', actions = [], large = false } = {}) {
  const small = h('span', { class: 'nav-title' }, title);
  const bar = h('header', { class: 'nav' + (large ? '' : ' compact') },
    h('div', { class: 'nav-row' },
      h('div', { class: 'nav-side' },
        back ? h('a', { href: back, class: 'nav-back', 'aria-label': 'Back' }, icon('back', 24), h('span', {}, backLabel)) : null),
      small,
      h('div', { class: 'nav-side end' }, actions)));
  if (!large) return bar;
  const big = h('h1', { class: 'large-title' }, title);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => bar.classList.toggle('compact', !e.isIntersecting), { rootMargin: '-52px 0px 0px 0px' }).observe(big);
  }
  const frag = document.createDocumentFragment();
  frag.append(bar, big);
  return frag;
}

// Clipboard write that also works where the async API is missing or refused.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = h('textarea', { value: text, readonly: true, style: 'position:fixed;opacity:0;top:0' });
  document.body.append(ta);
  ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

export function formatDate(ms) {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} at ${time}`;
}

export function dayGroup(ms, now = Date.now()) {
  const start = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const days = Math.round((start(now) - start(ms)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return new Date(ms).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function meetingDuration(m) {
  const last = m.parts?.at(-1);
  return last ? last.startOffset + last.duration : 0;
}
