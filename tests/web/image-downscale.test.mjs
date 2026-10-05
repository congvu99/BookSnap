import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitLongEdge, LONG_EDGE } from '../../web/js/image-downscale.js';

test('small images keep their size', () => {
  assert.deepEqual(fitLongEdge(1200, 900), { width: 1200, height: 900 });
  assert.deepEqual(fitLongEdge(LONG_EDGE, 1000), { width: LONG_EDGE, height: 1000 });
});

test('landscape is scaled so the long edge fits', () => {
  assert.deepEqual(fitLongEdge(4000, 3000), { width: 2000, height: 1500 });
});

test('portrait phone photo is scaled by its height', () => {
  assert.deepEqual(fitLongEdge(3024, 4032), { width: 1500, height: 2000 });
});

test('custom limit and rounding', () => {
  assert.deepEqual(fitLongEdge(1001, 333, 500), { width: 500, height: 166 });
});
