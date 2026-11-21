// Plays the meeting from a meeting-time position, picking the right recorded part.
// iOS only allows play() directly inside a tap, so blobs are prepared up front and
// play() is called synchronously; the seek happens once the metadata has loaded.
import { getPartBlob as dbGetPartBlob } from '../db.js';

export function createPlayer(meeting, {
  Audio: AudioCtor = globalThis.Audio,
  getPartBlob = dbGetPartBlob,
  createURL = b => URL.createObjectURL(b),
  revokeURL = u => URL.revokeObjectURL(u),
} = {}) {
  const audio = new AudioCtor();
  audio.preload = 'auto';
  const urls = new Map();
  let loadedPart = null, pendingSeek = null;

  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek != null) { audio.currentTime = pendingSeek; pendingSeek = null; }
  });

  const ready = Promise.all((meeting.parts || []).map(async p => {
    urls.set(p.id, createURL(await getPartBlob(p.id, p.mimeType)));
  })).catch(() => {});

  function partAt(t) {
    const parts = meeting.parts || [];
    return parts.find(p => t >= p.startOffset && t < p.startOffset + Math.max(p.duration, 0.1))
      || [...parts].reverse().find(p => t >= p.startOffset) || parts[0];
  }

  return {
    ready,
    playFrom(t) {
      const p = partAt(t);
      if (!p || !urls.has(p.id)) return ready.then(() => urls.has(p?.id) && this.playFrom(t));
      const pos = Math.max(0, t - p.startOffset - 1);
      if (loadedPart !== p.id) {
        audio.src = urls.get(p.id); loadedPart = p.id;
        pendingSeek = pos;
        audio.load();
      } else {
        audio.currentTime = pos;
      }
      return audio.play()?.catch(() => {});
    },
    pause() { audio.pause(); },
    dispose() { audio.pause(); urls.forEach(u => revokeURL(u)); urls.clear(); },
  };
}
