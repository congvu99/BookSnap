// Pure progress logic for the book status view and the library (no Preact, unit-testable in node).
// Everything is derived from the raw counters in book_out; `book.state` is only used for the
// finished check because the backend reports `processing` ahead of `failed` / `waiting_quota`.

const OCR_WEIGHT = 0.3;
const TTS_WEIGHT = 0.7;

/** @returns {number} 0-100, never below `prev` so the bar cannot shrink while the view is open. */
export function overallPercent(book, prev = 0) {
  if (book.state === 'ready') return 100;
  const { pages, chunks } = book;
  const ocr = pages.done / Math.max(1, pages.total - (pages.discarded || 0));
  const tts = chunks.total > 0 ? chunks.done / chunks.total : 0;
  const raw = Math.round(100 * (OCR_WEIGHT * Math.min(1, ocr) + TTS_WEIGHT * Math.min(1, tts)));
  return Math.max(prev, Math.min(100, Math.max(0, raw)));
}

/**
 * Priority: failed > quota > ocr > tts > tail_wait > empty > ready.
 * Uses `chunks.queued`, never `chunks.processing`: the server counts the held-back tail as
 * processing too, so `processing > 0` would hide the tail wait (and its "đọc luôn" button) forever.
 * @returns {'failed'|'quota'|'ocr'|'tts'|'tail_wait'|'empty'|'ready'}
 */
export function phaseOf(book) {
  const { pages, chunks } = book;
  if (pages.failed > 0 || chunks.failed > 0 || pages.blocked_at_seq != null) return 'failed';
  if (chunks.waiting_quota > 0) return 'quota';
  if (pages.processing > 0) return 'ocr';
  if (chunks.queued > 0) return 'tts';
  if (chunks.tail_waiting) return 'tail_wait';
  if (pages.total === 0) return 'empty';
  return 'ready';
}

/** Whether the view still has anything to poll for. */
export function isBusyPhase(phase) {
  return phase !== 'ready' && phase !== 'empty';
}

/** Simple linear ETA: anchor at the first observation, extrapolate the average chunk rate. */
export function createEta() {
  let start = null; // { done, at }
  let last = null; // { done, total }
  return {
    observe(done, total, atMs) {
      if (start === null) start = { done, at: atMs };
      last = { done, total };
    },
    /** @returns {number|null} */
    remainingMs(atMs) {
      if (!start || !last || last.done <= start.done) return null;
      const left = last.total - last.done;
      if (left <= 0) return null;
      return (left * (atMs - start.at)) / (last.done - start.done);
    },
  };
}

/** @param {number|null|undefined} ms */
export function formatEta(ms) {
  if (ms == null) return '';
  if (ms < 60000) return 'dưới 1 phút';
  return `khoảng ${Math.round(ms / 60000)} phút`;
}

/** @param {number} sec m:ss */
export function formatCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Local HH:MM for an ISO timestamp; falls back to the raw text when unparsable. */
export function defaultFormatClock(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * @param {object} book
 * @param {{ etaMs?: number|null, countdownSeconds?: number|null, formatClock?: (v: string) => string }} [opts]
 */
export function statusLine(book, { etaMs = null, countdownSeconds = null, formatClock = defaultFormatClock } = {}) {
  const { pages, chunks } = book;
  switch (phaseOf(book)) {
    case 'failed':
      return 'Có trang/đoạn lỗi, xem bên dưới';
    case 'quota':
      return chunks.next_not_before
        ? `Hết lượt Gemini, tự tiếp tục lúc ${formatClock(chunks.next_not_before)}`
        : 'Hết lượt Gemini, sẽ tự tiếp tục sau';
    case 'ocr':
      return `Đang nhận dạng chữ trang ${pages.done + 1}/${pages.total}…`;
    case 'tts': {
      const base = `Đang chuyển giọng đoạn ${chunks.done + 1}/${chunks.total}`;
      return etaMs != null ? `${base} · còn ${formatEta(etaMs)}` : base;
    }
    case 'tail_wait':
      return countdownSeconds != null && countdownSeconds > 0
        ? `Đang chờ thêm trang… đoạn cuối sẽ đọc sau ${formatCountdown(countdownSeconds)}`
        : 'Sắp đọc đoạn cuối…';
    case 'empty':
      return 'Chưa có trang nào';
    default:
      return 'Sách đã sẵn sàng';
  }
}

/** Short label under a library record. */
export function libraryLabel(book) {
  const { pages, chunks } = book;
  switch (phaseOf(book)) {
    case 'failed': return 'Có lỗi';
    case 'quota': return 'Chờ lượt Gemini';
    case 'ocr': return `Đang đọc chữ · ${pages.done}/${pages.total} trang`;
    case 'tts': return `Đang ép đĩa · ${chunks.done}/${chunks.total}`;
    case 'tail_wait': return 'Chờ thêm trang';
    case 'empty': return 'Chưa có trang';
    default: return 'Sẵn sàng';
  }
}
