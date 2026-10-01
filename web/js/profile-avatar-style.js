// Profile avatar = the name's first letter on one of eight preset colours (c1..c8, see
// web/css/profiles.css). Pure helpers, no Preact import, so they run under `node --test`.

/** Colour keys accepted by the backend (app/api/profiles_routes.py AVATAR_RE). */
export const AVATAR_KEYS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];

/** @param {string|null|undefined} key @returns {string} CSS modifier class for the avatar colour */
export function avatarClass(key) {
  return `profile-avatar--${AVATAR_KEYS.includes(/** @type {string} */ (key)) ? key : AVATAR_KEYS[0]}`;
}

/**
 * First letter of the name (NFC, upper-cased); leading emoji/symbols are skipped, '?' if none.
 * @param {string|null|undefined} name
 */
export function avatarInitial(name) {
  const letter = (name || '').normalize('NFC').match(/\p{L}/u);
  return letter ? letter[0].toLocaleUpperCase('vi') : '?';
}
