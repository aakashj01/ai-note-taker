import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../../js/ui/player.js';

class FakeAudio {
  constructor() { this.playCalls = 0; this.currentTime = 0; this.listeners = {}; FakeAudio.last = this; }
  addEventListener(t, f) { this.listeners[t] = f; }
  load() {}
  play() { this.playCalls++; return Promise.resolve(); }
  pause() {}
}

test('playFrom calls play() synchronously inside the tap', async () => {
  const meeting = { parts: [{ id: 'a', mimeType: 'audio/mp4', startOffset: 0, duration: 60 }, { id: 'b', mimeType: 'audio/mp4', startOffset: 90, duration: 60 }] };
  const p = createPlayer(meeting, { Audio: FakeAudio, getPartBlob: async id => new Blob([id]), createURL: b => 'blob:' + b.size, revokeURL: () => {} });
  await p.ready;
  p.playFrom(100); // not awaited: play() must already have been called
  const a = FakeAudio.last;
  assert.equal(a.playCalls, 1);
  assert.equal(a.src, 'blob:1');
  a.listeners.loadedmetadata?.();
  assert.equal(a.currentTime, 9); // 100 - 90 - 1 s lead-in
});
