// Đánh dấu: the current user's bookmarked passages, grouped by book (newest bookmark first).
// "Nghe từ đây" opens the listen mode at that chunk (#/listen/:id?seq=n).
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { bookmarksApi } from '../api-client.js';
import { RecordSleeve } from '../components/record-sleeve.js';
import { Icon } from '../icons.js';
import { authStore } from '../store.js';
import { SkeletonStatus, SkeletonLine, SkeletonBlock, SkeletonCover } from '../components/skeleton.js';
import { loadCached, peekCached, setCached } from '../view-cache.js';

const CACHE_KEY = 'bookmarks:list';
const profileOpts = () => ({ profileId: authStore.get().user?.id ?? null });

/** Book header (sleeve + title) over two excerpt cards, matching the real groups. */
function BookmarksSkeleton() {
  return html`
    <div>
      <${SkeletonStatus} />
      ${[0, 1].map((g) => html`
        <div class="sk-bookmark-group" key=${g}>
          <div class="sk-bookmark-book">
            <${SkeletonCover} />
            <div><${SkeletonLine} width="55%" /><${SkeletonLine} width="22%" /></div>
          </div>
          <${SkeletonBlock} height="104px" />
          ${g === 0 && html`<${SkeletonBlock} height="104px" />`}
        </div>
      `)}
    </div>
  `;
}

const RELATIVE = new Intl.RelativeTimeFormat('vi', { numeric: 'auto' });
const UNITS = /** @type {const} */ ([
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]);

/** "hôm qua", "3 ngày trước"… @param {string} iso */
export function relativeTime(iso, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return RELATIVE.format(Math.round(seconds / size), unit);
  }
  return 'Vừa xong';
}

/** Keeps the server's newest-first order for both the groups and the passages inside them. */
function groupByBook(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.book_id)) groups.set(item.book_id, { book: { id: item.book_id, title: item.book_title }, items: [] });
    groups.get(item.book_id).items.push(item);
  }
  return [...groups.values()];
}

function BookmarkCard({ item, onRemove }) {
  return html`
    <article class="bookmark-card">
      <div class="bookmark-label">
        <span class="bookmark-lozenge" aria-hidden="true"></span>
        <span>Đoạn ${item.chunk_seq + 1}</span>
        <time datetime=${item.created_at}>${relativeTime(item.created_at)}</time>
      </div>
      <p class="bookmark-excerpt">${item.excerpt ?? 'Đoạn này đã được thay đổi hoặc không còn.'}</p>
      <div class="bookmark-actions">
        <a class="btn btn-secondary" href=${`#/listen/${item.book_id}?seq=${item.chunk_seq}`}>
          <${Icon} name="play" size=${16} /> Nghe từ đây
        </a>
        <button class="icon-btn" aria-label=${`Bỏ đánh dấu đoạn ${item.chunk_seq + 1}`} onClick=${() => onRemove(item)}>
          <${Icon} name="x" />
        </button>
      </div>
    </article>
  `;
}

export function BookmarksView() {
  const [items, setItemsState] = useState(/** @type {any[]|null} */ (() => peekCached(CACHE_KEY, profileOpts()) ?? null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  // Every change goes through the cache too, so a return visit never shows removed bookmarks.
  // Removed since mount: a refresh that started before the delete must not bring these back.
  const removedRef = useRef(new Set());
  const bookmarkKey = (i) => `${i.book_id}:${i.chunk_seq}`;
  const setItems = (next) => {
    setCached(CACHE_KEY, next, profileOpts());
    setItemsState(next);
  };

  useEffect(
    () =>
      loadCached(CACHE_KEY, () => bookmarksApi.list(), profileOpts(), {
        onValue: (fresh) => {
          const kept = removedRef.current.size ? fresh.filter((i) => !removedRef.current.has(bookmarkKey(i))) : fresh;
          if (kept !== fresh) setCached(CACHE_KEY, kept, profileOpts());
          setItemsState(kept);
          setError(null);
        },
        // A snapshot already on screen stays; only an empty screen reports the failure.
        onError: (err) => {
          if (items === null) setError(err.status === 0 || err.status === 503 ? 'Đang ngoại tuyến — không tải được danh sách đánh dấu.' : err.message);
        },
      }),
    []
  );

  async function remove(item) {
    const before = items;
    removedRef.current.add(bookmarkKey(item));
    setItems(items.filter((i) => !(i.book_id === item.book_id && i.chunk_seq === item.chunk_seq)));
    try {
      await bookmarksApi.remove(item.book_id, item.chunk_seq);
    } catch (err) {
      removedRef.current.delete(bookmarkKey(item));
      setItems(before);
      setError(err.message || 'Không bỏ được đánh dấu, thử lại sau.');
    }
  }

  return html`
    <div>
      <header class="bookmarks-header">
        <button
          class="icon-btn"
          aria-label="Quay lại"
          onClick=${() => (window.history.length > 1 ? window.history.back() : (window.location.hash = '#/me'))}
        ><${Icon} name="chevron-left" /></button>
        <div>
          <p class="bookmarks-eyebrow">Những đoạn muốn nghe lại</p>
          <h1 class="bookmarks-title">Đánh dấu</h1>
        </div>
      </header>
      <div class="fleuron-rule header-rule" aria-hidden="true"><i></i></div>
      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${items === null && !error && html`<${BookmarksSkeleton} />`}
        ${items !== null && items.length === 0 &&
        html`
          <div class="empty-state">
            <${Icon} name="bookmark" size=${48} />
            <div class="fleuron-rule" aria-hidden="true"><i></i></div>
            <p>Chưa có đoạn nào được đánh dấu.<br />Chạm biểu tượng dấu trang khi đang nghe để lưu lại.</p>
          </div>
        `}
        ${items !== null &&
        groupByBook(items).map(
          (group) => html`
            <section class="bookmark-group" key=${group.book.id} aria-labelledby=${`bm-${group.book.id}`}>
              <div class="bookmark-book">
                <${RecordSleeve} book=${group.book} className="bookmark-sleeve" />
                <div>
                  <h2 id=${`bm-${group.book.id}`}>${group.book.title}</h2>
                  <small>${group.items.length} đoạn</small>
                </div>
              </div>
              ${group.items.map((item) => html`<${BookmarkCard} key=${item.chunk_seq} item=${item} onRemove=${remove} />`)}
            </section>
          `
        )}
      </div>
    </div>
  `;
}
