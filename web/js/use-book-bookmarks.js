// Bookmarks of one book for the current user, toggled optimistically.
// Requests for a seq are serialised: a quick on→off double tap never has a PUT and a DELETE in
// flight together (the server could apply them out of order). The UI shows the user's latest
// wish; once the server agrees nothing else happens, and a failure rolls the seq back to the last
// state the server confirmed. If the initial load fails (offline) every seq shows as unmarked.
import { useEffect, useRef, useState } from '../vendor/preact-htm.module.js';
import { bookmarksApi } from './api-client.js';
import { authStore } from './store.js';

const MESSAGE_MS = 2400;

/** @param {string} bookId @returns {{seqs: Set<number>, toggle: (seq:number)=>void, message: string|null}} */
export function useBookBookmarks(bookId) {
  const [seqs, setSeqs] = useState(() => new Set());
  const [message, setMessage] = useState(/** @type {string|null} */ (null));
  const confirmed = useRef(/** @type {Set<number>} */ (new Set()));
  const wanted = useRef(/** @type {Map<number, boolean>} */ (new Map()));
  const syncing = useRef(/** @type {Set<number>} */ (new Set()));
  const alive = useRef(true);
  const timer = useRef(/** @type {number|undefined} */ (undefined));
  // Pinned at mount: a toggle still syncing after a profile switch stays with this profile.
  const profileIdRef = useRef(authStore.get().user?.id);

  function render() {
    const next = new Set(confirmed.current);
    for (const [seq, on] of wanted.current) {
      if (on) next.add(seq);
      else next.delete(seq);
    }
    setSeqs(next);
  }

  useEffect(() => {
    alive.current = true;
    bookmarksApi
      .forBook(bookId)
      .then((list) => {
        if (!alive.current) return;
        confirmed.current = new Set(list);
        render(); // pending taps in `wanted` still win over the loaded state
      })
      .catch(() => {});
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, [bookId]);

  function flash(text) {
    if (!alive.current) return;
    setMessage(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(null), MESSAGE_MS);
  }

  async function sync(seq) {
    if (syncing.current.has(seq)) return; // the running loop will pick up the newest wish
    syncing.current.add(seq);
    try {
      while (wanted.current.has(seq) && wanted.current.get(seq) !== confirmed.current.has(seq)) {
        const on = wanted.current.get(seq);
        try {
          await (on ? bookmarksApi.add(bookId, seq, profileIdRef.current) : bookmarksApi.remove(bookId, seq, profileIdRef.current));
        } catch (err) {
          wanted.current.delete(seq);
          render();
          flash(err.status === 0 || err.status === 503 ? 'Đang ngoại tuyến — chưa lưu được đánh dấu' : err.message || 'Không lưu được đánh dấu');
          return;
        }
        if (on) confirmed.current.add(seq);
        else confirmed.current.delete(seq);
        if (wanted.current.get(seq) === on) flash(on ? `Đã đánh dấu đoạn ${seq + 1}` : 'Đã bỏ đánh dấu');
      }
      wanted.current.delete(seq);
    } finally {
      syncing.current.delete(seq);
    }
  }

  function toggle(seq) {
    // Read refs, not `seqs`: two taps inside one render must flip twice.
    const shown = wanted.current.has(seq) ? wanted.current.get(seq) : confirmed.current.has(seq);
    wanted.current.set(seq, !shown);
    render();
    sync(seq);
  }

  return { seqs, toggle, message };
}
