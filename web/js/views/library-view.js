// Thư viện chung as "record crates": hero "Nghe tiếp", accent-insensitive search, topic pull-down
// menu and one crate per topic. Layout reference: docs/mockups/vinyl-library-preview.html.
import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { authStore } from '../store.js';
import { signOut } from '../sign-out.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { matchesQuery } from '../text-fold.js';
import { LibraryHeroCard } from '../components/library-hero-card.js';
import { LibraryCrate } from '../components/library-crate.js';
import { LibraryAccountMenu } from '../components/library-account-menu.js';
import { TopicFilterMenu } from '../components/topic-filter-menu.js';
import { Icon } from '../icons.js';

const UNSORTED_LABEL = 'Chưa phân loại';
const ALL = 'all';
const UNSORTED_KEY = 'unsorted';

/**
 * One shelf per topic, sorted by Vietnamese collation; books without a topic go last.
 * Within a shelf books keep the server order (most recently updated first).
 * @param {any[]} books @returns {{key: string, name: string, books: any[]}[]}
 */
export function groupIntoShelves(books) {
  const shelves = new Map();
  for (const book of books) {
    const key = book.topic ? book.topic.id : '';
    if (!shelves.has(key)) shelves.set(key, { key, name: book.topic ? book.topic.name : UNSORTED_LABEL, books: [] });
    shelves.get(key).books.push(book);
  }
  const named = [...shelves.values()].filter((s) => s.key !== '');
  named.sort((a, b) => a.name.localeCompare(b.name, 'vi', { sensitivity: 'base' }));
  return shelves.has('') ? [...named, shelves.get('')] : named;
}

/** Menu option key for a shelf ('' topic id -> UNSORTED_KEY). */
const shelfKey = (shelf) => shelf.key || UNSORTED_KEY;

export function LibraryView() {
  const [books, setBooks] = useState(/** @type {any[]|null} */ (null));
  const [continuing, setContinuing] = useState(/** @type {any[]} */ ([]));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [isOffline, setIsOffline] = useState(false);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState(ALL);
  const user = authStore.get().user;

  async function load() {
    setError(null);
    try {
      const [list, cont] = await Promise.all([booksApi.list(), booksApi.continueListening()]);
      setBooks(list);
      setContinuing(cont);
      setIsOffline(false);
    } catch (err) {
      // Offline: show whatever books were saved for offline reading instead of a dead end.
      const offline = listOfflineBooks();
      if (offline.length > 0) {
        setBooks(offline.map((o) => o.book));
        setContinuing([]);
        setIsOffline(true);
      } else {
        setError(err.message || 'Không tải được thư viện');
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Search narrows books first; topic options keep every topic but show counts for the search result.
  const { options, shelves, visibleCount, activeTopic } = useMemo(() => {
    const all = books || [];
    const searched = all.filter((b) => matchesQuery(b.title, query));
    const searchedCounts = new Map(groupIntoShelves(searched).map((s) => [shelfKey(s), s.books.length]));
    const opts = [
      { key: ALL, label: 'Mọi chủ đề', count: searched.length },
      ...groupIntoShelves(all).map((s) => ({ key: shelfKey(s), label: s.name, count: searchedCounts.get(shelfKey(s)) || 0 })),
    ];
    // A topic that vanished from the list must not leave the filter stuck on nothing.
    const active = opts.some((o) => o.key === topic) ? topic : ALL;
    const shown = groupIntoShelves(searched).filter((s) => active === ALL || shelfKey(s) === active);
    return { options: opts, activeTopic: active, shelves: shown, visibleCount: shown.reduce((n, s) => n + s.books.length, 0) };
  }, [books, query, topic]);

  const hero = !isOffline && continuing.length > 0 ? continuing[0] : null;
  const hasBooks = books !== null && books.length > 0;

  function clearFilters() {
    setQuery('');
    setTopic(ALL);
  }

  return html`
    <div>
      <header class="lib-header">
        <div>
          <p class="eyebrow">BookSnap · Thư phòng gia đình</p>
          <h1>Thư viện</h1>
        </div>
        <${LibraryAccountMenu} name=${user ? user.display_name : ''} onLogout=${signOut} />
      </header>

      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${isOffline &&
        html`<div class="banner banner-info"><${Icon} name="clock" size=${14} /> Đang ngoại tuyến — chỉ hiện sách đã tải để nghe offline</div>`}

        ${hero && html`<${LibraryHeroCard} book=${hero} />`}

        ${books === null && !error && html`<div class="crate-skeleton skeleton" aria-hidden="true"></div>`}
        ${books !== null && books.length === 0 &&
        html`
          <div class="empty-state">
            <${Icon} name="book-open" size=${64} />
            <div class="fleuron-rule" aria-hidden="true"><i></i></div>
            <p>Chưa có sách nào trong thư viện.</p>
            <a class="btn btn-primary" href="#/capture">Chụp trang sách đầu tiên</a>
          </div>
        `}

        ${hasBooks &&
        html`
          <div class="search">
            <${Icon} name="search" size=${18} />
            <input type="search" placeholder="Tìm tên sách…" aria-label="Tìm tên sách" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} />
          </div>
          <div class="lib-toolbar">
            <p class="lib-summary" aria-live="polite">${visibleCount} đĩa · ${shelves.length} thùng</p>
            <${TopicFilterMenu} options=${options} value=${activeTopic} onChange=${setTopic} />
          </div>
          ${shelves.map((shelf) => html`<${LibraryCrate} key=${shelfKey(shelf)} shelf=${shelf} offline=${isOffline} />`)}
          ${visibleCount === 0 &&
          html`
            <div class="lib-empty">
              <p>${query.trim() ? html`Không có sách nào khớp “${query.trim()}”.` : 'Không có sách nào trong chủ đề này.'}</p>
              <button class="btn btn-secondary" onClick=${clearFilters}>Xoá tìm kiếm và bộ lọc</button>
            </div>
          `}
          <div class="fleuron-rule lib-end" aria-hidden="true"><i></i></div>
        `}
      </div>
    </div>
  `;
}
