import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRails, railByKey, remainingMinutes, RECENT_RAIL_MAX } from '../../web/js/library-rails.js';

const book = (id, extra = {}) => ({ id, title: `B${id}`, created_at: `2026-01-${String(id).padStart(2, '0')}`, topic: null, on_shelf: false, ...extra });

test('empty rails are omitted', () => {
  assert.deepEqual(buildRails([], [], 'An'), []);
  assert.deepEqual(buildRails(null, null, ''), []);
});

test('order: continue, shelf, recent, topics (vi collation, unsorted last)', () => {
  const books = [
    book(1, { topic: { id: 'z', name: 'Đời sống' }, on_shelf: true }),
    book(2, { topic: { id: 'a', name: 'Ăn uống' } }),
    book(3),
    book(4, { topic: { id: 'b', name: 'Bóng đá' } }),
  ];
  const cont = [{ ...books[0], progress: { chunk_seq: 1 } }];
  const rails = buildRails(books, cont, 'An');
  assert.deepEqual(rails.map((r) => r.key), ['continue', 'shelf', 'recent', 'topic:a', 'topic:b', 'topic:z', 'topic:unsorted']);
  assert.equal(rails[0].title, 'Nghe tiếp của An');
  assert.equal(rails.at(-1).title, 'Chưa phân loại');
});

test('continue rail only keeps books with progress', () => {
  const rails = buildRails([book(1)], [book(1), book(2, { progress: { chunk_seq: 0 } })], '');
  assert.equal(rails[0].title, 'Nghe tiếp');
  assert.deepEqual(rails[0].books.map((b) => b.id), [2]);
});

test('recent sorted newest first and capped; railByKey is uncapped', () => {
  const books = Array.from({ length: 20 }, (_, i) => book(i + 1));
  const recent = buildRails(books, [], '').find((r) => r.key === 'recent');
  assert.equal(recent.books.length, RECENT_RAIL_MAX);
  assert.equal(recent.books[0].id, 20);
  assert.equal(railByKey(books, [], '', 'recent').books.length, 20);
  assert.equal(railByKey(books, [], '', 'nope'), null);
});

test('remainingMinutes', () => {
  assert.equal(remainingMinutes({ duration_ms: 600000, chunks: { total: 10 }, progress: { chunk_seq: 5 } }), 5);
  assert.equal(remainingMinutes({ duration_ms: 600000, chunks: { total: 10 } }), 10);
  assert.equal(remainingMinutes({ duration_ms: null, chunks: { total: 10 } }), null);
});
