import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, subscribe, pendingCount } from '../../web/js/network-activity.js';

test('begin/end track the number of in-flight requests', () => {
  const base = pendingCount();
  const endA = begin();
  const endB = begin();
  assert.equal(pendingCount(), base + 2);
  endA();
  assert.equal(pendingCount(), base + 1);
  endB();
  assert.equal(pendingCount(), base);
});

test('end is idempotent', () => {
  const base = pendingCount();
  const end = begin();
  end();
  end();
  assert.equal(pendingCount(), base);
});

test('subscribers get each count change and can unsubscribe', () => {
  const seen = [];
  const base = pendingCount();
  const off = subscribe((n) => seen.push(n));
  const end = begin();
  end();
  off();
  begin()();
  assert.deepEqual(seen, [base + 1, base]);
});

test('a throwing subscriber does not break the counter or other subscribers', () => {
  const seen = [];
  const origError = console.error;
  console.error = () => {};
  const offBad = subscribe(() => { throw new Error('boom'); });
  const offGood = subscribe((n) => seen.push(n));
  try {
    const end = begin();
    end();
  } finally {
    console.error = origError;
    offBad();
    offGood();
  }
  assert.equal(seen.length, 2);
});
