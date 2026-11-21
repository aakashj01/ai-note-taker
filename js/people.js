// Names the owner has typed before, used to pre-fill the "Who spoke?" screen.
// No voice recognition: suggestions come from what was said and from last time.
export const EMPTY_PEOPLE = Object.freeze({ people: Object.freeze([]), lastNames: Object.freeze({}) });

const tidy = n => (n || '').trim().replace(/\s+/g, ' ');
const cap = n => n.charAt(0).toUpperCase() + n.slice(1);

export function rememberNames(meeting, store = EMPTY_PEOPLE) {
  const byLower = new Map((store.people || []).map(p => [p.toLowerCase(), p]));
  const mapping = {};
  for (const [label, raw] of Object.entries(meeting.speakers || {})) {
    const name = tidy(raw);
    if (!name) continue;
    const known = byLower.get(name.toLowerCase()) || cap(name);
    byLower.set(known.toLowerCase(), known);
    mapping[label] = known;
  }
  const type = meeting.type || 'general';
  return {
    people: [...byLower.values()].sort((a, b) => a.localeCompare(b)),
    lastNames: { ...(store.lastNames || {}), ...(Object.keys(mapping).length ? { [type]: mapping } : {}) },
  };
}

export function suggestNames(meeting, store = EMPTY_PEOPLE) {
  const last = store.lastNames?.[meeting.type || 'general'] || {};
  const out = {};
  for (const label of Object.keys(meeting.speakers || {})) {
    const typed = tidy(meeting.speakers[label]);
    const heard = tidy(meeting.nameGuesses?.[label]);
    const before = tidy(last[label]);
    out[label] = typed ? { name: typed, why: 'typed' }
      : heard ? { name: heard, why: 'speech' }
      : before ? { name: before, why: 'last' }
      : { name: '', why: null };
  }
  return out;
}
