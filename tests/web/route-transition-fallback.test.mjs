import { test } from 'node:test';
import assert from 'node:assert/strict';

// A document without View Transitions (Safari path). The fallback must never set a document-level
// attribute: the entering view's animation comes from its own data-enter, and toggling a shared
// attribute restarts the animation of the screen already shown (a visible flash).
globalThis.document = { documentElement: { dataset: {} } };
const { runRouteTransition } = await import('../../web/js/route-transition.js');

test('fallback: no html[data-nav] before, during or after the update', async () => {
  const dataset = globalThis.document.documentElement.dataset;
  for (const direction of ['tab', 'push', 'pop', 'none']) {
    let seenDuring;
    await runRouteTransition(direction, () => { seenDuring = { ...dataset }; });
    assert.deepEqual(seenDuring, {}, direction);
    assert.deepEqual({ ...dataset }, {}, direction);
  }
});
