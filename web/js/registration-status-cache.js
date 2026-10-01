// Remembers whether sign-up is open so the sign-in screen can lay itself out
// before /api/auth/status answers. Pure (no Preact); storage is injected and may be null or throw.
export const REGISTRATION_OPEN_KEY = 'booksnap:registration-open';

/** @param {Pick<Storage,'getItem'>|null|undefined} storage @returns {boolean|null} null = unknown */
export function readRegistrationOpen(storage) {
  try {
    const raw = storage?.getItem(REGISTRATION_OPEN_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Storage blocked (private mode, quota): behave as if nothing is cached.
  }
  return null;
}

/** @param {Pick<Storage,'setItem'>|null|undefined} storage @param {boolean} open */
export function writeRegistrationOpen(storage, open) {
  try {
    storage?.setItem(REGISTRATION_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    // Best effort only; the next visit just falls back to the placeholder.
  }
}
