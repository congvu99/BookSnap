import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_LEAD_IN_MS,
  seekForPage,
  pageAt,
  chunksSignature,
  pageStatusLabel,
  reconcileAnchors,
  hasUnsettledPages,
} from '../../web/js/page-position.js';

const ready = (page_seq, chunk_seq, chunk_frac) => ({ page_seq, status: 'ready', chunk_seq, chunk_frac, excerpt: '' });
const other = (page_seq, status) => ({ page_seq, status, chunk_seq: null, chunk_frac: null, excerpt: '' });

test('seekForPage: start of chunk plays from 0', () => {
  assert.deepEqual(seekForPage(ready(0, 3, 0), { seq: 3, duration_ms: 60000 }), { seq: 3, offsetMs: 0 });
});

test('seekForPage: mid-chunk backs off by the lead-in', () => {
  assert.equal(PAGE_LEAD_IN_MS, 1500);
  assert.deepEqual(seekForPage(ready(1, 2, 0.5), { seq: 2, duration_ms: 60000 }), { seq: 2, offsetMs: 28500 });
});

test('seekForPage: lead-in never goes below 0', () => {
  assert.equal(seekForPage(ready(1, 0, 0.01), { seq: 0, duration_ms: 60000 }).offsetMs, 0);
});

test('seekForPage: chunk without audio yet starts at 0', () => {
  assert.deepEqual(seekForPage(ready(1, 4, 0.7), { seq: 4, duration_ms: null }), { seq: 4, offsetMs: 0 });
  assert.deepEqual(seekForPage(ready(1, 4, 0.7), undefined), { seq: 4, offsetMs: 0 });
});

test('seekForPage: page that is not ready cannot be sought', () => {
  assert.equal(seekForPage(other(2, 'pending'), { seq: 0, duration_ms: 1000 }), null);
});

test('pageAt: position inside one chunk picks the page that started last', () => {
  const anchors = [ready(0, 0, 0), ready(1, 0, 0.5)];
  assert.deepEqual(pageAt(anchors, 0, 0, 60000), { pageSeq: 0, total: 2 });
  assert.equal(pageAt(anchors, 0, 27000, 60000).pageSeq, 0);
  assert.equal(pageAt(anchors, 0, 28500, 60000).pageSeq, 1, 'lead-in: a seek to page 1 shows page 1 at once');
});

test('pageAt: chunk with no page starting in it belongs to the last page before it', () => {
  const anchors = [ready(0, 0, 0), ready(1, 1, 0.3), ready(2, 5, 0)];
  assert.equal(pageAt(anchors, 2, 1000, 60000).pageSeq, 1);
  assert.equal(pageAt(anchors, 5, 0, 60000).pageSeq, 2);
});

test('pageAt: skips pages without an anchor; total counts every page', () => {
  const anchors = [ready(0, 0, 0), other(1, 'discarded'), other(2, 'empty'), ready(3, 0, 0.8), other(4, 'pending')];
  assert.deepEqual(pageAt(anchors, 0, 30000, 60000), { pageSeq: 0, total: 5 });
  assert.deepEqual(pageAt(anchors, 0, 59000, 60000), { pageSeq: 3, total: 5 });
});

test('pageAt: before the first anchor falls back to the first ready page', () => {
  assert.equal(pageAt([other(0, 'discarded'), ready(1, 2, 0.4)], 0, 0, 60000).pageSeq, 1);
});

test('pageAt: nothing ready or nothing playing gives null / position 0', () => {
  assert.equal(pageAt([other(0, 'pending')], 0, 0, 0), null);
  assert.equal(pageAt([], 0, 0, 0), null);
  assert.equal(pageAt([ready(0, 0, 0), ready(1, 0, 0.5)], 0, 50000, 0).pageSeq, 0, 'unknown duration → chunk start');
  assert.equal(pageAt([ready(0, 0, 0)], null, 0, 0).pageSeq, 0, 'no current chunk yet');
});

test('chunksSignature: changes with chunk count or text, not with status or duration', () => {
  const base = [{ seq: 0, text: 'Một.', status: 'pending', duration_ms: null }];
  const sig = chunksSignature(base);
  assert.equal(chunksSignature([{ ...base[0], status: 'done', duration_ms: 900 }]), sig);
  assert.notEqual(chunksSignature([{ ...base[0], text: 'Một câu.' }]), sig);
  assert.notEqual(chunksSignature([...base, { seq: 1, text: 'Hai.' }]), sig);
  assert.equal(chunksSignature([]), chunksSignature([]));
});

test('pageStatusLabel: why a page cannot be picked', () => {
  assert.equal(pageStatusLabel('ready'), null);
  assert.equal(pageStatusLabel('pending'), 'Chưa sẵn sàng');
  assert.equal(pageStatusLabel('failed'), 'Lỗi');
  assert.equal(pageStatusLabel('discarded'), 'Đã bỏ');
  assert.equal(pageStatusLabel('empty'), 'Trang trống');
});

test('seekForPage + pageAt: right after a seek the label already shows the picked page', () => {
  const anchors = [ready(0, 0, 0), ready(1, 0, 0.33337)];
  const chunk = { seq: 0, duration_ms: 61234 };
  const { offsetMs } = seekForPage(anchors[1], chunk);
  assert.equal(pageAt(anchors, 0, offsetMs, 61234).pageSeq, 1);
  assert.equal(pageAt(anchors, 0, offsetMs, 61200).pageSeq, 1, 'element duration may differ slightly from the server');
});

test('reconcileAnchors: a page whose chunk is not in the list cannot be picked', () => {
  const anchors = [ready(0, 0, 0), ready(1, 1, 0.2), other(2, 'discarded')];
  const out = reconcileAnchors(anchors, [{ seq: 0 }]);
  assert.deepEqual(out[0], anchors[0]);
  assert.deepEqual(out[1], { ...anchors[1], status: 'pending', chunk_seq: null, chunk_frac: null });
  assert.deepEqual(out[2], anchors[2]);
  assert.equal(reconcileAnchors(null, []), null);
});

test('hasUnsettledPages: pending or failed pages may still change without any chunk changing', () => {
  assert.equal(hasUnsettledPages([ready(0, 0, 0), other(1, 'discarded'), other(2, 'empty')]), false);
  assert.equal(hasUnsettledPages([ready(0, 0, 0), other(1, 'pending')]), true);
  assert.equal(hasUnsettledPages([other(0, 'failed')]), true);
  assert.equal(hasUnsettledPages(null), false);
});
