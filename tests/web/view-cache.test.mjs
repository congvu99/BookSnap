import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cached, loadCached, peekCached, peekEntry, setCached, invalidateCached, clearViewCache, watchProfile } from '../../web/js/view-cache.js';

beforeEach(() => clearViewCache());

test('first visit has no value; refresh stores it for the second visit', async () => {
  const first = cached('books', async () => [1, 2], { profileId: 'a' });
  assert.equal(first.value, undefined);
  assert.deepEqual(await first.refresh, [1, 2]);
  const second = cached('books', async () => [1, 2, 3], { profileId: 'a' });
  assert.deepEqual(second.value, [1, 2]); // stale value served instantly
  assert.deepEqual(await second.refresh, [1, 2, 3]);
  assert.deepEqual(peekCached('books', { profileId: 'a' }), [1, 2, 3]);
});

test('profiles are isolated', async () => {
  await cached('books', async () => 'A', { profileId: 'a' }).refresh;
  assert.equal(peekCached('books', { profileId: 'b' }), undefined);
  assert.equal(peekCached('books', { profileId: null }), undefined);
  assert.equal(peekCached('books', { profileId: 'a' }), 'A');
});

test('entries older than ttl are ignored', () => {
  setCached('k', 1, { profileId: 'a', now: 1000 });
  assert.equal(peekCached('k', { profileId: 'a', ttlMs: 500, now: 1400 }), 1);
  assert.equal(peekCached('k', { profileId: 'a', ttlMs: 500, now: 1600 }), undefined);
  assert.equal(peekEntry('k', { profileId: 'a', now: 1600 }).at, 1000);
});

test('concurrent refreshes share one fetch', async () => {
  let calls = 0;
  const fetcher = async () => ++calls;
  const [x, y] = [cached('k', fetcher), cached('k', fetcher)];
  assert.equal(await x.refresh, 1);
  assert.equal(await y.refresh, 1);
  assert.equal(calls, 1);
});

test('failed refresh rejects and keeps the previous value', async () => {
  setCached('k', 'old', { profileId: 'a' });
  const r = cached('k', async () => { throw new Error('offline'); }, { profileId: 'a' });
  assert.equal(r.value, 'old');
  await assert.rejects(r.refresh, /offline/);
  assert.equal(peekCached('k', { profileId: 'a' }), 'old');
  // A later call retries instead of reusing the failed promise.
  assert.equal(await cached('k', async () => 'new', { profileId: 'a' }).refresh, 'new');
});

test('clearViewCache drops entries and discards in-flight results', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const r = cached('k', async () => { await gate; return 'late'; }, { profileId: 'a' });
  clearViewCache();
  release();
  assert.equal(await r.refresh, 'late');
  assert.equal(peekCached('k', { profileId: 'a' }), undefined);
});

test('invalidateCached removes one key only', () => {
  setCached('a', 1);
  setCached('b', 2);
  invalidateCached('a');
  assert.equal(peekCached('a'), undefined);
  assert.equal(peekCached('b'), 2);
});

test('loadCached reports results unless cancelled', async () => {
  const seen = [];
  loadCached('k', async () => 5, {}, { onValue: (v) => seen.push(v) });
  const cancel = loadCached('k2', async () => 6, {}, { onValue: (v) => seen.push(v) });
  cancel();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, [5]);
  const errors = [];
  loadCached('bad', async () => { throw new Error('x'); }, {}, { onValue() {}, onError: (e) => errors.push(e.message) });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(errors, ['x']);
});

test('watchProfile clears on profile change and sign-out only', () => {
  let state = { user: { id: 'a' } };
  const listeners = new Set();
  const store = { get: () => state, subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
  const emit = (s) => { state = s; listeners.forEach((l) => l(s)); };
  watchProfile(store);
  setCached('k', 1, { profileId: 'a' });
  emit({ user: { id: 'a' }, offline: true });
  assert.equal(peekCached('k', { profileId: 'a' }), 1);
  emit({ user: { id: 'b' } });
  assert.equal(peekCached('k', { profileId: 'a' }), undefined);
  setCached('k', 2, { profileId: 'b' });
  emit({ user: null });
  assert.equal(peekCached('k', { profileId: 'b' }), undefined);
});
