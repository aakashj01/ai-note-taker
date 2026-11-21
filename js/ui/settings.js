import { getSetting, setSetting } from '../db.js';
import { listModels } from '../gemini.js';
import { DEFAULT_MODEL } from '../process.js';
import { APP_VERSION } from '../version.js';
import { h, header, toast } from './dom.js';

export async function renderSettings(root) {
  const key = h('input', { id: 'api-key', class: 'field', 'aria-label': 'Gemini API key', type: 'password', value: await getSetting('apiKey', ''), autocomplete: 'off', spellcheck: false, placeholder: 'Paste your key' });
  const model = h('input', { id: 'model', class: 'field', type: 'text', value: await getSetting('model', DEFAULT_MODEL), list: 'models', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const options = h('datalist', { id: 'models' });
  const toggle = h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; toggle.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');

  async function loadModels() {
    if (!key.value.trim()) return toast('Add your key first');
    try {
      const names = await listModels({ apiKey: key.value.trim() });
      options.replaceChildren(...names.map(n => h('option', { value: n })));
      toast(`${names.length} models found. Tap the model field to pick one.`);
    } catch (e) { toast(e.message); }
  }

  async function save() {
    await setSetting('apiKey', key.value.trim());
    await setSetting('model', model.value.trim() || DEFAULT_MODEL);
    toast('Saved');
  }

  root.append(
    header('Settings', { large: true, back: '#/', backLabel: 'Meetings' }),
    h('main', { class: 'page' },
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Gemini'),
        h('ul', { class: 'group' },
          h('li', { class: 'cell' }, h('label', { for: 'api-key', class: 'cell-label' }, 'API key'), key, toggle),
          h('li', { class: 'cell' }, h('label', { for: 'model', class: 'cell-label' }, 'Model'), model, options,
            h('button', { class: 'btn btn-plain btn-small', type: 'button', onclick: loadModels }, 'Browse'))),
        h('p', { class: 'section-foot' }, 'Get a free key from ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Google AI Studio'),
          '. It stays on this phone. If the model is busy, the app switches to gemini-flash-lite-latest by itself.')),
      h('section', { class: 'section' },
        h('h2', { class: 'section-head' }, 'Privacy'),
        h('p', { class: 'summary' }, 'On the free tier, Google may use uploaded audio to improve its products. Recordings and notes are stored only on this phone.')),
      h('section', { class: 'section' }, h('button', { class: 'btn btn-filled btn-block', onclick: save }, 'Save')),
      h('p', { class: 'section-foot', style: 'text-align:center' }, `App version ${APP_VERSION}`)),
  );
}
