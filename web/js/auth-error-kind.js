// What a failed /api/me (or any API) error means for the session. Pure, so `node --test` covers it.

/** Server codes meaning "this device must pick a profile" (app/auth/current_user.py). */
export const PROFILE_REQUIRED_CODES = new Set(['profile_required', 'profile_mismatch']);

/**
 * @param {{status?: number, code?: string}|null|undefined} err
 * @returns {'logged_out'|'needs_profile'|'offline'|'error'}
 *   logged_out: the session is gone; needs_profile: signed in, no (valid) profile picked;
 *   offline: unreachable (network or the service worker's offline 503); error: anything else.
 */
export function authErrorKind(err) {
  const status = err && err.status;
  if (status === 401) return 'logged_out';
  if (status === 409 && PROFILE_REQUIRED_CODES.has(err.code || '')) return 'needs_profile';
  if (status === 0 || status === 503) return 'offline';
  return 'error';
}
