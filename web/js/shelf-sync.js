// Optimistic on/off state of one book on the shelf, framework-free.
// `send(on)` performs the PUT/DELETE. Requests are serialised: at most one is in flight, and the
// loop keeps going until the server state matches the user's latest wish. A failure drops the wish
// and falls back to the last server-confirmed state. Server values pushed via setServer() only move
// the confirmed state; a pending wish keeps winning so a stale poll cannot flip the UI back.
export class ShelfSync {
  /**
   * @param {(on: boolean) => Promise<unknown>} send
   * @param {{ onChange?: (shown: boolean) => void, onError?: (err: any) => void }} [hooks]
   */
  constructor(send, hooks = {}) {
    this.send = send;
    this.onChange = hooks.onChange || (() => {});
    this.onError = hooks.onError || (() => {});
    this.confirmed = false;
    /** @type {boolean|null} latest user wish not yet confirmed (null = none) */
    this.wanted = null;
    this.syncing = false;
    this.disposed = false;
  }

  /** What the UI should show right now. */
  get shown() {
    return this.wanted === null ? this.confirmed : this.wanted;
  }

  /** @param {boolean} on latest value known from the server */
  setServer(on) {
    this.confirmed = Boolean(on);
    this.onChange(this.shown);
  }

  toggle() {
    this.wanted = !this.shown;
    this.onChange(this.shown);
    return this.#sync();
  }

  dispose() {
    this.disposed = true;
  }

  async #sync() {
    if (this.syncing) return; // the running loop picks up the newest wish
    this.syncing = true;
    try {
      while (this.wanted !== null && this.wanted !== this.confirmed) {
        const on = this.wanted;
        try {
          await this.send(on);
        } catch (err) {
          this.wanted = null;
          if (!this.disposed) {
            this.onChange(this.shown);
            this.onError(err);
          }
          return;
        }
        this.confirmed = on;
      }
      this.wanted = null;
      if (!this.disposed) this.onChange(this.shown);
    } finally {
      this.syncing = false;
    }
  }
}
