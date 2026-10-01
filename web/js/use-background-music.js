// Preact binding for BackgroundMusic: owns one engine per reader instance, follows the TTS
// `playing` flag, persists {track, volume} per device and exposes a short-lived error message
// for the reader toast. `setTrack` and `unlock` must be called from user-gesture handlers.
import { useEffect, useRef, useState } from '../vendor/preact-htm.module.js';
import { BackgroundMusic } from './background-music.js';
import { AMBIENT_TRACKS } from './background-music-tracks.js';
import { readPrefs, writePrefs, clampVolume } from './background-music-prefs.js';

const MESSAGE_MS = 2400;

function deviceStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * @param {boolean} playing
 * @returns {{trackId: string|null, volume: number, message: string|null,
 *   setTrack: (id: string|null) => void, setVolume: (v: number) => void, previewVolume: (v: number) => void, unlock: () => void}}
 */
export function useBackgroundMusic(playing) {
  const [prefs, setPrefs] = useState(() => readPrefs(deviceStorage(), AMBIENT_TRACKS));
  const prefsRef = useRef(prefs);
  const [message, setMessage] = useState(/** @type {string|null} */ (null));
  const engineRef = useRef(/** @type {BackgroundMusic|null} */ (null));
  const timer = useRef(/** @type {number|undefined} */ (undefined));

  useEffect(() => {
    const engine = new BackgroundMusic({
      onError: (text) => {
        if (engineRef.current !== engine) return;
        setMessage(text);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMessage(null), MESSAGE_MS);
      },
    });
    engine.setVolume(prefs.volume);
    engine.setTrack(prefs.track);
    engineRef.current = engine;
    return () => {
      engineRef.current = null;
      window.clearTimeout(timer.current);
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.setActive(playing);
  }, [playing]);

  /** @param {{track?: string|null, volume?: number}} patch */
  function persist(patch) {
    // Ref, not `prefs`: several slider events can land before the next render.
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    writePrefs(deviceStorage(), next);
  }

  function setTrack(id) {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setTrack(id);
    engine.unlock(); // same tap: lets iOS start the context if the TTS is already playing
    persist({ track: id });
  }

  function setVolume(v) {
    const volume = clampVolume(v);
    if (engineRef.current) engineRef.current.setVolume(volume);
    persist({ volume });
  }

  /** Audible while dragging: the engine ramps by itself, nothing is persisted or re-rendered. */
  function previewVolume(v) {
    if (engineRef.current) engineRef.current.setVolume(clampVolume(v));
  }

  function unlock() {
    if (engineRef.current) engineRef.current.unlock();
  }

  return { trackId: prefs.track, volume: prefs.volume, message, setTrack, setVolume, previewVolume, unlock };
}
