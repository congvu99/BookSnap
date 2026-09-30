import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PREFS_KEY,
  MAX_VOLUME,
  DEFAULT_PREFS,
  clampVolume,
  readPrefs,
  writePrefs,
  effectiveGain,
} from '../../web/js/background-music-prefs.js';
import { AMBIENT_TRACKS, findTrack } from '../../web/js/background-music-tracks.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

const throwing = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

test('readPrefs falls back to defaults when nothing, garbage or a non-object is stored', () => {
  assert.deepEqual(readPrefs(memoryStorage(), AMBIENT_TRACKS), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '{not json' }), AMBIENT_TRACKS), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: '42' }), AMBIENT_TRACKS), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memoryStorage({ [PREFS_KEY]: 'null' }), AMBIENT_TRACKS), DEFAULT_PREFS);
});

test('readPrefs survives missing or throwing storage', () => {
  assert.deepEqual(readPrefs(null, AMBIENT_TRACKS), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(throwing, AMBIENT_TRACKS), DEFAULT_PREFS);
});

test('readPrefs drops a track that is no longer in the catalogue but keeps the volume', () => {
  const storage = memoryStorage({ [PREFS_KEY]: JSON.stringify({ track: 'thunderstorm', volume: 0.35 }) });
  assert.deepEqual(readPrefs(storage, AMBIENT_TRACKS), { track: null, volume: 0.35 });
});

test('readPrefs clamps an out-of-range volume instead of resetting the track', () => {
  const loud = memoryStorage({ [PREFS_KEY]: JSON.stringify({ track: 'rain', volume: 5 }) });
  assert.deepEqual(readPrefs(loud, AMBIENT_TRACKS), { track: 'rain', volume: MAX_VOLUME });
  const negative = memoryStorage({ [PREFS_KEY]: JSON.stringify({ track: 'rain', volume: -1 }) });
  assert.deepEqual(readPrefs(negative, AMBIENT_TRACKS), { track: 'rain', volume: 0 });
  const nan = memoryStorage({ [PREFS_KEY]: JSON.stringify({ track: 'rain', volume: 'loud' }) });
  assert.deepEqual(readPrefs(nan, AMBIENT_TRACKS), { track: 'rain', volume: DEFAULT_PREFS.volume });
});

test('writePrefs round-trips through readPrefs and clamps on the way in', () => {
  const storage = memoryStorage();
  assert.equal(writePrefs(storage, { track: 'violin', volume: 1.5 }), true);
  assert.deepEqual(readPrefs(storage, AMBIENT_TRACKS), { track: 'violin', volume: MAX_VOLUME });
  assert.equal(writePrefs(storage, { track: null, volume: 0.25 }), true);
  assert.deepEqual(readPrefs(storage, AMBIENT_TRACKS), { track: null, volume: 0.25 });
});

test('writePrefs reports failure instead of throwing', () => {
  assert.equal(writePrefs(throwing, { track: 'rain', volume: 0.2 }), false);
  assert.equal(writePrefs(null, { track: 'rain', volume: 0.2 }), false);
});

test('clampVolume keeps values inside 0..MAX_VOLUME', () => {
  assert.equal(clampVolume(0.3), 0.3);
  assert.equal(clampVolume('0.4'), 0.4);
  assert.equal(clampVolume(2), MAX_VOLUME);
  assert.equal(clampVolume(Infinity), DEFAULT_PREFS.volume);
});

test('effectiveGain scales the slider by the track gain and is silent without a track', () => {
  assert.equal(effectiveGain(0.5, findTrack('rain')), 0.5);
  assert.equal(effectiveGain(0.5, findTrack('violin')), 0.5);
  assert.ok(Math.abs(effectiveGain(0.5, { gain: 0.6 }) - 0.3) < 1e-9);
  assert.equal(effectiveGain(0.5, null), 0);
  assert.equal(effectiveGain(0.5, { gain: NaN }), 0.5);
});

test('catalogue ids are unique and every track points at web/audio/ambient', () => {
  const ids = AMBIENT_TRACKS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of AMBIENT_TRACKS) {
    assert.match(t.url, /^\/audio\/ambient\/[a-z-]+\.mp3$/);
    assert.ok(t.gain > 0 && t.gain <= 1);
  }
  assert.equal(findTrack(null), null);
  assert.equal(findTrack('nope'), null);
});
