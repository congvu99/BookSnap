// BackgroundMusic against fake Audio / AudioContext / fetch with mocked timers: the race paths
// (fast track switching, TTS play/pause flicker, destroy mid-fetch) that a device test cannot
// reproduce reliably.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS } from '../../web/js/background-music-prefs.js';

class FakeParam {
  constructor() {
    this.value = 0;
  }
  cancelScheduledValues() {}
  setValueAtTime(v) {
    this.value = v;
  }
  linearRampToValueAtTime(v) {
    this.value = v;
  }
}

const gesture = { active: false };
/** Run `fn` as if it were a tap handler. */
function tap(fn) {
  gesture.active = true;
  try {
    fn();
  } finally {
    gesture.active = false;
  }
}

class FakeAudio {
  constructor() {
    this.paused = true;
    this.src = null;
    this.volume = 1;
    this.playCalls = 0;
    FakeAudio.last = this;
  }
  addEventListener() {}
  removeAttribute() {
    this.src = null;
  }
  load() {}
  play() {
    this.playCalls += 1;
    // iOS Safari: an element may only start from a synchronous call inside a tap until it has
    // been played that way once.
    if (FakeAudio.enforceGesture && !gesture.active && !this.gestureUnlocked) {
      return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    }
    if (gesture.active) this.gestureUnlocked = true;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

class FakeAudioContext {
  constructor() {
    this.state = FakeAudioContext.initialState;
    this.currentTime = 0;
    this.destination = {};
    this.onstatechange = null;
    FakeAudioContext.created += 1;
    FakeAudioContext.last = this;
  }
  createGain() {
    return { gain: new FakeParam(), connect: (n) => n };
  }
  createMediaElementSource() {
    FakeAudioContext.sources += 1;
    if (FakeAudioContext.failSource) throw new Error('InvalidStateError');
    return { connect: (n) => n };
  }
  resume() {
    this.state = 'running';
    if (this.onstatechange) this.onstatechange();
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** fetch whose responses resolve only when the test says so */
function deferredFetch() {
  const pending = [];
  const fn = (url, { signal }) =>
    new Promise((resolve, reject) => {
      const entry = { url, resolve: () => resolve({ ok: true, blob: async () => new Blob([url]) }), fail: (status) => resolve({ ok: false, status }) };
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      pending.push(entry);
    });
  fn.pending = pending;
  return fn;
}

const flush = () => new Promise((r) => setImmediate(r));
let BackgroundMusic;
let revoked;
let errors;

beforeEach(async () => {
  FakeAudioContext.created = 0;
  FakeAudioContext.sources = 0;
  FakeAudioContext.failSource = false;
  FakeAudioContext.initialState = 'suspended';
  FakeAudio.enforceGesture = false;
  globalThis.window = { AudioContext: FakeAudioContext };
  globalThis.Audio = FakeAudio;
  globalThis.fetch = deferredFetch();
  revoked = [];
  let n = 0;
  mock.method(URL, 'createObjectURL', (b) => (b && b.type === 'audio/wav' ? 'blob:silence' : `blob:${++n}`));
  mock.method(URL, 'revokeObjectURL', (u) => revoked.push(u));
  mock.method(console, 'warn', () => {});
  mock.timers.enable({ apis: ['setTimeout'] });
  ({ BackgroundMusic } = await import('../../web/js/background-music.js'));
  errors = [];
});

afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

function engine() {
  return new BackgroundMusic({ onError: (m) => errors.push(m) });
}

async function loaded(music, id) {
  music.setTrack(id);
  fetch.pending.at(-1).resolve();
  await flush();
}

test('"Tắt" never fetches and never creates an AudioContext', () => {
  const music = engine();
  music.setTrack(null);
  music.unlock();
  music.setActive(true);
  assert.equal(fetch.pending.length, 0);
  assert.equal(FakeAudioContext.created, 0);
});

test('waits for a gesture unlock before playing, then starts if the TTS is already playing', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.setActive(true);
  assert.equal(music.el.playCalls, 0, 'no context yet: would be full volume on iOS');
  music.unlock();
  assert.equal(music.el.paused, false);
  assert.ok(Math.abs(music.gain.gain.value - DEFAULT_PREFS.volume) < 1e-9);
});

test('a context born running (Chrome, inside a gesture) still starts music the TTS is already playing', async () => {
  FakeAudioContext.initialState = 'running'; // no statechange event will follow
  const music = engine();
  await loaded(music, 'rain');
  music.setActive(true);
  music.unlock();
  assert.equal(music.el.paused, false);
  assert.ok(Math.abs(music.gain.gain.value - DEFAULT_PREFS.volume) < 1e-9, 'audible, not just primed at gain 0');
});

test('unlock while the TTS is paused primes the element and pauses it again', async () => {
  const music = engine();
  await loaded(music, 'piano');
  music.unlock();
  assert.equal(music.el.playCalls, 1);
  await flush();
  assert.equal(music.el.paused, true);
  assert.equal(music.gain.gain.value, 0);
});

test('a pause shorter than the grace period (chunk swap) never fades out', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.unlock();
  music.setActive(true);
  music.setActive(false);
  mock.timers.tick(400);
  music.setActive(true);
  mock.timers.tick(5000);
  assert.equal(music.el.paused, false);
  assert.ok(music.gain.gain.value > 0);
});

test('a real pause fades out after the grace period and then pauses the element', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.unlock();
  music.setActive(true);
  music.setActive(false);
  mock.timers.tick(599);
  assert.equal(music.el.paused, false);
  mock.timers.tick(1);
  assert.equal(music.gain.gain.value, 0);
  mock.timers.tick(1050);
  assert.equal(music.el.paused, true);
});

test('rapid A→B→A while loading keeps only the last choice and aborts the rest', async () => {
  const music = engine();
  music.setTrack('rain');
  music.setTrack('violin');
  music.setTrack('rain');
  assert.equal(fetch.pending.length, 3);
  fetch.pending[0].resolve();
  fetch.pending[1].resolve();
  fetch.pending[2].resolve();
  await flush();
  assert.equal(music.loadedId, 'rain');
  assert.equal(music.el.src, 'blob:1');
  assert.deepEqual(errors, []);
});

test('switching back inside the fade reuses the loaded file instead of fetching again', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.unlock();
  music.setActive(true);
  music.setTrack('violin');
  music.setTrack('rain');
  mock.timers.tick(500);
  await flush();
  assert.equal(fetch.pending.length, 1, 'only the first load');
  assert.equal(music.el.paused, false);
  assert.equal(music.loadedId, 'rain');
});

test('switching tracks revokes the previous blob URL', async () => {
  const music = engine();
  await loaded(music, 'rain');
  await loaded(music, 'piano');
  assert.deepEqual(revoked, ['blob:1']);
  music.destroy();
  assert.deepEqual(revoked, ['blob:1', 'blob:2']);
});

test('destroy during a fetch leaves nothing behind', async () => {
  const music = engine();
  music.setTrack('rain');
  music.destroy();
  await flush();
  assert.equal(music.el.src, null);
  assert.deepEqual(errors, []);
});

test('a missing file reports once and stays silent', async () => {
  const music = engine();
  music.setTrack('rain');
  fetch.pending[0].fail(404);
  await flush();
  music.setActive(true);
  music.unlock();
  await flush();
  assert.deepEqual(errors, ['Không tải được nhạc nền']);
  assert.equal(music.loadedId, null);
  assert.equal(music.el.paused, true, 'only the silent priming clip ever played');
});

test('the media element source is created once across many unlocks', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.unlock();
  music.unlock();
  music.unlock();
  assert.equal(FakeAudioContext.sources, 1);
  assert.equal(FakeAudioContext.created, 1);
});

test('a graph that cannot be built stays silent and reports only once', async () => {
  FakeAudioContext.failSource = true;
  const music = engine();
  await loaded(music, 'rain');
  music.setActive(true);
  music.unlock();
  music.unlock();
  assert.equal(music.el.playCalls, 0);
  assert.equal(errors.length, 1);
  assert.equal(FakeAudioContext.last.state, 'closed');
});

test('an interrupted context pauses the element and resuming restarts it', async () => {
  const music = engine();
  await loaded(music, 'rain');
  music.unlock();
  music.setActive(true);
  const ctx = music.ctx;
  ctx.state = 'interrupted';
  ctx.onstatechange();
  assert.equal(music.el.paused, true);
  ctx.resume();
  assert.equal(music.el.paused, false);
});

test('iOS: choosing a track while the TTS plays starts once the file arrives after the tap', async () => {
  FakeAudio.enforceGesture = true;
  const music = engine();
  music.setActive(true);
  tap(() => {
    music.setTrack('rain'); // same order as the hook's chip handler
    music.unlock();
  });
  fetch.pending[0].resolve(); // lands outside the gesture
  await flush();
  assert.equal(music.el.paused, false, 'play() after the fetch must not be refused');
  assert.equal(music.el.src, 'blob:1');
  assert.ok(music.gain.gain.value > 0);
});

test('iOS: a refused play() is retried by the next tap', async () => {
  FakeAudio.enforceGesture = true;
  const music = engine();
  await loaded(music, 'rain');
  tap(() => music.unlock());
  await flush();
  music.el.gestureUnlocked = false; // e.g. WebKit reset the element's permission
  music.setActive(true); // effect after TTS 'play' — not a gesture
  await flush();
  assert.equal(music.el.paused, true);
  tap(() => music.unlock());
  assert.equal(music.el.paused, false);
});

test('priming with silence never shows up as a loaded track or an error', async () => {
  FakeAudio.enforceGesture = true;
  const music = engine();
  tap(() => {
    music.setTrack('piano');
    music.unlock();
  });
  assert.equal(music.loadedId, null);
  await flush();
  assert.deepEqual(errors, []);
});

test('iOS: priming while switching tracks never replays the old track', async () => {
  FakeAudio.enforceGesture = true;
  const music = engine();
  await loaded(music, 'rain'); // A on the element, never played in a tap
  music.setActive(true);
  tap(() => music.unlock()); // unlocked + audible
  music.el.pause();
  music.elPrimed = false; // after a refused play() or an interruption
  tap(() => {
    music.setTrack('violin');
    music.unlock();
  });
  assert.notEqual(music.el.src, 'blob:1', 'old track must not be primed');
  assert.equal(music.gain.gain.value, 0);
  await flush();
  assert.equal(music.el.paused, true, 'silent until the new file lands');
  fetch.pending.at(-1).resolve();
  await flush();
  assert.equal(music.loadedId, 'violin');
  assert.equal(music.el.paused, false);
});
