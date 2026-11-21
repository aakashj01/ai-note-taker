// Plays the meeting from a meeting-time position, picking the right recorded part.
import { getPartBlob } from '../db.js';

export function createPlayer(meeting) {
  const audio = new Audio();
  audio.preload = 'none';
  let url = null, loadedPart = null;

  function partAt(t) {
    const parts = meeting.parts || [];
    return parts.find(p => t >= p.startOffset && t < p.startOffset + Math.max(p.duration, 0.1))
      || [...parts].reverse().find(p => t >= p.startOffset) || parts[0];
  }

  return {
    async playFrom(t) {
      const p = partAt(t);
      if (!p) return;
      if (loadedPart !== p.id) {
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(await getPartBlob(p.id, p.mimeType));
        audio.src = url; loadedPart = p.id;
        await new Promise(r => { audio.onloadedmetadata = r; audio.onerror = r; audio.load(); });
      }
      audio.currentTime = Math.max(0, t - p.startOffset - 1);
      await audio.play().catch(() => {});
    },
    pause() { audio.pause(); },
    dispose() { audio.pause(); if (url) URL.revokeObjectURL(url); },
  };
}
