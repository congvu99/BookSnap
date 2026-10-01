// "Xem tất cả": full grid of one rail. Renders the cached library instantly, then refreshes.
import { html, useEffect, useMemo, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { authStore, safeLocalStorage } from '../store.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { readLibraryCache, writeLibraryCache } from '../library-cache.js';
import { railByKey } from '../library-rails.js';
import { LibraryBookGrid } from '../components/library-rail.js';
import { Icon } from '../icons.js';

/** Back to the previous screen, or the library when the page was opened directly. */
function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/library';
}

/** @param {{ railKey: string }} props railKey is the decoded rail key (e.g. 'shelf', 'topic:<id>') */
export function LibraryBrowseView({ railKey }) {
  const user = authStore.get().user;
  const profileId = user ? user.id : null;
  const profileName = user ? user.display_name : '';
  const [cached] = useState(() => readLibraryCache(safeLocalStorage(), profileId));
  const [books, setBooks] = useState(/** @type {any[]|null} */ (cached ? cached.books : null));
  const [continuing, setContinuing] = useState(/** @type {any[]} */ (cached ? cached.continuing : []));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, cont] = await Promise.all([booksApi.list(), booksApi.continueListening()]);
        if (cancelled) return;
        setBooks(list);
        setContinuing(cont);
        setIsOffline(false);
        setError(null);
        writeLibraryCache(safeLocalStorage(), profileId, { books: list, continuing: cont });
      } catch (err) {
        if (cancelled) return;
        if (books !== null) return; // keep the snapshot already on screen
        const offline = listOfflineBooks();
        if (offline.length > 0) {
          setBooks(offline.map((o) => o.book));
          setIsOffline(true);
        } else {
          setError(err.message || 'Không tải được thư viện');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rail = useMemo(() => (books ? railByKey(books, continuing, profileName, railKey) : null), [books, continuing, profileName, railKey]);
  // Offline copies carry no shelf/topic info, so show them all under one title.
  const title = isOffline ? 'Đã tải để nghe offline' : rail ? rail.title : 'Thư viện';
  const shown = isOffline ? books || [] : rail ? rail.books : [];

  return html`
    <div>
      <header class="lib-header browse-header">
        <button class="icon-btn" aria-label="Quay lại" onClick=${goBack}><${Icon} name="chevron-left" size=${24} /></button>
        <h1>${title}</h1>
      </header>
      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${books === null && !error && html`<div class="crate-skeleton skeleton" aria-hidden="true"></div>`}
        ${books !== null && shown.length === 0 &&
        html`<div class="lib-empty"><p>Không còn sách nào ở đây.</p><a class="btn btn-secondary" href="#/library">Về thư viện</a></div>`}
        ${shown.length > 0 && html`<${LibraryBookGrid} books=${shown} offline=${isOffline} />`}
      </div>
    </div>
  `;
}
