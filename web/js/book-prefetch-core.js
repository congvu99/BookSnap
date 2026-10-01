// Pure prefetch store (no DOM, no api imports) so TTL and profile keying run under `node --test`.
// A card press starts book + chunks + progress requests; the reader adopts them on mount so the
// network time overlaps the navigation. Entries are keyed by profile id and expire quickly.
import { readLibraryCache } from './library-cache.js';

export const PREFETCH_TTL_MS = 15_000;

/**
 * @typedef {{ book: Promise<any>, chunks: Promise<any[]>, progress: Promise<any|null> }} PrefetchedBook
 */

/**
 * @param {{
 *   fetchBook: (bookId: string) => Promise<any>,
 *   fetchChunks: (bookId: string) => Promise<any[]>,
 *   fetchProgress: (bookId: string, profileId: string) => Promise<any>,
 *   getProfileId: () => string|null|undefined,
 *   now?: () => number,
 *   ttlMs?: number,
 * }} deps
 */
export function createBookPrefetcher({ fetchBook, fetchChunks, fetchProgress, getProfileId, now = Date.now, ttlMs = PREFETCH_TTL_MS }) {
  /** @type {Map<string, {at: number, value: PrefetchedBook}>} */
  const entries = new Map();
  const keyFor = (profileId, bookId) => `${profileId}:${bookId}`;

  function fresh(entry) {
    return Boolean(entry) && now() - entry.at <= ttlMs;
  }

  /** Drop expired entries so a long session never accumulates them. */
  function sweep() {
    for (const [key, entry] of entries) if (!fresh(entry)) entries.delete(key);
  }

  /** @returns {PrefetchedBook|null} the shared promises, started once per (profile, book) within the TTL. */
  function prefetch(bookId) {
    const profileId = getProfileId();
    if (!profileId || !bookId) return null;
    sweep();
    const key = keyFor(profileId, bookId);
    const existing = entries.get(key);
    if (existing) return existing.value;
    const value = {
      book: Promise.resolve().then(() => fetchBook(bookId)),
      chunks: Promise.resolve().then(() => fetchChunks(bookId)),
      // Progress failures are non-fatal (the reader falls back to the local copy): resolve null.
      progress: Promise.resolve().then(() => fetchProgress(bookId, profileId)).catch(() => null),
    };
    const entry = { at: now(), value };
    entries.set(key, entry);
    // A failed prefetch must not be handed to a later open (it should retry fresh), and nobody
    // may be listening yet, so this also silences the unhandled-rejection warning.
    const drop = () => {
      if (entries.get(key) === entry) entries.delete(key);
    };
    value.book.catch(drop);
    value.chunks.catch(drop);
    return value;
  }

  /** @returns {PrefetchedBook|null} and forgets it: the reader owns the promises from here on. */
  function take(bookId) {
    sweep(); // entries never taken must not keep their chunk lists alive
    const profileId = getProfileId();
    if (!profileId) return null;
    const key = keyFor(profileId, bookId);
    const entry = entries.get(key);
    entries.delete(key);
    return fresh(entry) ? entry.value : null;
  }

  return { prefetch, take, size: () => entries.size };
}

/**
 * Book summary (title, creator, ...) from the profile's library snapshot, for painting the reader
 * before its own request returns. Null when unknown.
 * @param {{getItem: Function}|null|undefined} storage
 * @param {string|null|undefined} profileId
 * @param {string} bookId
 */
export function peekBookFromSnapshot(storage, profileId, bookId) {
  const snap = readLibraryCache(storage, profileId);
  if (!snap) return null;
  return snap.books.find((b) => b && b.id === bookId) || snap.continuing.find((b) => b && b.id === bookId) || null;
}
