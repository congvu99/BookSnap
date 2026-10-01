import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorKind } from '../../web/js/auth-error-kind.js';

test('401 means the session is gone', () => {
  assert.equal(authErrorKind({ status: 401, code: 'unauthorized' }), 'logged_out');
});

test('409 profile codes send the device to the picker, never to offline mode', () => {
  assert.equal(authErrorKind({ status: 409, code: 'profile_required' }), 'needs_profile');
  assert.equal(authErrorKind({ status: 409, code: 'profile_mismatch' }), 'needs_profile');
  assert.equal(authErrorKind({ status: 409, code: 'profile_limit' }), 'error');
});

test('network failures and the service worker 503 are offline', () => {
  assert.equal(authErrorKind({ status: 0, code: 'network_error' }), 'offline');
  assert.equal(authErrorKind({ status: 503, code: 'offline' }), 'offline');
});

test('other errors are plain errors', () => {
  assert.equal(authErrorKind({ status: 500 }), 'error');
  assert.equal(authErrorKind(null), 'error');
});
