import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBookPrefetcher, peekBookFromSnapshot, PREFETCH_TTL_MS } from '../../web/js/book-prefetch-core.js';
import { writeLibraryCache } from '../../web/js/library-cache.js';

function setup(overrides = {}) {
  const calls = { book: 0, chunks: 0, progress: [] };
  const clock = { t: 1000 };
  const state = { profile: 'p1' };
  const p = createBookPrefetcher({
    fetchBook: async (id) => (calls.book++, { id }),
    fetchChunks: async () => (calls.chunks++, [{ seq: 0 }]),
    fetchProgress: async (id, pid) => (calls.progress.push(pid), { chunk_seq: 2 }),
    getProfileId: () => state.profile,
    now: () => clock.t,
    ...overrides,
  });
  return { p, calls, clock, state };
}

test('prefetch starts requests once and shares promises', async () => {
  const { p, calls } = setup();
  const a = p.prefetch('b1');
  const b = p.prefetch('b1');
  assert.equal(a, b);
  assert.deepEqual(await a.book, { id: 'b1' });
  assert.equal(calls.book, 1);
  assert.equal(calls.chunks, 1);
  assert.deepEqual(calls.progress, ['p1']);
});

test('take returns promises once then clears', async () => {
  const { p } = setup();
  p.prefetch('b1');
  const got = p.take('b1');
  assert.deepEqual(await got.progress, { chunk_seq: 2 });
  assert.equal(p.take('b1'), null);
});

test('entries expire after the TTL', async () => {
  const { p, clock, calls } = setup();
  p.prefetch('b1');
  clock.t += PREFETCH_TTL_MS + 1;
  assert.equal(p.take('b1'), null);
  p.prefetch('b1');
  await new Promise((r) => setImmediate(r));
  assert.equal(calls.book, 2);
});

test('never reuses an entry across profiles', () => {
  const { p, state } = setup();
  p.prefetch('b1');
  state.profile = 'p2';
  assert.equal(p.take('b1'), null);
  state.profile = 'p1';
  assert.ok(p.take('b1'));
});

test('no profile means no prefetch', () => {
  const { p, state, calls } = setup();
  state.profile = null;
  assert.equal(p.prefetch('b1'), null);
  assert.equal(calls.book, 0);
});

test('failed book request is dropped; progress failure resolves null', async () => {
  const { p } = setup({
    fetchBook: async () => {
      throw new Error('boom');
    },
    fetchProgress: async () => {
      throw new Error('nope');
    },
  });
  const v = p.prefetch('b1');
  await assert.rejects(v.book);
  assert.equal(await v.progress, null);
  assert.equal(p.size(), 0);
});

test('peekBookFromSnapshot finds books per profile', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v) };
  writeLibraryCache(storage, 'p1', { books: [{ id: 'b1', title: 'T' }], continuing: [{ id: 'b2', title: 'C' }] });
  assert.equal(peekBookFromSnapshot(storage, 'p1', 'b1').title, 'T');
  assert.equal(peekBookFromSnapshot(storage, 'p1', 'b2').title, 'C');
  assert.equal(peekBookFromSnapshot(storage, 'p2', 'b1'), null);
  assert.equal(peekBookFromSnapshot(storage, 'p1', 'zz'), null);
});
