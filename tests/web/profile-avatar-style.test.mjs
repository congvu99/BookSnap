import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_KEYS, avatarClass, avatarInitial } from '../../web/js/profile-avatar-style.js';

test('initial is the first letter, upper-cased, Vietnamese diacritics kept', () => {
  assert.equal(avatarInitial('Đức'), 'Đ');
  assert.equal(avatarInitial('  an '), 'A');
  assert.equal(avatarInitial('ơi'), 'Ơ');
  // Decomposed input (e.g. pasted from macOS) still yields one composed letter.
  assert.equal(avatarInitial('ê Nam'), 'Ê');
});

test('initial falls back to ? for empty names and skips leading symbols', () => {
  assert.equal(avatarInitial(''), '?');
  assert.equal(avatarInitial('   '), '?');
  assert.equal(avatarInitial(undefined), '?');
  assert.equal(avatarInitial('🎧 Bin'), 'B');
  assert.equal(avatarInitial('🎧'), '?');
});

test('eight colour keys, unknown keys fall back to the first', () => {
  assert.deepEqual(AVATAR_KEYS, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  assert.equal(avatarClass('c5'), 'profile-avatar--c5');
  assert.equal(avatarClass('c9'), 'profile-avatar--c1');
  assert.equal(avatarClass(null), 'profile-avatar--c1');
});
