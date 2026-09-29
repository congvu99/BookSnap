// Persist {chunk_seq, offset_ms} to localStorage every 5s + PUT server debounced 15s / on
// pause / on tab hide. On open, prefer whichever of local vs server is newer (by updated_at).
import { booksApi } from './api-client.js';
import { progressStorageKey } from './store.js';

const LOCAL_SAVE_MS = 5000;
const SERVER_DEBOUNCE_MS = 15000;

export class PlaybackProgress {
  /** @param {string} userId @param {string} bookId */
  constructor(userId, bookId) {
    this.userId = userId;
    this.bookId = bookId;
    this.key = progressStorageKey(userId, bookId);
    this._localTimer = null;
    this._serverTimer = null;
    this._pendingGetter = null;
  }

  /** Fetch server + local progress and return whichever is newer (server ties preferred). */
  async load() {
    const local = this._readLocal();
    let server = null;
    try {
      server = await booksApi.getProgress(this.bookId);
    } catch {
      // Offline or server error — fall back to local only.
    }
    if (server && server.updated_at && (!local || new Date(server.updated_at) >= new Date(local.updated_at))) {
      return { chunk_seq: server.chunk_seq, offset_ms: server.offset_ms };
    }
    if (local) return { chunk_seq: local.chunk_seq, offset_ms: local.offset_ms };
    if (server) return { chunk_seq: server.chunk_seq, offset_ms: server.offset_ms };
    return { chunk_seq: 0, offset_ms: 0 };
  }

  _readLocal() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  _writeLocal(chunkSeq, offsetMs) {
    try {
      localStorage.setItem(this.key, JSON.stringify({ chunk_seq: chunkSeq, offset_ms: offsetMs, updated_at: new Date().toISOString() }));
    } catch {
      // Storage full/unavailable — non-fatal, server PUT is still attempted below.
    }
  }

  /** Call frequently (e.g. every timeupdate); throttles writes internally. */
  track(chunkSeq, offsetMs) {
    this._lastValue = { chunkSeq, offsetMs };
    if (!this._localTimer) {
      this._localTimer = setTimeout(() => {
        this._localTimer = null;
        if (this._lastValue) this._writeLocal(this._lastValue.chunkSeq, this._lastValue.offsetMs);
      }, LOCAL_SAVE_MS);
    }
    if (!this._serverTimer) {
      this._serverTimer = setTimeout(() => {
        this._serverTimer = null;
        this._pushServer();
      }, SERVER_DEBOUNCE_MS);
    }
  }

  /** Flush immediately (pause, visibilitychange hidden, before navigating away). */
  flush() {
    if (!this._lastValue) return;
    this._writeLocal(this._lastValue.chunkSeq, this._lastValue.offsetMs);
    this._pushServer();
  }

  _pushServer() {
    if (!this._lastValue) return;
    const { chunkSeq, offsetMs } = this._lastValue;
    booksApi.putProgress(this.bookId, { chunk_seq: chunkSeq, offset_ms: offsetMs }).catch(() => {
      // Network failure — local copy already has the latest position, retried on next track().
    });
  }

  destroy() {
    clearTimeout(this._localTimer);
    clearTimeout(this._serverTimer);
  }
}
