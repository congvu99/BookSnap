// Page anchors of one book (ReaderView remounts per book). Refetched when the chunk list changes
// (the reader already polls it), and every UNSETTLED_REFRESH_MS while some page is still pending or
// failed, since those can change with no chunk changing. A failed fetch keeps the anchors already
// shown; with none yet, it falls back to the copy saved for offline use. null = no anchors (the UI
// then shows chunk numbers). Anchors whose chunk the player does not have are shown as not ready.
import { useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.module.js';
import { booksApi } from './api-client.js';
import { chunksSignature, hasUnsettledPages, reconcileAnchors } from './page-position.js';
import { readOfflinePageAnchors, saveOfflinePageAnchors } from './offline-book-cache.js';

const UNSETTLED_REFRESH_MS = 10000;

/**
 * @param {string} bookId
 * @param {object[]} chunks the reader's current chunk list
 * @param {boolean} cacheOffline true once the book is downloaded for offline use
 * @returns {{ anchors: import('./page-position.js').PageAnchor[]|null }}
 */
export function usePageAnchors(bookId, chunks, cacheOffline) {
  const [fetched, setFetched] = useState(/** @type {any[]|null} */ (null));
  const [refreshTick, setRefreshTick] = useState(0);
  const cacheOfflineRef = useRef(cacheOffline);
  cacheOfflineRef.current = cacheOffline;
  const signature = chunksSignature(chunks);
  const hasChunks = chunks.length > 0;

  useEffect(() => {
    if (!hasChunks) return undefined; // nothing to seek into yet; the first chunk list triggers the fetch
    let cancelled = false;
    booksApi
      .pageAnchors(bookId)
      .then((list) => {
        if (cancelled) return;
        setFetched(list);
        if (cacheOfflineRef.current) saveOfflinePageAnchors(bookId, list);
      })
      .catch(() => {
        if (!cancelled) setFetched((current) => current || readOfflinePageAnchors(bookId));
      });
    return () => {
      cancelled = true;
    };
  }, [bookId, signature, hasChunks, refreshTick]);

  const unsettled = hasUnsettledPages(fetched);
  useEffect(() => {
    if (!unsettled) return undefined;
    const timer = window.setTimeout(() => setRefreshTick((n) => n + 1), UNSETTLED_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [unsettled, fetched]);

  const anchors = useMemo(() => reconcileAnchors(fetched, chunks), [fetched, chunks]);
  return { anchors };
}
