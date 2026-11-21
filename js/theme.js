// Light / dark / follow-the-phone. Stored in localStorage so index.html can apply it before first paint.
export const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export function currentTheme() {
  try { const t = localStorage.getItem('theme'); return t === 'light' || t === 'dark' ? t : 'system'; } catch { return 'system'; }
}

export function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'light' || choice === 'dark') root.dataset.theme = choice; else delete root.dataset.theme;
  try { if (choice === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', choice); } catch { /* private mode */ }
}
