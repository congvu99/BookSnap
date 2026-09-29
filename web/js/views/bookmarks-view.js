// Đánh dấu: the current user's bookmarked passages, grouped by book (newest bookmark first).
// "Nghe từ đây" opens the listen mode at that chunk (#/listen/:id?seq=n).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { bookmarksApi } from '../api-client.js';
import { RecordSleeve } from '../components/record-sleeve.js';
import { Icon } from '../icons.js';

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
  const [items, setItems] = useState(/** @type {any[]|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    bookmarksApi
      .list()
      .then(setItems)
      .catch((err) => setError(err.status === 0 || err.status === 503 ? 'Đang ngoại tuyến — không tải được danh sách đánh dấu.' : err.message));
  }, []);

  async function remove(item) {
    const before = items;
    setItems(items.filter((i) => !(i.book_id === item.book_id && i.chunk_seq === item.chunk_seq)));
    try {
      await bookmarksApi.remove(item.book_id, item.chunk_seq);
    } catch (err) {
      setItems(before);
      setError(err.message || 'Không bỏ được đánh dấu, thử lại sau.');
    }
  }

  return html`
    <div>
      <header class="bookmarks-header">
        <div>
          <p class="bookmarks-eyebrow">Những đoạn muốn nghe lại</p>
          <h1 class="bookmarks-title">Đánh dấu</h1>
        </div>
      </header>
      <div class="fleuron-rule header-rule" aria-hidden="true"><i></i></div>
      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${items === null && !error && html`<div class="skeleton" style=${{ height: '160px' }}></div>`}
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
