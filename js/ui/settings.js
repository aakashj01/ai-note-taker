import { getSetting, setSetting } from '../db.js';
import { listModels } from '../gemini.js';
import { DEFAULT_MODEL } from '../process.js';
import { h, header, toast } from './dom.js';

export async function renderSettings(root) {
  const key = h('input', { id: 'api-key', type: 'password', value: await getSetting('apiKey', ''), autocomplete: 'off', spellcheck: false, placeholder: 'Paste your key' });
  const model = h('input', { id: 'model', type: 'text', value: await getSetting('model', DEFAULT_MODEL), list: 'models', autocomplete: 'off', spellcheck: false });
  const options = h('datalist', { id: 'models' });

  async function loadModels() {
    if (!key.value.trim()) return toast('Add your key first');
    try {
      const names = await listModels({ apiKey: key.value.trim() });
      options.replaceChildren(...names.map(n => h('option', { value: n })));
      toast(`${names.length} models available — tap the model box to pick`);
    } catch (e) { toast(e.message); }
  }

  async function save() {
    await setSetting('apiKey', key.value.trim());
    await setSetting('model', model.value.trim() || DEFAULT_MODEL);
    toast('Saved');
  }

  root.append(
    header('Settings', { back: '#/' }),
    h('section', { class: 'content form' },
      h('label', { for: 'api-key' }, 'Gemini API key'),
      h('div', { class: 'row' }, key,
        h('button', { class: 'btn btn-ghost small', type: 'button', onclick: e => { key.type = key.type === 'password' ? 'text' : 'password'; e.target.textContent = key.type === 'password' ? 'Show' : 'Hide'; } }, 'Show')),
      h('p', { class: 'muted' }, 'Free from ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'Google AI Studio'), '. It is stored only on this phone.'),
      h('label', { for: 'model' }, 'AI model'),
      h('div', { class: 'row' }, model, options, h('button', { class: 'btn btn-ghost small', type: 'button', onclick: loadModels }, 'Load list')),
      h('p', { class: 'muted' }, `Default: ${DEFAULT_MODEL}. If you hit the daily limit, try a "flash-lite" model.`),
      h('p', { class: 'privacy' }, 'Free Gemini tier: Google may use uploaded audio to improve its products.'),
      h('button', { class: 'btn btn-primary btn-big', onclick: save }, 'Save'),
    ),
  );
}
