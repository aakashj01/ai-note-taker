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

export function header(title, { back, actions = [] } = {}) {
  return h('header', { class: 'bar' },
    back ? h('a', { href: back, class: 'icon-btn', 'aria-label': 'Back' }, '‹') : h('span', { class: 'bar-spacer' }),
    h('h1', {}, title),
    h('div', { class: 'bar-actions' }, actions),
  );
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function meetingDuration(m) {
  const last = m.parts?.at(-1);
  return last ? last.startOffset + last.duration : 0;
}
