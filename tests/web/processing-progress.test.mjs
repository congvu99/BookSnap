import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  overallPercent,
  phaseOf,
  createEta,
  formatEta,
  formatCountdown,
  statusLine,
  libraryLabel,
} from '../../web/js/processing-progress.js';

/** Build a book with sane zero defaults; overrides are merged per section. */
function makeBook({ state = 'processing', pages = {}, chunks = {} } = {}) {
  return {
    state,
    pages: { total: 0, done: 0, failed: 0, processing: 0, discarded: 0, blocked_at_seq: null, ...pages },
    chunks: {
      total: 0, done: 0, waiting_quota: 0, failed: 0, processing: 0, queued: 0,
      tail_waiting: false, next_not_before: null, ...chunks,
    },
  };
}

test('overallPercent: empty book is 0', () => {
  assert.equal(overallPercent(makeBook()), 0);
});

test('overallPercent: half OCR and no chunks is 15', () => {
  assert.equal(overallPercent(makeBook({ pages: { total: 4, done: 2 } })), 15);
});

test('overallPercent: ready is 100', () => {
  assert.equal(overallPercent(makeBook({ state: 'ready' })), 100);
});

test('overallPercent: never drops below prev', () => {
  assert.equal(overallPercent(makeBook({ pages: { total: 4, done: 2 } }), 40), 40);
});

test('overallPercent: discarded pages leave the OCR denominator', () => {
  // 2 done of (4 - 2 discarded) = full OCR = 30
  assert.equal(overallPercent(makeBook({ pages: { total: 4, done: 2, discarded: 2 } })), 30);
});

test('overallPercent: mixes 30% OCR and 70% TTS', () => {
  const b = makeBook({ pages: { total: 2, done: 2 }, chunks: { total: 10, done: 5 } });
  assert.equal(overallPercent(b), 65);
});

test('phaseOf: failed wins over pending tail', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3, failed: 1 }, chunks: { tail_waiting: true } })), 'failed');
  assert.equal(phaseOf(makeBook({ chunks: { failed: 1 } })), 'failed');
  assert.equal(phaseOf(makeBook({ pages: { total: 3, blocked_at_seq: 1 } })), 'failed');
});

test('phaseOf: waiting_quota beats ocr', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3, processing: 1 }, chunks: { waiting_quota: 2 } })), 'quota');
});

test('phaseOf: processing page beats tts', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3, processing: 1 }, chunks: { queued: 2 } })), 'ocr');
});

test('phaseOf: queued chunks with tail flag off is tts', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3 }, chunks: { queued: 3, tail_waiting: false } })), 'tts');
});

// Server shapes (app/repositories/book_repository.py): `processing` counts pending + processing,
// so the held-back tail alone is processing:1, queued:0; `queued` excludes only that tail.
test('phaseOf: a chunk being synthesised (queued>0) is tts', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3 }, chunks: { queued: 1, processing: 2, tail_waiting: false } })), 'tts');
});

test('phaseOf: only the held-back tail left (server shape) is tail_wait', () => {
  assert.equal(phaseOf(makeBook({ pages: { total: 3 }, chunks: { total: 2, done: 1, processing: 1, queued: 0, tail_waiting: true } })), 'tail_wait');
});

test('phaseOf: empty and ready', () => {
  assert.equal(phaseOf(makeBook({ state: 'empty' })), 'empty');
  assert.equal(phaseOf(makeBook({ state: 'ready', pages: { total: 2, done: 2 }, chunks: { total: 3, done: 3 } })), 'ready');
});

test('phaseOf ignores book.state', () => {
  const b = makeBook({ state: 'processing', pages: { total: 2, done: 2, failed: 1 } });
  assert.equal(phaseOf(b), 'failed');
});

test('createEta: null before any progress', () => {
  const eta = createEta();
  assert.equal(eta.remainingMs(0), null);
  eta.observe(3, 10, 0);
  assert.equal(eta.remainingMs(5000), null);
});

test('createEta: 2 chunks in 20s with 5 left is about 50s', () => {
  const eta = createEta();
  eta.observe(1, 8, 0);
  eta.observe(3, 8, 20000);
  assert.equal(eta.remainingMs(20000), 50000);
});

test('createEta: null when done is complete', () => {
  const eta = createEta();
  eta.observe(0, 2, 0);
  eta.observe(2, 2, 10000);
  assert.equal(eta.remainingMs(10000), null);
});

test('formatCountdown', () => {
  assert.equal(formatCountdown(47), '0:47');
  assert.equal(formatCountdown(125), '2:05');
  assert.equal(formatCountdown(-3), '0:00');
});

test('formatEta', () => {
  assert.equal(formatEta(30000), 'dưới 1 phút');
  assert.equal(formatEta(3 * 60000), 'khoảng 3 phút');
  assert.equal(formatEta(61 * 60000), 'khoảng 61 phút');
  assert.equal(formatEta(null), '');
});

const clock = (s) => `CLK(${s})`;

test('statusLine: failed', () => {
  const b = makeBook({ chunks: { failed: 1 } });
  assert.equal(statusLine(b, { formatClock: clock }), 'Có trang/đoạn lỗi, xem bên dưới');
});

test('statusLine: quota shows resume clock', () => {
  const b = makeBook({ chunks: { waiting_quota: 1, next_not_before: '2026-01-01T10:00:00Z' } });
  assert.equal(statusLine(b, { formatClock: clock }), 'Hết lượt Gemini, tự tiếp tục lúc CLK(2026-01-01T10:00:00Z)');
});

test('statusLine: ocr', () => {
  const b = makeBook({ pages: { total: 5, done: 2, processing: 1 } });
  assert.equal(statusLine(b, {}), 'Đang nhận dạng chữ trang 3/5…');
});

test('statusLine: tts with and without ETA', () => {
  const b = makeBook({ pages: { total: 2, done: 2 }, chunks: { total: 6, done: 2, queued: 4 } });
  assert.equal(statusLine(b, {}), 'Đang chuyển giọng đoạn 3/6');
  assert.equal(statusLine(b, { etaMs: 120000 }), 'Đang chuyển giọng đoạn 3/6 · còn khoảng 2 phút');
  assert.equal(statusLine(b, { etaMs: 20000 }), 'Đang chuyển giọng đoạn 3/6 · còn dưới 1 phút');
});

test('statusLine: tail_wait counts down then flips', () => {
  const b = makeBook({ pages: { total: 2 }, chunks: { tail_waiting: true } });
  assert.equal(statusLine(b, { countdownSeconds: 47 }), 'Đang chờ thêm trang… đoạn cuối sẽ đọc sau 0:47');
  assert.equal(statusLine(b, { countdownSeconds: 0 }), 'Sắp đọc đoạn cuối…');
  assert.equal(statusLine(b, { countdownSeconds: null }), 'Sắp đọc đoạn cuối…');
});

test('statusLine: empty and ready', () => {
  assert.equal(statusLine(makeBook(), {}), 'Chưa có trang nào');
  assert.equal(statusLine(makeBook({ state: 'ready', pages: { total: 1, done: 1 } }), {}), 'Sách đã sẵn sàng');
});

test('libraryLabel per phase', () => {
  assert.equal(libraryLabel(makeBook({ pages: { total: 5, done: 2, processing: 1 } })), 'Đang đọc chữ · 2/5 trang');
  assert.equal(libraryLabel(makeBook({ pages: { total: 2, done: 2 }, chunks: { total: 6, done: 2, queued: 4 } })), 'Đang ép đĩa · 2/6');
  assert.equal(libraryLabel(makeBook({ pages: { total: 2 }, chunks: { tail_waiting: true } })), 'Chờ thêm trang');
  assert.equal(libraryLabel(makeBook({ chunks: { waiting_quota: 1 } })), 'Chờ lượt Gemini');
  assert.equal(libraryLabel(makeBook({ chunks: { failed: 1 } })), 'Có lỗi');
  assert.equal(libraryLabel(makeBook({ state: 'ready', pages: { total: 1, done: 1 } })), 'Sẵn sàng');
  assert.equal(libraryLabel(makeBook()), 'Chưa có trang');
});
