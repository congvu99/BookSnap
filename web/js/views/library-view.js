// Thư viện chung: "Tiếp tục nghe" (của user hiện tại) + lưới toàn bộ sách (§6.2, step 4).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, authApi } from '../api-client.js';
import { authStore, clearCachedUser, clearUserProgress } from '../store.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { BookCover } from '../components/book-cover.js';
import { Icon } from '../icons.js';

const STATE_LABEL = {
  empty: 'Chưa có trang',
  processing: 'Đang xử lý',
  waiting_quota: 'Chờ quota',
  failed: 'Có lỗi',
  ready: 'Sẵn sàng',
};

function progressPercent(book) {
  if (!book.duration_ms || !book.progress) return 0;
  // Approximate: we don't have per-chunk offsets here, so show chunk-based fraction.
  if (!book.chunks.total) return 0;
  return Math.min(100, Math.round((book.progress.chunk_seq / Math.max(1, book.chunks.total)) * 100));
}

function BookCard({ book, offline = false }) {
  // Offline, the status view cannot load; the reader falls back to the saved offline copy.
  return html`
    <a class="book-card" href=${offline ? `#/read/${book.id}` : `#/book/${book.id}`}>
      <${BookCover} title=${book.title} />
      <div class="book-card-meta">
        <div class="book-card-title">${book.title}</div>
        <div class="book-card-by">Chụp bởi ${book.created_by_name}</div>
        ${book.progress &&
        html`
          <div class="book-progress-track">
            <div class="book-progress-fill" style=${{ width: `${progressPercent(book)}%` }}></div>
          </div>
        `}
        <div class="book-state book-state--${book.state}">
          ${book.state === 'ready' && html`<${Icon} name="check" size=${14} />`}
          ${book.state === 'failed' && html`<${Icon} name="alert-circle" size=${14} />`}
          ${(book.state === 'processing' || book.state === 'waiting_quota') && html`<${Icon} name="clock" size=${14} />`}
          <span>${STATE_LABEL[book.state] || book.state}</span>
        </div>
      </div>
    </a>
  `;
}

export function LibraryView() {
  const [books, setBooks] = useState(/** @type {any[]|null} */ (null));
  const [continuing, setContinuing] = useState(/** @type {any[]} */ ([]));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [isOffline, setIsOffline] = useState(false);
  const user = authStore.get().user;

  async function load() {
    setError(null);
    try {
      const [list, cont] = await Promise.all([booksApi.list(), booksApi.continueListening()]);
      setBooks(list);
      setContinuing(cont);
      setIsOffline(false);
    } catch (err) {
      // C4: offline — show whatever books were saved for offline reading instead of a dead end.
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

  async function logout() {
    try {
      await authApi.logout();
    } catch {
      // Ignore network errors on logout — clear local state regardless.
    }
    if (user) clearUserProgress(user.id);
    clearCachedUser();
    authStore.set({ user: null, ready: true, offline: false });
    window.location.hash = '#/auth';
  }

  return html`
    <div>
      <header class="library-header">
        <h1 style=${{ margin: 0, fontSize: '24px' }}>Thư viện</h1>
        <div class="library-user">
          <span>${user ? user.display_name : ''}</span>
          <button class="icon-btn" aria-label="Đăng xuất" onClick=${logout}><${Icon} name="log-out" /></button>
        </div>
      </header>

      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${isOffline &&
        html`<div class="banner banner-info"><${Icon} name="clock" size=${14} /> Đang ngoại tuyến — chỉ hiện sách đã tải để nghe offline</div>`}

        ${continuing.length > 0 &&
        html`
          <section class="continue-section">
            <h2>Tiếp tục nghe</h2>
            <div class="continue-scroll">
              ${continuing.map((b) => html`<div class="continue-card" key=${b.id}><${BookCard} book=${b} offline=${isOffline} /></div>`)}
            </div>
          </section>
        `}

        <h2>Toàn bộ sách</h2>
        ${books === null &&
        html`<div class="book-grid">
          ${[1, 2, 3, 4].map((i) => html`<div class="skeleton" style=${{ aspectRatio: '2/3' }} key=${i}></div>`)}
        </div>`}
        ${books !== null && books.length === 0 &&
        html`
          <div class="empty-state">
            <${Icon} name="book-open" size=${64} />
            <p>Chưa có sách nào trong thư viện.</p>
            <a class="btn btn-primary" href="#/capture">Chụp trang sách đầu tiên</a>
          </div>
        `}
        ${books !== null && books.length > 0 &&
        html`<div class="book-grid">${books.map((b) => html`<${BookCard} key=${b.id} book=${b} offline=${isOffline} />`)}</div>`}
      </div>
    </div>
  `;
}
