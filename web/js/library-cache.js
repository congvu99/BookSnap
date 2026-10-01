// Per-profile snapshot of the library list for stale-while-revalidate rendering.
// Pure module: storage (localStorage-like: getItem/setItem) is injected so it is testable.
// Books carry per-profile fields (on_shelf, progress, can_manage), so entries are keyed by profile id.

export const LIBRARY_CACHE_PREFIX = 'booksnap:library:';
export const LIBRARY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LIBRARY_CACHE_MAX_BOOKS = 300;

const keyFor = (profileId) => `${LIBRARY_CACHE_PREFIX}${profileId}`;

/**
 * @param {{getItem: Function}|null|undefined} storage
 * @param {string|null|undefined} profileId
 * @param {number} [now]
 * @returns {{books: any[], continuing: any[], savedAt: number}|null}
 */
export function readLibraryCache(storage, profileId, now = Date.now()) {
  if (!storage || !profileId) return null;
  try {
    const raw = storage.getItem(keyFor(profileId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.books) || typeof data.savedAt !== 'number') return null;
    if (now - data.savedAt > LIBRARY_CACHE_MAX_AGE_MS) return null;
    return {
      books: data.books,
      continuing: Array.isArray(data.continuing) ? data.continuing : [],
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Best effort: quota / private-mode failures are swallowed.
 * @param {{setItem: Function}|null|undefined} storage
 * @param {string|null|undefined} profileId
 * @param {{books: any[], continuing?: any[]}} data
 * @param {number} [now]
 * @returns {boolean} whether the write succeeded
 */
export function writeLibraryCache(storage, profileId, data, now = Date.now()) {
  if (!storage || !profileId || !data || !Array.isArray(data.books)) return false;
  try {
    const entry = {
      savedAt: now,
      books: data.books.slice(0, LIBRARY_CACHE_MAX_BOOKS),
      continuing: Array.isArray(data.continuing) ? data.continuing.slice(0, 10) : [],
    };
    storage.setItem(keyFor(profileId), JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
}
