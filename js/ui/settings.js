import { getSetting, setSetting } from '../db.js';
import { listModels } from '../gemini.js';
import { DEFAULT_MODEL, geminiFetch } from '../process.js';
import { listLogs } from '../db.js';
import { usageToday, nextReset } from '../apilog.js';
import { icon } from './dom.js';
import { APP_VERSION } from '../version.js';
import { h, header, toast, formatDate } from './dom.js';
import { buildBackup, restoreBackup, BACKUP_NAME } from '../backup.js';
import { THEMES, currentTheme, applyTheme } from '../theme.js';

export async function renderSettings(root) {
  const key = h('input', { id: 'api-key', class: 'field', 'aria-label': 'Gemini API key', type: 'password', value: await getSetting('apiKey', ''), autocomplete: 'off', spellcheck: false, placeholder: 'Paste your key' });
  const model = h('input', { id: 'model', class: 'field', type: 'text', value: await getSetting('model', DEFAULT_MODEL), list: 'models', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const options = h('datalist', { id: 'models' });
  const toggle = h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; toggle.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');

  async function loadModels() {
    if (!key.value.trim()) return toast('Add your key first');
    try {
      const names = await listModels({ apiKey: key.value.trim(), fetch: geminiFetch });
      options.replaceChildren(...names.map(n => h('option', { value: n })));
      toast(`${names.length} models found. Tap the model field to pick one.`);
    } catch (e) { toast(e.message); }
  }

  let includeAudio = await getSetting('backupAudio', true);
  const lastBackup = h('p', { class: 'section-foot' });
  const showLast = async () => {
    const t = await getSetting('lastBackup', 0);
    lastBackup.textContent = (t ? `Last backup: ${formatDate(t)}. ` : 'No backup yet. ')
      + 'Save it to Files › iCloud Drive. Next time, save to the same folder and tap Replace to keep one backup file.';
  };
  showLast();
  const audioSwitch = h('button', {
    class: 'switch', role: 'switch', 'aria-checked': String(includeAudio), 'aria-label': 'Include recordings',
    onclick: async () => { includeAudio = !includeAudio; audioSwitch.setAttribute('aria-checked', String(includeAudio)); await setSetting('backupAudio', includeAudio); },
  });

  async function backUp(e) {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Preparing backup…';
    try {
      const { blob, count } = await buildBackup({ includeAudio });
      const file = new File([blob], BACKUP_NAME, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const a = h('a', { href: URL.createObjectURL(file), download: BACKUP_NAME });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      }
      await setSetting('lastBackup', Date.now());
      await showLast();
      toast(`Backed up ${count} meeting${count === 1 ? '' : 's'}`);
    } catch (err) {
      if (err.name !== 'AbortError') toast('Backup failed: ' + err.message);
    } finally { btn.disabled = false; btn.textContent = 'Back up now'; }
  }

  const restoreInput = h('input', {
    type: 'file', id: 'restore-file', accept: 'application/json,.json', class: 'visually-hidden',
    onchange: async e => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (!f) return;
      try {
        const { added, skipped } = await restoreBackup(f);
        toast(`Restored ${added} meeting${added === 1 ? '' : 's'}${skipped ? ` (${skipped} already on this phone)` : ''}`);
      } catch (err) { toast(err.message); }
    },
  });

  const dailyLimit = h('input', {
    class: 'field', type: 'number', inputmode: 'numeric', min: 1, 'aria-label': 'Daily request limit',
    value: String(await getSetting('dailyLimit', 20)), style: 'text-align:right;width:80px',
    onchange: async e => { const n = Math.max(1, parseInt(e.target.value, 10) || 20); e.target.value = n; await setSetting('dailyLimit', n); drawUsage(); },
  });
  const usageBox = h('ul', { class: 'group' });
  async function drawUsage() {
    const limit = Math.max(1, parseInt(dailyLimit.value, 10) || 20);
    const usage = Object.entries(usageToday(await listLogs()));
    usageBox.replaceChildren(
      ...(usage.length ? usage.map(([model, u]) => h('li', { class: 'cell usage' },
        h('div', { class: 'cell-main' },
          h('div', { class: 'usage-top' }, h('span', { class: 'usage-model' }, model), h('span', { class: 'cell-trail' }, `${u.requests} of ${limit} requests`)),
          h('div', { class: 'meter' + (u.requests >= limit ? ' full' : u.requests / limit >= 0.75 ? ' high' : ''), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': limit, 'aria-valuenow': u.requests, 'aria-label': `${model} requests today` },
            h('span', { style: `width:${Math.min(100, (u.requests / limit) * 100)}%` })),
          h('div', { class: 'cell-sub' }, `${u.tokens.toLocaleString('en-IN')} tokens today`))))
        : [h('li', { class: 'cell' }, h('div', { class: 'cell-main cell-sub' }, 'No requests yet today.'))]),
      h('li', { class: 'cell' }, h('div', { class: 'cell-main' }, 'Daily limit per model'), dailyLimit),
      h('li', {}, h('a', { class: 'cell', href: '#/log' }, h('div', { class: 'cell-main' }, 'API log'), h('div', { class: 'cell-trail' }, icon('chevron', 16)))));
  }
  drawUsage();
  const resetAt = nextReset().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  async function save() {
    await setSetting('apiKey', key.value.trim());
    await setSetting('model', model.value.trim() || DEFAULT_MODEL);
    toast('Saved');
  }

  root.append(
    header('Settings', { large: true, back: '#/', backLabel: 'Meetings' }),
    h('main', { class: 'page' },
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Appearance'),
        h('ul', { class: 'group' }, h('li', { class: 'cell' },
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Appearance' },
            THEMES.map(([value, label]) => h('label', {},
              h('input', { type: 'radio', name: 'theme', value, checked: currentTheme() === value, onchange: () => applyTheme(value) }), label)))))),
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Gemini'),
        h('ul', { class: 'group' },
          h('li', { class: 'cell' }, h('label', { for: 'api-key', class: 'cell-label' }, 'API key'), key, toggle),
          h('li', { class: 'cell' }, h('label', { for: 'model', class: 'cell-label' }, 'Model'), model, options,
            h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: loadModels }, 'Browse'))),
        h('p', { class: 'section-foot' }, 'Get a free key from ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Google AI Studio'),
          '. It stays on this phone. If the model is busy, the app switches to gemini-flash-lite-latest by itself.')),
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'API usage'),
        usageBox,
        h('p', { class: 'section-foot' }, `Counts requests made by this app on this phone. Resets at ${resetAt} your time (midnight in California). Google doesn't share your exact remaining quota, so check AI Studio for your real limit.`)),
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Privacy'),
        h('p', { class: 'summary' }, 'On the free tier, Google may use uploaded audio to improve its products. Recordings and notes are stored only on this phone.')),
      h('section', { class: 'section' }, h('button', { class: 'btn btn-filled btn-block', onclick: save }, 'Save')),
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Backup'),
        h('ul', { class: 'group' },
          h('li', { class: 'cell' }, h('div', { class: 'cell-main' }, 'Include recordings'), audioSwitch),
          h('li', {}, h('button', { class: 'cell action', onclick: backUp }, 'Back up now')),
          h('li', {}, h('label', { class: 'cell action', for: 'restore-file', role: 'button' }, 'Restore from backup'))),
        restoreInput,
        lastBackup),
      h('p', { class: 'section-foot', style: 'text-align:center' }, `App version ${APP_VERSION}`)),
  );
}
