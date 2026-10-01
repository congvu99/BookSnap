// Thư viện chung as Netflix-style rails: hero "Nghe tiếp", then rails (continue, shelf, recent, one per
// topic). Search swaps the rails for a flat result grid. Layout: docs/mockups/netflix-style-ux-preview.html.
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { authStore, safeLocalStorage } from '../store.js';
import { openProfileSwitcher } from '../profile-switcher.js';
import { buildRails } from '../library-rails.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { readLibraryCache, writeLibraryCache } from '../library-cache.js';
import { setCached } from '../view-cache.js';
import { matchesQuery } from '../text-fold.js';
import { LibraryHeroCard } from '../components/library-hero-card.js';
import { LibraryRail, LibraryBookGrid } from '../components/library-rail.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { useVisiblePolling } from '../use-visible-polling.js';
import { phaseOf } from '../processing-progress.js';
import { Icon } from '../icons.js';

const OFFLINE_RAIL_TITLE = 'Đã tải để nghe offline';
const LIVE_POLL_MS = 5000;
const QUOTA_POLL_MS = 60000;
const LIVE_PHASES = new Set(['ocr', 'tts', 'tail_wait']);

export function LibraryView() {
  const user = authStore.get().user;
  // Stale-while-revalidate: the snapshot is read once, keyed by the current profile (never another one's).
  const [cached] = useState(() => readLibraryCache(safeLocalStorage(), user ? user.id : null));
  const [books, setBooks] = useState(/** @type {any[]|null} */ (cached ? cached.books : null));
  const [continuing, setContinuing] = useState(/** @type {any[]} */ (cached ? cached.continuing : []));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [isOffline, setIsOffline] = useState(false);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  useEffect(() => {
    if (searchOpen && searchRef.current) searchRef.current.focus();
  }, [searchOpen]);
  // Showing a snapshot whose refresh failed: tell the user and offer a retry.
  const [stale, setStale] = useState(false);
  const staleRef = useRef(false);
  staleRef.current = stale;

  function saveCache(list, cont) {
    writeLibraryCache(safeLocalStorage(), user ? user.id : null, { books: list, continuing: cont });
    if (user) setCached('books:list', list, { profileId: user.id });
  }

  async function load() {
    setError(null);
    try {
      const [list, cont] = await Promise.all([booksApi.list(), booksApi.continueListening()]);
      setBooks(list);
      setContinuing(cont);
      setIsOffline(false);
      setStale(false);
      saveCache(list, cont);
    } catch (err) {
      // Network down: the browser says so, or the request never reached the server / the service
      // worker answered its offline 503.
      const reallyOffline = (typeof navigator !== 'undefined' && navigator.onLine === false) || err.status === 0 || err.status === 503;
      // A snapshot is already on screen: keep it, but say it may be out of date. Only when offline
      // with downloaded books swap to them (the offline banner describes exactly that list).
      if (cached && (!reallyOffline || listOfflineBooks().length === 0)) {
        setStale(true);
        return;
      }
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

  // The first load decides offline mode; later connectivity loss only pauses polling.
  const [online, setOnline] = useState(typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const up = () => {
      setOnline(true);
      if (staleRef.current) load();
    };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Background refresh: only touches the data, never error / offline / search / filter state.
  async function refresh(isStale) {
    // Each endpoint applies on its own: a failing hero must not freeze the build progress.
    const [list, cont] = await Promise.allSettled([booksApi.list(), booksApi.continueListening()]);
    if (isStale()) return;
    if (list.status === 'fulfilled') setBooks(list.value);
    if (cont.status === 'fulfilled') setContinuing(cont.value);
    if (list.status === 'fulfilled' && cont.status === 'fulfilled') saveCache(list.value, cont.value);
  }
  const phases = (books || []).filter((b) => b.pages && b.chunks).map(phaseOf);
  const anyLive = phases.some((p) => LIVE_PHASES.has(p));
  const onlyQuota = !anyLive && phases.includes('quota');
  useVisiblePolling(refresh, anyLive ? LIVE_POLL_MS : QUOTA_POLL_MS, !isOffline && online && (anyLive || onlyQuota));

  const profileName = user ? user.display_name : '';
  const searching = query.trim() !== '';
  const rails = useMemo(() => {
    const list = books || [];
    // Offline lists come from the download cache (no shelf/topic info): one flat rail of them.
    if (isOffline) return list.length ? [{ key: 'offline', title: OFFLINE_RAIL_TITLE, books: list }] : [];
    return buildRails(list, continuing, profileName);
  }, [books, continuing, isOffline, profileName]);
  const results = useMemo(() => (searching ? (books || []).filter((b) => matchesQuery(b.title, query)) : []), [books, query, searching]);

  const hero = !isOffline && continuing.length > 0 ? continuing[0] : null;
  const hasBooks = books !== null && books.length > 0;

  function toggleSearch() {
    if (searchOpen) setQuery('');
    setSearchOpen(!searchOpen);
  }

  return html`
    <div>
      <header class="lib-header">
        <h1>Thư viện</h1>
        <div class="lib-header-actions">
          ${hasBooks &&
          html`<button class="icon-btn" aria-label="Tìm sách" aria-expanded=${searchOpen ? 'true' : 'false'} onClick=${toggleSearch}><${Icon} name=${searchOpen ? 'x' : 'search'} size=${22} /></button>`}
          <button class="avatar avatar--profile" aria-label=${`Hồ sơ ${profileName}, đổi hồ sơ`} onClick=${(e) => openProfileSwitcher(e.currentTarget)}>
            <${ProfileAvatar} name=${profileName} avatar=${user ? user.avatar : null} />
          </button>
        </div>
      </header>

      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${stale && !error &&
        html`<div class="banner banner-info" role="status">
          <${Icon} name="clock" size=${14} /> Chưa cập nhật được thư viện, đang hiện bản lần trước.
          <button class="btn btn-ghost" onClick=${load}>Thử lại</button>
        </div>`}
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

        ${hasBooks && searchOpen &&
        html`<div class="search">
          <${Icon} name="search" size=${18} />
          <input type="search" ref=${searchRef} placeholder="Tìm tên sách…" aria-label="Tìm tên sách" value=${query} onInput=${(e) => setQuery(e.currentTarget.value)} />
        </div>`}

        ${hasBooks && !searching && rails.map((rail) => html`<${LibraryRail} key=${rail.key} rail=${rail} offline=${isOffline} />`)}
        ${hasBooks && searching && results.length > 0 &&
        html`<section class="rail" aria-label="Kết quả tìm kiếm">
          <div class="rail-head"><h2 class="rail-title">Kết quả<small aria-live="polite">${results.length}</small></h2></div>
          <${LibraryBookGrid} books=${results} offline=${isOffline} />
        </section>`}
        ${hasBooks && searching && results.length === 0 &&
        html`<div class="lib-empty">
          <p>Không có sách nào khớp “${query.trim()}”.</p>
          <button class="btn btn-secondary" onClick=${() => setQuery('')}>Xoá tìm kiếm</button>
        </div>`}
        ${hasBooks && html`<div class="fleuron-rule lib-end" aria-hidden="true"><i></i></div>`}
      </div>
    </div>
  `;
}
