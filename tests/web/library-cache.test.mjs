import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readLibraryCache,
  writeLibraryCache,
  LIBRARY_CACHE_MAX_AGE_MS,
  LIBRARY_CACHE_MAX_BOOKS,
} from '../../web/js/library-cache.js';

function memoryStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, v) };
}

test('round trip keeps books and continuing', () => {
  const s = memoryStorage();
  assert.equal(writeLibraryCache(s, 'p1', { books: [{ id: 'a' }], continuing: [{ id: 'a' }] }, 1000), true);
  const got = readLibraryCache(s, 'p1', 2000);
  assert.deepEqual(got, { books: [{ id: 'a' }], continuing: [{ id: 'a' }], savedAt: 1000 });
});

test('profiles are isolated', () => {
  const s = memoryStorage();
  writeLibraryCache(s, 'p1', { books: [{ id: 'a' }], continuing: [] });
  assert.equal(readLibraryCache(s, 'p2'), null);
  assert.ok(readLibraryCache(s, 'p1'));
});

test('null profile never reads or writes', () => {
  const s = memoryStorage();
  assert.equal(writeLibraryCache(s, null, { books: [] }), false);
  assert.equal(s.m.size, 0);
  s.setItem('booksnap:library:null', JSON.stringify({ books: [], savedAt: Date.now() }));
  assert.equal(readLibraryCache(s, null), null);
});

test('malformed or wrongly shaped entries are ignored', () => {
  const s = memoryStorage();
  s.setItem('booksnap:library:p1', '{not json');
  assert.equal(readLibraryCache(s, 'p1'), null);
  s.setItem('booksnap:library:p1', JSON.stringify({ books: 'x', savedAt: 1 }));
  assert.equal(readLibraryCache(s, 'p1'), null);
  s.setItem('booksnap:library:p1', JSON.stringify({ books: [] }));
  assert.equal(readLibraryCache(s, 'p1'), null);
});

test('entries older than the max age are ignored', () => {
  const s = memoryStorage();
  writeLibraryCache(s, 'p1', { books: [{ id: 'a' }] }, 0);
  assert.ok(readLibraryCache(s, 'p1', LIBRARY_CACHE_MAX_AGE_MS));
  assert.equal(readLibraryCache(s, 'p1', LIBRARY_CACHE_MAX_AGE_MS + 1), null);
});

test('stored books are capped', () => {
  const s = memoryStorage();
  const books = Array.from({ length: LIBRARY_CACHE_MAX_BOOKS + 50 }, (_, i) => ({ id: String(i) }));
  writeLibraryCache(s, 'p1', { books, continuing: [] });
  assert.equal(readLibraryCache(s, 'p1').books.length, LIBRARY_CACHE_MAX_BOOKS);
});

test('throwing storage does not throw', () => {
  const bad = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
  };
  assert.equal(readLibraryCache(bad, 'p1'), null);
  assert.equal(writeLibraryCache(bad, 'p1', { books: [] }), false);
  assert.equal(readLibraryCache(undefined, 'p1'), null);
});
