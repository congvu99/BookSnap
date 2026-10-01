import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillPercent, shownValue } from '../../web/js/scrub-math.js';

test('fill is a clamped percentage of the range', () => {
  assert.equal(fillPercent(50, 0, 100), 50);
  assert.equal(fillPercent(30, 0, 60), 50);
  assert.equal(fillPercent(-5, 0, 100), 0);
  assert.equal(fillPercent(150, 0, 100), 100);
});

test('fill is 0 for empty or broken ranges', () => {
  assert.equal(fillPercent(0, 0, 0), 0);
  assert.equal(fillPercent(NaN, 0, 100), 0);
});

test('the drag position wins over the live value while dragging', () => {
  assert.equal(shownValue(700, 120), 700);
  assert.equal(shownValue(0, 120), 0);
  assert.equal(shownValue(null, 120), 120);
});
