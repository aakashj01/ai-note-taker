// Every to-do across meetings, for the To-dos screen. Pure, no storage.
export const UNASSIGNED = 'Unassigned';

export function ownerName(meeting, todo) {
  const name = todo.owner && (meeting.speakers?.[todo.owner] || '').trim();
  return name || UNASSIGNED;
}

export function collectTodos(meetings, { person = null, showDone = false } = {}) {
  return [...meetings]
    .filter(m => m.notes?.todos?.length)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(meeting => ({
      meeting,
      items: meeting.notes.todos
        .map((todo, index) => ({ todo, index }))
        .filter(({ todo }) => (showDone || !todo.done) && (!person || ownerName(meeting, todo) === person)),
    }))
    .filter(g => g.items.length);
}

export function peopleFromTodos(meetings) {
  const names = new Set();
  for (const m of meetings) for (const t of m.notes?.todos || []) names.add(ownerName(m, t));
  const hasNone = names.delete(UNASSIGNED);
  return [...[...names].sort((a, b) => a.localeCompare(b)), ...(hasNone ? [UNASSIGNED] : [])];
}
