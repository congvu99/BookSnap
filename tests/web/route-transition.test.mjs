import { test } from 'node:test';
import assert from 'node:assert/strict';

// Imported without a DOM: the module must load and fall back to a plain update.
const { routeDepth, directionFor, runRouteTransition } = await import('../../web/js/route-transition.js');

test('routeDepth: tabs are 0, pushed screens 1, unknown -1', () => {
  for (const n of ['library', 'me', 'account']) assert.equal(routeDepth(n), 0);
  for (const n of ['book', 'read', 'capture', 'browse', 'me-section', 'profiles', 'bookmarks']) assert.equal(routeDepth(n), 1);
  assert.equal(routeDepth('auth'), -1);
});

test('directionFor: tab, push, pop', () => {
  assert.equal(directionFor('library', 'me'), 'tab');
  assert.equal(directionFor('library', 'book'), 'push');
  assert.equal(directionFor('me', 'me-section'), 'push');
  assert.equal(directionFor('book', 'library'), 'pop');
  assert.equal(directionFor('me-section', 'me'), 'pop');
});

test('directionFor: none for same route, read/listen of one book, unknown routes', () => {
  assert.equal(directionFor({ name: 'read', bookId: 'a' }, { name: 'read', bookId: 'a' }), 'none');
  assert.equal(directionFor('library', 'library'), 'none');
  assert.equal(directionFor('auth', 'library'), 'none');
  assert.equal(directionFor({ name: 'read', bookId: 'a' }, { name: 'read', bookId: 'b' }), 'push');
});

test('runRouteTransition: runs update directly without View Transitions support', async () => {
  let ran = 0;
  await runRouteTransition('push', () => { ran += 1; });
  await runRouteTransition('none', async () => { ran += 1; });
  assert.equal(ran, 2);
});
