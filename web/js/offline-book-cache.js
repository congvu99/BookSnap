// Stores a downloaded book's detail + chunk-list JSON so the reader/library can render while
// offline (C4). Keyed by book id in localStorage — deliberately NOT under an /api/* path, so the
// service worker's network-first /api/* rule never intercepts or shadows it.
const PREFIX = 'booksnap:offline-book:';
// Page anchors live under their own key so saveOfflineBook's shape stays unchanged.
const ANCHORS_PREFIX = 'booksnap:offline-anchors:';

/** @param {string} bookId @param {object} book @param {object[]} chunks */
export function saveOfflineBook(bookId, book, chunks) {
  try {
    localStorage.setItem(PREFIX + bookId, JSON.stringify({ book, chunks, savedAt: new Date().toISOString() }));
  } catch {
    // Storage full/unavailable — offline fallback just won't be available for this book.
  }
}

/** @param {string} bookId @returns {{book:object, chunks:object[]}|null} */
export function readOfflineBook(bookId) {
  try {
    const raw = localStorage.getItem(PREFIX + bookId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function removeOfflineBook(bookId) {
  localStorage.removeItem(PREFIX + bookId);
  localStorage.removeItem(ANCHORS_PREFIX + bookId);
}

/** @param {string} bookId @param {object[]} anchors */
export function saveOfflinePageAnchors(bookId, anchors) {
  try {
    localStorage.setItem(ANCHORS_PREFIX + bookId, JSON.stringify(anchors));
  } catch {
    // Storage full/unavailable — offline the player just shows chunk numbers instead of pages.
  }
}

/** @param {string} bookId @returns {object[]|null} */
export function readOfflinePageAnchors(bookId) {
  try {
    const raw = localStorage.getItem(ANCHORS_PREFIX + bookId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @returns {{id:string, book:object}[]} every book saved for offline use (for the library view). */
export function listOfflineBooks() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (data && data.book) out.push({ id: key.slice(PREFIX.length), book: data.book });
    } catch {
      // Skip a corrupt entry rather than failing the whole listing.
    }
  }
  return out;
}
