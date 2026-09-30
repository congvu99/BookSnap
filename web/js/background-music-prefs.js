// Per-device background-music preference ({track, volume}) — pure helpers, no DOM/Preact, so
// they run under `node --test`. Storage may be missing or throw (private mode, quota), and the
// stored JSON may be stale (a track removed from the catalogue): every path falls back to defaults.

export const PREFS_KEY = 'booksnap:bgMusic';
// Files peak at -1 dBFS, so the gain stage itself cannot clip; 100% puts the bed about level with
// the voice (-18 vs ~-16 LUFS). Default is full volume: the listener turns it down in the sheet.
export const MAX_VOLUME = 1;
export const DEFAULT_PREFS = Object.freeze({ track: null, volume: 1 });

/** @param {unknown} v @returns {number} */
export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_PREFS.volume;
  return Math.min(MAX_VOLUME, Math.max(0, n));
}

/**
 * @param {{getItem:(k:string)=>string|null}|null|undefined} storage
 * @param {{id:string}[]} tracks
 * @returns {{track:string|null, volume:number}}
 */
export function readPrefs(storage, tracks) {
  let raw = null;
  try {
    raw = storage ? storage.getItem(PREFS_KEY) : null;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!raw) return { ...DEFAULT_PREFS };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
  const track = tracks.some((t) => t.id === parsed.track) ? parsed.track : null;
  const volume = 'volume' in parsed ? clampVolume(parsed.volume) : DEFAULT_PREFS.volume;
  return { track, volume };
}

/**
 * @param {{setItem:(k:string, v:string)=>void}|null|undefined} storage
 * @param {{track:string|null, volume:number}} prefs
 * @returns {boolean} false when the browser refused to store it
 */
export function writePrefs(storage, prefs) {
  try {
    if (!storage) return false;
    storage.setItem(PREFS_KEY, JSON.stringify({ track: prefs.track, volume: clampVolume(prefs.volume) }));
    return true;
  } catch {
    return false;
  }
}

/** Gain actually applied to the GainNode for a slider volume and a track. */
export function effectiveGain(volume, track) {
  if (!track) return 0;
  return clampVolume(volume) * (Number.isFinite(track.gain) ? track.gain : 1);
}
