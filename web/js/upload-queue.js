// Sequential upload queue for captured pages. Retries 3x with backoff; reports per-item status
// so the capture view can render a thumbnail strip. seq is client-assigned and increases from
// book.pages.next_seq (server is the source of truth on conflict — see handle409).
//
// C2: the queue must STOP at the first item that fails after retries — uploading later pages
// out of order would let the chunker fold seq N+1 right after N-1, silently reordering text.
// Items after a blocked one stay 'queued' (rendered as "Đang chờ trang trước" by the caller);
// a manual retry() of the blocking item resumes the queue from there.
import { pagesApi } from './api-client.js';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [500, 1500, 3500];
export const MAX_PAGES_PER_SESSION = 30;

/**
 * @typedef {{
 *   uploadId: string, seq: number, blob: Blob, objectUrl: string,
 *   status: 'queued'|'uploading'|'done'|'error', error?: string, attempts: number,
 * }} QueueItem
 */

export class UploadQueue {
  /** @param {string} bookId @param {(items: QueueItem[]) => void} onChange */
  constructor(bookId, onChange) {
    this.bookId = bookId;
    this.onChange = onChange;
    /** @type {QueueItem[]} */
    this.items = [];
    this._running = false;
  }

  get pendingCount() {
    return this.items.filter((i) => i.status !== 'done').length;
  }

  /** @param {Blob} blob @param {number} seq @returns {QueueItem} */
  enqueue(blob, seq) {
    const item = {
      uploadId: crypto.randomUUID(),
      seq,
      blob,
      objectUrl: URL.createObjectURL(blob),
      status: 'queued',
      attempts: 0,
    };
    this.items.push(item);
    this._emit();
    this._run();
    return item;
  }

  /**
   * Remove a page that has not been uploaded, keeping server seqs contiguous so the book never
   * waits on a hole:
   * - 'queued' (never sent): later queued items shift down one seq to close the gap.
   * - 'error' (a request may have reached the server): discard that seq on the server; later
   *   items keep their seq. If the server already has the page (409), it simply stays in the
   *   book. A network failure keeps the item and throws, so nothing is silently left blocking.
   * 'uploading' and 'done' items cannot be removed.
   * @param {string} uploadId
   */
  async remove(uploadId) {
    const idx = this.items.findIndex((i) => i.uploadId === uploadId);
    if (idx === -1) return;
    const item = this.items[idx];
    if (item.status === 'uploading' || item.status === 'done') return;

    if (item.status === 'error' && item.error !== 'seq_conflict') {
      try {
        await pagesApi.discard(this.bookId, item.seq);
      } catch (err) {
        if (!err || err.code !== 'page_not_discardable') {
          item.error = 'Không bỏ được trang khi mất mạng, thử lại sau';
          this._emit();
          throw err;
        }
      }
    } else {
      for (const later of this.items.slice(idx + 1)) {
        if (later.status === 'queued' || (later.status === 'error' && later.error === 'seq_conflict')) later.seq -= 1;
      }
    }
    this.items.splice(idx, 1);
    URL.revokeObjectURL(item.objectUrl);
    this._emit();
    this._run();
  }

  /** Seq for the next captured page: right after the last one in this session. */
  nextSeqAfter(fallback) {
    const last = this.items[this.items.length - 1];
    return last ? last.seq + 1 : fallback;
  }

  retry(uploadId) {
    const item = this.items.find((i) => i.uploadId === uploadId);
    if (!item || item.status !== 'error') return;
    item.status = 'queued';
    item.attempts = 0;
    item.error = undefined;
    this._emit();
    this._run();
  }

  async _run() {
    if (this._running) return;
    this._running = true;
    try {
      // Walk items strictly in capture order (== seq order). Stop at the first non-done item
      // that is (or becomes) 'error' — everything after it stays 'queued' and blocked until the
      // user retries or removes the blocking item.
      for (const item of this.items) {
        if (item.status === 'done') continue;
        if (item.status === 'error') break;
        if (item.status !== 'queued') continue; // 'uploading' from a re-entrant call — skip.
        await this._uploadOne(item);
        if (item.status === 'error') break;
      }
    } finally {
      this._running = false;
    }
  }

  async _uploadOne(item) {
    item.status = 'uploading';
    this._emit();
    while (item.attempts < MAX_ATTEMPTS) {
      try {
        await pagesApi.upload(this.bookId, item.blob, item.seq, item.uploadId);
        item.status = 'done';
        URL.revokeObjectURL(item.objectUrl);
        this._emit();
        return;
      } catch (err) {
        item.attempts += 1;
        if (err && err.code === 'page_seq_taken') {
          // Another device added pages concurrently — caller must refetch the book and
          // reassign seq for remaining queued items (see handleSeqConflict()).
          item.status = 'error';
          item.error = 'seq_conflict';
          this._emit();
          return;
        }
        if (item.attempts >= MAX_ATTEMPTS) {
          item.status = 'error';
          item.error = (err && err.message) || 'Lỗi tải lên, chạm để thử lại';
          this._emit();
          return;
        }
        await new Promise((r) => setTimeout(r, BACKOFF_MS[item.attempts - 1] || 3500));
      }
    }
  }

  /** Reassign seq for all items not yet done, starting at nextSeq (used after page_seq_taken). */
  reassignSeq(nextSeq) {
    let seq = nextSeq;
    for (const item of this.items) {
      if (item.status !== 'done') {
        item.seq = seq;
        if (item.status === 'error' && item.error === 'seq_conflict') {
          item.status = 'queued';
          item.attempts = 0;
          item.error = undefined;
        }
        seq += 1;
      }
    }
    this._emit();
    this._run();
  }

  _emit() {
    this.onChange([...this.items]);
  }
}
