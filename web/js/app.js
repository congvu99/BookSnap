// Hash router + app shell. Routes: #/auth #/library #/bookmarks #/capture #/capture/:bookId #/book/:id
// #/read/:id #/listen/:id (both take an optional ?seq= to start at a chunk)
import { html, render, useEffect, useState } from '../vendor/preact-htm.module.js';
import { ApiError, authApi, onUnauthorized } from './api-client.js';
import { authStore, cacheUser, clearCachedUser, readCachedUser } from './store.js';
import { Icon } from './icons.js';
import { BottomNav } from './components/bottom-nav.js';
import { AuthView } from './views/auth-view.js';
import { LibraryView } from './views/library-view.js';
import { CaptureView } from './views/capture-view.js';
import { BookStatusView } from './views/book-status-view.js';
import { ReaderView } from './views/reader-view.js';
import { BookmarksView } from './views/bookmarks-view.js';

/** Parse the current location hash into a {name, params} route. */
function parseRoute(hash) {
  const [path, queryString = ''] = (hash || '#/library').replace(/^#/, '').split('?');
  const query = new URLSearchParams(queryString);
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'auth') return { name: 'auth' };
  if (segments[0] === 'capture') return { name: 'capture', bookId: segments[1] };
  if (segments[0] === 'book' && segments[1]) return { name: 'book', bookId: segments[1] };
  if (segments[0] === 'bookmarks') return { name: 'bookmarks' };
  // listen and read are two modes of the same ReaderView, so switching never remounts the player.
  if ((segments[0] === 'read' || segments[0] === 'listen') && segments[1]) {
    return { name: 'read', bookId: segments[1], mode: segments[0], query };
  }
  return { name: 'library' };
}

/** ?seq=n (a bookmark's "Nghe từ đây") → chunk seq to start at, or null. */
function seqParam(query) {
  const seq = Number(query.get('seq'));
  return query.has('seq') && Number.isInteger(seq) && seq >= 0 ? seq : null;
}

// 'read' covers both #/read and #/listen (see parseRoute).
const NO_NAV_ROUTES = new Set(['auth', 'capture', 'read']);

function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [authReady, setAuthReady] = useState(authStore.get().ready);
  const [user, setUser] = useState(authStore.get().user);
  const [offline, setOffline] = useState(authStore.get().offline);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    const unsubAuth = authStore.subscribe((s) => {
      setUser(s.user);
      setAuthReady(s.ready);
      setOffline(s.offline);
    });
    const unsubUnauthorized = onUnauthorized(() => {
      // A real 401 from any authenticated call means the session is actually gone — unlike the
      // bootstrap me() failure below, this is never "just offline" (a network/5xx error never
      // dispatches this event — see api-client.js).
      clearCachedUser();
      authStore.set({ user: null, ready: true, offline: false });
      if (parseRoute(window.location.hash).name !== 'auth') window.location.hash = '#/auth';
    });
    if (!authStore.get().ready) {
      authApi
        .me()
        .then((me) => {
          cacheUser(me);
          authStore.set({ user: me, ready: true, offline: false });
        })
        .catch((err) => {
          // C4: a real 401 means "logged out" — clear everything. Anything else (network error,
          // status 0, or the SW's offline-503 JSON) means "we simply can't reach the server right
          // now" — keep the last known user so a downloaded book stays reachable offline.
          if (err instanceof ApiError && err.status === 401) {
            clearCachedUser();
            authStore.set({ user: null, ready: true, offline: false });
            return;
          }
          const cached = readCachedUser();
          authStore.set({ user: cached, ready: true, offline: Boolean(cached) });
        });
    }
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      unsubAuth();
      unsubUnauthorized();
    };
  }, []);

  if (!authReady) {
    return html`<div class="container"><div class="skeleton" style=${{ height: '240px' }}></div></div>`;
  }

  const route = parseRoute(hash);
  if (!user && route.name !== 'auth') {
    window.location.hash = '#/auth';
    return null;
  }
  if (user && route.name === 'auth') {
    window.location.hash = '#/library';
    return null;
  }

  const showNav = !NO_NAV_ROUTES.has(route.name);
  let view;
  switch (route.name) {
    case 'auth':
      view = html`<${AuthView} onAuthed=${() => (window.location.hash = '#/library')} />`;
      break;
    case 'capture':
      view = html`<${CaptureView} bookId=${route.bookId} key=${route.bookId || 'new'} />`;
      break;
    case 'book':
      view = html`<${BookStatusView} bookId=${route.bookId} key=${route.bookId} />`;
      break;
    case 'read':
      view = html`<${ReaderView} bookId=${route.bookId} mode=${route.mode} startSeq=${seqParam(route.query)} key=${route.bookId} />`;
      break;
    case 'bookmarks':
      view = html`<${BookmarksView} />`;
      break;
    default:
      view = html`<${LibraryView} />`;
  }

  return html`
    <div class="app-shell">
      ${offline &&
      html`<div
        class="banner banner-info"
        role="status"
        style=${{ position: 'sticky', top: 0, zIndex: 30, justifyContent: 'center', borderRadius: 0 }}
      >
        <${Icon} name="clock" size=${14} /> Đang ngoại tuyến
      </div>`}
      <main class="app-main ${showNav ? 'app-main--with-nav' : ''}">${view}</main>
      ${showNav && html`<${BottomNav} currentRoute=${hash || '#/library'} />`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw register failed', err));
  });
}
