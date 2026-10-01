import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeProfileSwitcher, getProfileSwitcherState, onProfileSwitcherChange, openProfileSwitcher } from '../../web/js/profile-switcher.js';

test('open/close notify subscribers once per change and unsubscribe', () => {
  const seen = [];
  const off = onProfileSwitcherChange((s) => seen.push(s.open));
  const el = { id: 'btn' };
  openProfileSwitcher(el);
  openProfileSwitcher(el); // no-op while open
  assert.equal(getProfileSwitcherState().fromEl, el);
  closeProfileSwitcher();
  closeProfileSwitcher(); // no-op while closed
  off();
  openProfileSwitcher();
  closeProfileSwitcher();
  assert.deepEqual(seen, [true, false]);
});
