// Records every Gemini request/response (without the key or audio bytes) and counts today's usage.
const MAX_TEXT = 4000;
const GENERATE = new Set(['generateContent', 'streamGenerateContent']);

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const clip = s => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + ` … [${s.length - MAX_TEXT} more characters]` : s);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    if (v.inline_data?.data) {
      const bytes = Math.floor(v.inline_data.data.length * 3 / 4);
      return { inline_data: `[audio ${fmtBytes(bytes)} ${v.inline_data.mime_type || ''}]`.replace(' ]', ']') };
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? clip(x) : scrub(x)]));
  }
  return v;
}

export function summarizeRequest(url, init = {}) {
  const u = new URL(String(url));
  u.searchParams.delete('key');
  const m = u.pathname.match(/\/models\/([^/:]+):(\w+)/);
  const action = m ? m[2]
    : /\/upload\//.test(u.pathname) ? 'upload'
    : /\/files\//.test(u.pathname) ? 'file-status'
    : /\/models$/.test(u.pathname) ? 'models'
    : 'upload';
  let body = null;
  const b = init.body;
  if (b && typeof b === 'object' && typeof b.size === 'number') body = `[upload ${fmtBytes(b.size)}]`;
  else if (typeof b === 'string') { try { body = scrub(JSON.parse(b)); } catch { body = clip(b); } }
  return { method: init.method || 'GET', model: m ? m[1] : null, action, path: u.pathname, body };
}

function readCandidate(d, acc) {
  for (const p of d.candidates?.[0]?.content?.parts || []) {
    if (!p.text) continue;
    if (p.thought) acc.thoughts += p.text; else acc.text += p.text;
  }
  if (d.usageMetadata) {
    const u = d.usageMetadata;
    acc.usage = { in: u.promptTokenCount || 0, out: u.candidatesTokenCount || 0, thoughts: u.thoughtsTokenCount || 0 };
  }
  if (d.error) acc.error = d.error.message || String(d.error.code || 'error');
}

export function summarizeResponse(text = '') {
  const acc = { text: '', thoughts: '', usage: null, error: null };
  if (/^data:/m.test(text)) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try { readCandidate(JSON.parse(line.slice(5).trim()), acc); } catch { /* partial line */ }
    }
  } else {
    try {
      const d = JSON.parse(text);
      readCandidate(d, acc);
      if (!acc.text && !acc.error) acc.text = JSON.stringify(d, null, 1);
    } catch { acc.text = text; }
  }
  return { text: clip(acc.text), thoughts: clip(acc.thoughts), usage: acc.usage, error: acc.error };
}

export function createLoggedFetch({ fetch = (...a) => globalThis.fetch(...a), save, now = () => Date.now() }) {
  const keep = e => Promise.resolve(save(e)).catch(() => {});
  return async (url, init = {}) => {
    const at = now();
    const request = summarizeRequest(url, init);
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      keep({ at, request, status: 0, ms: now() - at, error: e.message || String(e) });
      throw e;
    }
    const copy = res.clone();
    copy.text().catch(() => '').then(text => {
      const r = summarizeResponse(text);
      keep({ at, request, status: res.status, ms: now() - at, response: r.text, thoughts: r.thoughts, usage: r.usage, error: res.ok ? r.error : (r.error || res.statusText || 'error') });
    });
    return res;
  };
}

const LA = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const LA_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' });
const laDay = t => LA.format(new Date(t));

export function usageToday(logs, now = Date.now()) {
  const today = laDay(now);
  const out = {};
  for (const e of logs) {
    if (!GENERATE.has(e.request?.action) || !e.status || e.status === 429 || laDay(e.at) !== today) continue;
    const m = e.request.model || '?';
    out[m] ||= { requests: 0, tokens: 0 };
    out[m].requests++;
    if (e.usage) out[m].tokens += (e.usage.in || 0) + (e.usage.out || 0) + (e.usage.thoughts || 0);
  }
  return out;
}

export function nextReset(now = Date.now()) {
  const [y, mo, d] = laDay(now).split('-').map(Number);
  for (const offset of [7, 8]) {
    const t = Date.UTC(y, mo - 1, d + 1, offset);
    if (Number(LA_HOUR.format(new Date(t))) === 0) return new Date(t);
  }
  return new Date(Date.UTC(y, mo - 1, d + 1, 8));
}
