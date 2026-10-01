// "Kệ của tôi" toggle for one book, optimistic (same approach as use-book-bookmarks.js).
// `serverOnShelf` is the latest value from book reloads/polls: it updates the confirmed state but
// never overrides a pending tap. The request logic lives in shelf-sync.js.
import { useEffect, useRef, useState } from '../vendor/preact-htm.module.js';
import { shelfApi } from './api-client.js';
import { authStore } from './store.js';
import { ShelfSync } from './shelf-sync.js';

const MESSAGE_MS = 2400;
const FAIL_MESSAGE = 'Không lưu được kệ, thử lại sau';

/** @param {string} bookId @param {boolean|undefined} serverOnShelf @returns {{onShelf: boolean, toggle: ()=>void, message: string|null, failures: number}} */
export function useShelfToggle(bookId, serverOnShelf) {
  const [onShelf, setOnShelf] = useState(Boolean(serverOnShelf));
  const [message, setMessage] = useState(/** @type {string|null} */ (null));
  // Bumped on every failure so callers can re-announce a repeated, identical message.
  const [failures, setFailures] = useState(0);
  const syncRef = useRef(/** @type {ShelfSync|null} */ (null));
  const timer = useRef(/** @type {number|undefined} */ (undefined));

  useEffect(() => {
    // Pinned at mount: a write still queued when the profile changes stays with this profile.
    const profileId = authStore.get().user?.id;
    const sync = new ShelfSync((on) => (on ? shelfApi.add(bookId, profileId) : shelfApi.remove(bookId, profileId)), {
      onChange: setOnShelf,
      onError: () => {
        setMessage(FAIL_MESSAGE);
        setFailures((n) => n + 1);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMessage(null), MESSAGE_MS);
      },
    });
    sync.setServer(Boolean(serverOnShelf));
    syncRef.current = sync;
    return () => {
      sync.dispose();
      window.clearTimeout(timer.current);
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [bookId]);

  useEffect(() => {
    syncRef.current?.setServer(Boolean(serverOnShelf));
  }, [serverOnShelf]);

  return { onShelf, toggle: () => void syncRef.current?.toggle(), message, failures };
}
