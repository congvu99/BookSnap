import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTRATION_OPEN_KEY,
  readRegistrationOpen,
  writeRegistrationOpen,
} from '../../web/js/registration-status-cache.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
};
const throwing = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

test('read returns null when nothing cached or storage missing', () => {
  assert.equal(readRegistrationOpen(memory()), null);
  assert.equal(readRegistrationOpen(null), null);
  assert.equal(readRegistrationOpen(undefined), null);
});

test('write then read round-trips true and false', () => {
  const s = memory();
  writeRegistrationOpen(s, true);
  assert.equal(s.m.get(REGISTRATION_OPEN_KEY), 'true');
  assert.equal(readRegistrationOpen(s), true);
  writeRegistrationOpen(s, false);
  assert.equal(readRegistrationOpen(s), false);
});

test('garbage values read as unknown', () => {
  const s = memory();
  s.setItem(REGISTRATION_OPEN_KEY, '1');
  assert.equal(readRegistrationOpen(s), null);
});

test('throwing or null storage never throws', () => {
  assert.equal(readRegistrationOpen(throwing), null);
  assert.doesNotThrow(() => writeRegistrationOpen(throwing, true));
  assert.doesNotThrow(() => writeRegistrationOpen(null, true));
});
