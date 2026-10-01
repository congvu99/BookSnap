// Two-<audio> playlist: plays chunks in seq order, preloads the next chunk when <10s remain,
// keeps playbackRate across chunks, and pauses gracefully when the current chunk has no audio yet
// (waiting_quota/processing) — the caller re-polls chunks and calls setChunks() to resume.
const PRELOAD_THRESHOLD_MS = 10_000;

/**
 * @typedef {{id:string, seq:number, text:string, status:string, not_before:string|null,
 *   duration_ms:number|null, error:string|null, audio_url:string|null}} Chunk
 */

export class AudioPlaylist {
  /** @param {(state: object) => void} onUpdate */
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.a = new Audio();
    this.b = new Audio();
    this.a.preload = 'auto';
    this.b.preload = 'auto';
    /** @type {'a'|'b'} which element is currently playing */
    this.activeKey = 'a';
    /** @type {Chunk[]} */
    this.chunks = [];
    this.rate = 1;
    this.currentSeq = null;
    /** True while the active element wants to play but is waiting for data. */
    this._buffering = false;
    // H3: HTMLMediaElement.src reflects the *resolved* URL — once the attribute has ever been
    // set, `el.src` is never falsy again (assigning '' makes it resolve to the page's own URL,
    // and even `removeAttribute('src')` leaves some browsers reporting the last value). Track
    // "what chunk seq is actually loaded on this element" ourselves instead of reading el.src.
    /** @type {{a: number|null, b: number|null}} */
    this._loaded = { a: null, b: null };
    this._bindEvents(this.a);
    this._bindEvents(this.b);
  }

  get active() {
    return this.activeKey === 'a' ? this.a : this.b;
  }
  get standby() {
    return this.activeKey === 'a' ? this.b : this.a;
  }

  _bindEvents(el) {
    el.addEventListener('timeupdate', () => {
      if (el !== this.active) return;
      this._maybePreloadNext();
      this._emit();
    });
    el.addEventListener('ended', () => {
      if (el !== this.active) return;
      this._buffering = false;
      this._advance();
    });
    el.addEventListener('play', () => this._emit());
    el.addEventListener('pause', () => {
      if (el === this.active) this._buffering = false;
      this._emit();
    });
    // Network starvation: the element wants to play but has no data for the next frame.
    el.addEventListener('waiting', () => this._setBuffering(el, true));
    el.addEventListener('stalled', () => this._setBuffering(el, !el.paused));
    el.addEventListener('playing', () => this._setBuffering(el, false));
    el.addEventListener('canplay', () => this._setBuffering(el, false));
  }

  /** Update the buffering flag from the active element only; emits on change. */
  _setBuffering(el, value) {
    if (el !== this.active) return;
    if (this._buffering === value) return;
    this._buffering = value;
    this._emit();
  }

  /** @param {Chunk[]} chunks */
  setChunks(chunks) {
    this.chunks = chunks;
    // If the chunk we're stuck on just became ready (nothing loaded on the active element for
    // it yet), resume automatically — this is the "player dừng ở đó và tự tiếp khi có audio" path.
    const current = this.chunks.find((c) => c.seq === this.currentSeq);
    if (current && current.audio_url && this.currentSeq !== null && this._loaded[this.activeKey] !== this.currentSeq) {
      this.loadAt(this.currentSeq, 0, this._wantsPlay);
    }
    this._emit();
  }

  _chunkBySeq(seq) {
    return this.chunks.find((c) => c.seq === seq) || null;
  }

  /**
   * Load and optionally play starting at chunkSeq/offsetMs.
   * @param {number} chunkSeq @param {number} offsetMs @param {boolean} [autoplay]
   */
  loadAt(chunkSeq, offsetMs = 0, autoplay = false) {
    this._wantsPlay = autoplay;
    this.currentSeq = chunkSeq;
    const chunk = this._chunkBySeq(chunkSeq);
    const el = this.active;
    if (!chunk || !chunk.audio_url) {
      el.removeAttribute('src');
      el.load();
      this._loaded[this.activeKey] = null;
      this._emit();
      return;
    }
    if (this._loaded[this.activeKey] !== chunkSeq) {
      el.src = chunk.audio_url;
      this._loaded[this.activeKey] = chunkSeq;
    }
    el.playbackRate = this.rate;
    el.currentTime = offsetMs / 1000;
    // A fresh src or seek has no data yet (readyState < HAVE_FUTURE_DATA): show buffering until `playing`.
    this._buffering = autoplay && el.readyState < 3;
    if (autoplay) el.play().catch(() => {});
    this._preloadedFor = null;
    this._maybePreloadNext();
    this._emit();
  }

  play() {
    this._wantsPlay = true;
    if (this._loaded[this.activeKey] != null) {
      this._buffering = this.active.readyState < 3;
      this.active.play().catch(() => {});
    } else this._emit();
  }

  pause() {
    this._wantsPlay = false;
    this.active.pause();
  }

  togglePlay() {
    if (this.active.paused) this.play();
    else this.pause();
  }

  /** @param {number} rate 0.75–2 */
  setRate(rate) {
    this.rate = rate;
    this.a.playbackRate = rate;
    this.b.playbackRate = rate;
    this._emit();
  }

  /** @param {number} deltaSeconds e.g. +15 or -15 */
  seekRelative(deltaSeconds) {
    const el = this.active;
    const chunk = this._chunkBySeq(this.currentSeq);
    if (!chunk) return;
    const durationS = (chunk.duration_ms || el.duration * 1000 || 0) / 1000;
    let next = el.currentTime + deltaSeconds;
    if (next < 0) {
      this._advance(-1, Math.max(0, durationS + next));
      return;
    }
    if (durationS && next > durationS) {
      this._advance(1, next - durationS);
      return;
    }
    el.currentTime = next;
    this._emit();
  }

  _advance(dir = 1, offsetSeconds = 0) {
    const idx = this.chunks.findIndex((c) => c.seq === this.currentSeq);
    const next = this.chunks[idx + dir];
    if (!next) {
      this.pause();
      return;
    }
    const wasPlaying = this._wantsPlay;
    const standbyKey = this.activeKey === 'a' ? 'b' : 'a';
    if (dir === 1 && this._loaded[standbyKey] === next.seq && this._preloadedFor === next.seq) {
      // Swap to the preloaded element instantly (gap < 300ms).
      this.activeKey = standbyKey;
      this.currentSeq = next.seq;
      this.active.currentTime = offsetSeconds;
      this.active.playbackRate = this.rate;
      this._buffering = Boolean(wasPlaying) && this.active.readyState < 3;
      if (wasPlaying) this.active.play().catch(() => {});
      this.standby.pause();
      this.standby.removeAttribute('src');
      this.standby.load();
      this._loaded[this.activeKey === 'a' ? 'b' : 'a'] = null;
      this._preloadedFor = null;
      this._maybePreloadNext();
      this._emit();
      return;
    }
    this.loadAt(next.seq, offsetSeconds * 1000, wasPlaying);
  }

  /** Public skip-to-next-chunk, wired to Media Session's `nexttrack` action (M3). */
  next() {
    this._advance(1);
  }

  /** Public skip-to-previous-chunk, wired to Media Session's `previoustrack` action (M3). */
  prev() {
    this._advance(-1);
  }

  _maybePreloadNext() {
    const el = this.active;
    if (!el.duration || Number.isNaN(el.duration)) return;
    const remainingMs = (el.duration - el.currentTime) * 1000;
    if (remainingMs > PRELOAD_THRESHOLD_MS) return;
    const idx = this.chunks.findIndex((c) => c.seq === this.currentSeq);
    const next = this.chunks[idx + 1];
    if (!next || !next.audio_url) return;
    if (this._preloadedFor === next.seq) return;
    const standbyKey = this.activeKey === 'a' ? 'b' : 'a';
    this.standby.src = next.audio_url;
    this.standby.playbackRate = this.rate;
    this._loaded[standbyKey] = next.seq;
    this._preloadedFor = next.seq;
  }

  /** @returns {{currentSeq:number|null, currentTimeMs:number, durationMs:number, playing:boolean, ready:boolean, buffering:boolean}} */
  getState() {
    const chunk = this._chunkBySeq(this.currentSeq);
    return {
      currentSeq: this.currentSeq,
      currentTimeMs: Math.round((this.active.currentTime || 0) * 1000),
      durationMs: chunk && chunk.duration_ms ? chunk.duration_ms : Math.round((this.active.duration || 0) * 1000),
      playing: !this.active.paused && !this.active.ended,
      ready: Boolean(chunk && chunk.audio_url),
      buffering: this._buffering,
      chunkStatus: chunk ? chunk.status : null,
      rate: this.rate,
    };
  }

  _emit() {
    this.onUpdate(this.getState());
  }

  destroy() {
    this.a.pause();
    this.b.pause();
    this.a.removeAttribute('src');
    this.a.load();
    this.b.removeAttribute('src');
    this.b.load();
  }
}
