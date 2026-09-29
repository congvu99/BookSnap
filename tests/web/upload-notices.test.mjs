import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newlyDone, formatPageList, pendingPages } from '../../web/js/upload-notices.js';

const item = (uploadId, seq, status) => ({ uploadId, seq, status });

test('newlyDone reports only items that just turned done, as 0-based seqs', () => {
  const seen = new Set(['a']);
  const items = [item('a', 0, 'done'), item('b', 1, 'done'), item('c', 2, 'uploading'), item('d', 3, 'error')];
  assert.deepEqual(newlyDone(seen, items), [1]);
});

test('newlyDone records what it reported so nothing is announced twice', () => {
  const seen = new Set();
  const items = [item('a', 0, 'done')];
  assert.deepEqual(newlyDone(seen, items), [0]);
  assert.deepEqual(newlyDone(seen, items), []);
});

test('formatPageList prints 1-based pages and folds consecutive runs', () => {
  assert.equal(formatPageList([0]), '1');
  assert.equal(formatPageList([3, 4, 5]), '4–6');
  assert.equal(formatPageList([3, 5]), '4, 6');
  assert.equal(formatPageList([0, 1, 3]), '1–2, 4');
  assert.equal(formatPageList([5, 3, 4]), '4–6');
  assert.equal(formatPageList([]), '');
});

test('pendingPages lists 1-based pages not uploaded yet, in order', () => {
  const items = [item('a', 4, 'done'), item('b', 5, 'uploading'), item('c', 6, 'queued'), item('d', 7, 'error')];
  assert.deepEqual(pendingPages(items), [6, 7, 8]);
});
