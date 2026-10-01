// Wiring of the pure prefetcher (book-prefetch-core.js) to the real API and the signed-in profile.
import { booksApi } from './api-client.js';
import { authStore, safeLocalStorage } from './store.js';
import { createBookPrefetcher, peekBookFromSnapshot } from './book-prefetch-core.js';

const currentProfileId = () => authStore.get().user?.id || null;

const prefetcher = createBookPrefetcher({
  fetchBook: (id) => booksApi.get(id),
  fetchChunks: (id) => booksApi.chunks(id),
  fetchProgress: (id, profileId) => booksApi.getProgress(id, profileId),
  getProfileId: currentProfileId,
});

/** Start (once) the book, chunks and progress requests; returns the shared promises. */
export const prefetchBook = prefetcher.prefetch;

/** Hand the prefetched promises to the reader (or null) and forget them. */
export const takePrefetched = prefetcher.take;

/** Library-list summary of a book for the current profile, or null. Never throws. */
export function peekBook(bookId) {
  try {
    return peekBookFromSnapshot(safeLocalStorage(), currentProfileId(), bookId);
  } catch {
    return null;
  }
}
