// Thư viện chung as a jukebox list: the "Nghe tiếp" card, a switch between three views (by topic,
// newest first, my shelf), then the records. Search swaps the views for one flat result list.
// Layout: docs/mockups/library-redesign-options.html (D · Hộp đĩa jukebox).
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { authStore, safeLocalStorage } from '../store.js';
import { openProfileSwitcher } from '../profile-switcher.js';
import { buildGroups, LIBRARY_VIEWS } from '../library-rails.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { readLibraryCache, writeLibraryCache } from '../library-cache.js';
import { setCached } from '../view-cache.js';
import { matchesQuery } from '../text-fold.js';
import { LibraryNowPlaying, LibraryRecordList } from '../components/library-record-list.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { useVisiblePolling } from '../use-visible-polling.js';
import { phaseOf } from '../processing-progress.js';
import { Icon } from '../icons.js';

const OFFLINE_RAIL_TITLE = 'Đã tải để nghe offline';
const LIVE_POLL_MS = 5000;
const QUOTA_POLL_MS = 60000;
const LIVE_PHASES = new Set(['ocr', 'tts', 'tail_wait']);
const VIEW_STORAGE_KEY = 'booksnap:libraryView';
const VIEW_LABELS = { topic: 'Theo chủ đề', recent: 'Mới thêm', shelf: 'Kệ của tôi' };
const EMPTY_VIEW_TEXT = { shelf: 'Chưa có sách nào trên kệ của bạn.' };

/** The list view chosen last time on this device, or the default. */
function readSavedView() {
  try {
    const saved = safeLocalStorage()?.getItem(VIEW_STORAGE_KEY);
    return LIBRARY_VIEWS.includes(saved) ? saved : LIBRARY_VIEWS[0];
  } catch {
    return LIBRARY_VIEWS[0];
  }
}

function saveView(view) {
  try {
    safeLocalStorage()?.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage full or blocked: the choice simply is not remembered.
  }
}

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
  const [view, setView] = useState(readSavedView);
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
  const groups = useMemo(() => {
    const list = books || [];
    // Offline lists come from the download cache (no shelf/topic info): one flat group of them.
    if (isOffline) return list.length ? [{ key: 'offline', title: OFFLINE_RAIL_TITLE, books: list }] : [];
    return buildGroups(list, view);
  }, [books, isOffline, view]);
  const results = useMemo(() => (searching ? (books || []).filter((b) => matchesQuery(b.title, query)) : []), [books, query, searching]);

  function chooseView(next) {
    setView(next);
    saveView(next);
  }

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

        ${hero && !searching && html`<${LibraryNowPlaying} book=${hero} />`}

        ${books === null && !error && html`<div class="rlist-skeleton skeleton" aria-hidden="true"></div>`}
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

        ${hasBooks && !searching && !isOffline &&
        html`<div class="lib-views" role="group" aria-label="Cách xếp sách">
          ${LIBRARY_VIEWS.map((v) => html`<button type="button" key=${v} aria-pressed=${view === v ? 'true' : 'false'} onClick=${() => chooseView(v)}>${VIEW_LABELS[v]}</button>`)}
        </div>`}
        ${hasBooks && !searching && html`<${LibraryRecordList} groups=${groups} offline=${isOffline} />`}
        ${hasBooks && !searching && groups.length === 0 && html`<div class="lib-empty"><p>${EMPTY_VIEW_TEXT[view] || 'Chưa có sách nào ở đây.'}</p></div>`}
        ${hasBooks && searching && results.length > 0 &&
        html`<${LibraryRecordList} groups=${[{ key: 'results', title: 'Kết quả', books: results }]} offline=${isOffline} />`}
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
