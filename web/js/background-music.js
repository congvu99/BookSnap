// Background music engine: one looping <audio> routed through a GainNode (background-music-graph.js).
// The file is fetched whole (no Range, so the service worker can cache the 200) and played from a
// blob: URL. The engine follows the TTS: setActive(true) fades in, setActive(false) waits a short
// grace period (chunk swaps flicker `playing`) then fades out and really pauses to save battery.
// Nothing here may throw into the reader — failures are reported through onError and the TTS
// keeps playing untouched.
import { findTrack } from './background-music-tracks.js';
import { DEFAULT_PREFS, clampVolume, effectiveGain } from './background-music-prefs.js';
import { AudioCtx, createGainGraph, rampGain, silentClipUrl } from './background-music-graph.js';

const PAUSE_GRACE_MS = 600;
const FADE_S = 1;
const SWITCH_FADE_S = 0.4;
const VOLUME_RAMP_S = 0.1;
const LOAD_ERROR = 'Không tải được nhạc nền';
const noop = () => {};

export class BackgroundMusic {
  /** @param {{onError?: (message: string) => void}} [opts] */
  constructor(opts = {}) {
    this.onError = opts.onError || noop;
    this.el = new Audio();
    this.el.loop = true;
    this.el.preload = 'auto';
    this.el.addEventListener('error', () => this.loadedId && this._fail(LOAD_ERROR, this.el.error));
    /** @type {AudioContext|null} */ this.ctx = null;
    /** @type {GainNode|null} */ this.gain = null;
    /** Web Audio exists but the graph could not be built: stay silent rather than play at full volume. */
    this.unsupported = false;
    /** iOS only allows play() outside a tap once the element has been played inside one. */
    this.elPrimed = false;
    /** @type {import('./background-music-tracks.js').AmbientTrack|null} */ this.track = null;
    /** id of the track whose blob is on `el` right now */ this.loadedId = null;
    this.objectUrl = null;
    this.volume = DEFAULT_PREFS.volume;
    this.active = false;
    this.destroyed = false;
    this.loadToken = 0;
    /** @type {AbortController|null} */ this.abort = null;
    this.pauseTimer = this.stopTimer = this.swapTimer = undefined;
  }

  /**
   * Must run synchronously inside a user gesture (play tap, track chip): iOS only lets an
   * AudioContext — and a media element — start there. No-op while no track is chosen, so "Tắt"
   * never creates a context.
   */
  unlock() {
    if (this.destroyed || this.unsupported || !this.track || !AudioCtx) return;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      if (!this.ctx) {
        ({ ctx: this.ctx, gain: this.gain } = createGainGraph(this.el));
        this.ctx.onstatechange = () => this._onContextState();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(noop);
    } catch (err) {
      this.unsupported = true;
      this._fail('Trình duyệt không hỗ trợ nhạc nền', err);
      return;
    }
    this._prime();
    if (this.active) this._start();
  }

  /**
   * Play the element once inside the current tap (gain is 0): the real file when it is already
   * loaded, else a 10ms silent clip — the file usually arrives after the tap, and iOS refuses a
   * first play() that is not in a gesture.
   */
  _prime() {
    if (this.elPrimed || !this.el.paused) return;
    const chosenLoaded = () => Boolean(this.track && this.loadedId === this.track.id);
    this._rampTo(0, 0);
    if (!chosenLoaded()) {
      if (this.loadedId) this._unload(); // the previous track, mid-switch: never play it again
      this.el.src = silentClipUrl();
    }
    this.elPrimed = true; // WebKit lifts the restriction when play() is called in the gesture
    this.el.play().then(() => (chosenLoaded() && this.active) || this.el.pause(), noop);
  }

  /** @param {string|null} id */
  setTrack(id) {
    if (this.destroyed) return;
    const track = findTrack(id);
    if ((track && track.id) === (this.track && this.track.id)) return;
    this.track = track;
    const token = ++this.loadToken;
    if (this.abort) this.abort.abort();
    this.abort = null;
    clearTimeout(this.swapTimer);
    const swap = () => {
      this.swapTimer = undefined;
      if (token !== this.loadToken || this.destroyed) return;
      if (track && this.loadedId === track.id) return this._start(); // A→B→A inside the fade
      this.el.pause();
      if (track) this._load(track, token);
      else this._unload();
    };
    if (this.el.paused) swap();
    else {
      this._rampTo(0, SWITCH_FADE_S);
      this.swapTimer = setTimeout(swap, SWITCH_FADE_S * 1000 + 50);
    }
  }

  /** @param {number} volume 0..MAX_VOLUME */
  setVolume(volume) {
    this.volume = clampVolume(volume);
    const fading = this.stopTimer !== undefined || this.swapTimer !== undefined;
    if (!this.el.paused && !fading) this._rampTo(effectiveGain(this.volume, this.track), VOLUME_RAMP_S);
  }

  /** @param {boolean} on whether the reading voice is currently playing */
  setActive(on) {
    if (this.destroyed) return;
    this.active = on;
    if (on) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
      this._start();
      return;
    }
    if (this.pauseTimer !== undefined || this.el.paused) return;
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      if (!this.active) this._fadeOutAndPause();
    }, PAUSE_GRACE_MS);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.pauseTimer);
    clearTimeout(this.stopTimer);
    clearTimeout(this.swapTimer);
    if (this.abort) this.abort.abort();
    this._unload();
    const ctx = this.ctx;
    this.ctx = this.gain = null;
    if (ctx) ctx.close().catch(noop);
  }

  _start() {
    if (this.unsupported || !this.active || !this.track || this.loadedId !== this.track.id || this.swapTimer !== undefined) return;
    // Without a gesture-unlocked context the element would play at full volume on iOS — wait.
    if (AudioCtx && !this.ctx) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = undefined;
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(noop);
    this.el.play().catch((err) => {
      if (!err || err.name === 'AbortError') return;
      if (err.name === 'NotAllowedError') {
        this.elPrimed = false; // the next tap primes again
        this._rampTo(0, 0); // so that priming cannot blip at the old level
      }
      console.warn('[bg-music] play rejected', err);
    });
    this._rampTo(effectiveGain(this.volume, this.track), FADE_S);
  }

  /** iOS suspends/"interrupts" the context (calls, Siri, background): don't keep decoding into it. */
  _onContextState() {
    if (!this.ctx) return;
    if (this.ctx.state === 'running') this._start();
    else if (!this.el.paused) this.el.pause();
  }

  _fadeOutAndPause() {
    this._rampTo(0, FADE_S);
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      this.stopTimer = undefined;
      if (!this.active) this.el.pause();
    }, FADE_S * 1000 + 50);
  }

  /** @param {import('./background-music-tracks.js').AmbientTrack} track @param {number} token */
  _load(track, token) {
    const abort = new AbortController();
    this.abort = abort;
    const stale = () => token !== this.loadToken || this.destroyed;
    fetch(track.url, { signal: abort.signal, credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (stale()) return;
        this._unload();
        this.objectUrl = URL.createObjectURL(blob);
        this.el.src = this.objectUrl;
        this.loadedId = track.id;
        this._rampTo(0, 0);
        this._start();
      })
      .catch((err) => (err && err.name === 'AbortError') || stale() || this._fail(LOAD_ERROR, err))
      .finally(() => this.abort === abort && (this.abort = null));
  }

  _unload() {
    this.loadedId = null;
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  _rampTo(target, seconds) {
    if (this.ctx && this.gain) rampGain(this.ctx, this.gain, target, seconds);
    else this.el.volume = Math.min(1, Math.max(0, target)); // no Web Audio at all: best effort
  }

  _fail(message, err) {
    console.warn('[bg-music]', message, err);
    try {
      this.onError(message);
    } catch {
      /* a failing UI callback must not break playback */
    }
  }
}
