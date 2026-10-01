// Hash router + app shell. Routes: #/auth #/profiles #/library #/bookmarks #/account #/capture #/capture/:bookId
// #/book/:id #/read/:id #/listen/:id (both take an optional ?seq= to start at a chunk)
import { html, render, useEffect, useState } from '../vendor/preact-htm.module.js';
import { authApi, onProfileRequired, onUnauthorized } from './api-client.js';
import { authErrorKind } from './auth-error-kind.js';
import { authStore, CACHED_USER_KEY, cacheUser, clearCachedUser, hasUnsavedWork, readCachedUser } from './store.js';
import { Icon } from './icons.js';
import { BottomNav } from './components/bottom-nav.js';
import { TopProgressBar } from './components/top-progress-bar.js';
import { AuthView } from './views/auth-view.js';
import { LibraryView } from './views/library-view.js';
import { CaptureView } from './views/capture-view.js';
import { BookStatusView } from './views/book-status-view.js';
import { ReaderView } from './views/reader-view.js';
import { BookmarksView } from './views/bookmarks-view.js';
import { AccountView } from './views/account-view.js';
import { ProfilePickerView } from './views/profile-picker-view.js';

/** Parse the current location hash into a {name, params} route. */
function parseRoute(hash) {
  const [path, queryString = ''] = (hash || '#/library').replace(/^#/, '').split('?');
  const query = new URLSearchParams(queryString);
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'auth') return { name: 'auth' };
  if (segments[0] === 'profiles') return { name: 'profiles' };
  if (segments[0] === 'capture') return { name: 'capture', bookId: segments[1], query };
  if (segments[0] === 'book' && segments[1]) return { name: 'book', bookId: segments[1] };
  if (segments[0] === 'bookmarks') return { name: 'bookmarks' };
  if (segments[0] === 'account') return { name: 'account' };
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

// 'read' covers both #/read and #/listen (see parseRoute). Listen mode is the "Đang nghe" tab's own
// screen and has nothing pinned to the bottom, so it keeps the nav; read mode's mini player owns that edge.
const NO_NAV_ROUTES = new Set(['auth', 'profiles', 'capture', 'read']);
const showsNav = (route) => !NO_NAV_ROUTES.has(route.name) || (route.name === 'read' && route.mode === 'listen');

// Transition identity: name + book, never mode, so read↔listen neither animates nor remounts.
const routeKeyOf = (route) => route.name + (route.bookId || '');
// Deeper screens slide in from the right a few px; top-level tabs just fade/rise (see motion.css).
const DEEP_ROUTES = new Set(['book', 'read', 'capture']);

function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [authReady, setAuthReady] = useState(authStore.get().ready);
  const [user, setUser] = useState(authStore.get().user);
  const [offline, setOffline] = useState(authStore.get().offline);
  const [needsProfile, setNeedsProfile] = useState(authStore.get().needsProfile);

  useEffect(() => {
    let shownHash = window.location.hash;
    const onHashChange = () => {
      // Under the picker overlay the capture view holds unsent pages: back/swipe must not unmount it.
      const s = authStore.get();
      if (s.needsProfile && s.user && hasUnsavedWork()) {
        window.history.replaceState(null, '', shownHash);
        return;
      }
      shownHash = window.location.hash;
      setHash(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    const unsubAuth = authStore.subscribe((s) => {
      setUser(s.user);
      setAuthReady(s.ready);
      setOffline(s.offline);
      setNeedsProfile(s.needsProfile);
    });
    const unsubUnauthorized = onUnauthorized(() => {
      // A real 401 from any authenticated call means the session is actually gone — unlike the
      // bootstrap me() failure below, this is never "just offline" (a network/5xx error never
      // dispatches this event — see api-client.js).
      clearCachedUser();
      authStore.set({ user: null, needsProfile: false, ready: true, offline: false });
      if (parseRoute(window.location.hash).name !== 'auth') window.location.hash = '#/auth';
    });
    const unsubProfileRequired = onProfileRequired(() => {
      // The profile was deleted on another device, or another tab switched profile. Unsent captured
      // pages must survive: keep the current view (and its stale user) under the picker overlay.
      if (authStore.get().needsProfile) return;
      clearCachedUser();
      authStore.set((s) => ({ needsProfile: true, user: hasUnsavedWork() ? s.user : null }));
    });
    // Another tab picked a different profile: the shared cookie now points there, so this tab
    // follows (reload re-reads /api/me) instead of showing one profile while writing as another.
    const onStorage = (e) => {
      if (e.key !== CACHED_USER_KEY || !e.newValue) return;
      const current = authStore.get().user;
      let next = null;
      try {
        next = JSON.parse(e.newValue);
      } catch {
        return;
      }
      if (!current) {
        // Sitting on the forced picker: another tab picked a profile, follow it.
        if (next && authStore.get().needsProfile) window.location.reload();
        return;
      }
      if (!next || next.id === current.id) return;
      if (hasUnsavedWork()) authStore.set({ needsProfile: true });
      else window.location.reload();
    };
    window.addEventListener('storage', onStorage);
    if (!authStore.get().ready) {
      authApi
        .me()
        .then((me) => {
          cacheUser(me);
          authStore.set({ user: me, ready: true, offline: false });
        })
        .catch((err) => {
          // C4: a real 401 means "logged out" — clear everything. 409 profile_required means signed
          // in but no (valid) profile: show the picker, never the offline fallback. Anything else
          // (network error, status 0, the SW's offline-503 JSON) means "we simply can't reach the
          // server right now" — keep the last known profile so a downloaded book stays reachable.
          const kind = authErrorKind(err);
          if (kind === 'logged_out' || kind === 'needs_profile') {
            clearCachedUser();
            authStore.set({ user: null, needsProfile: kind === 'needs_profile', ready: true, offline: false });
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
      unsubProfileRequired();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // New screen → start at the top; read↔listen share a key so the reader keeps its scroll.
  const routeKey = routeKeyOf(parseRoute(hash));
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [routeKey]);

  if (!authReady) {
    return html`<div class="container"><div class="skeleton" style=${{ height: '240px' }}></div></div>`;
  }

  const route = parseRoute(hash);

  /** A profile was picked (picker screen or overlay). */
  function onPicked(me) {
    cacheUser(me);
    authStore.set({ user: me, needsProfile: false });
    if (route.name === 'profiles' || route.name === 'auth') window.location.hash = '#/library';
  }

  // `user` is only kept while needsProfile when a view holds unsent work (see onProfileRequired):
  // then the view stays mounted under the overlay rendered at the end of the shell.
  if (needsProfile && !user) {
    return html`<${TopProgressBar} /><${ProfilePickerView} currentUser=${null} onPicked=${onPicked} />`;
  }
  if (!user && route.name !== 'auth') {
    window.location.hash = '#/auth';
    return null;
  }
  if (user && route.name === 'auth' && !needsProfile) {
    window.location.hash = '#/library';
    return null;
  }

  const showNav = showsNav(route);
  let view;
  switch (route.name) {
    case 'auth':
      view = html`<${AuthView} onAuthed=${() => (window.location.hash = '#/library')} />`;
      break;
    case 'profiles':
      view = html`<${ProfilePickerView} currentUser=${user} onPicked=${onPicked} onBack=${() => window.history.back()} />`;
      break;
    case 'capture':
      view = html`<${CaptureView} bookId=${route.bookId} skipConfirm=${route.query.get('start') === '1'} key=${route.bookId || 'new'} />`;
      break;
    case 'book':
      view = html`<${BookStatusView} bookId=${route.bookId} key=${route.bookId} />`;
      break;
    case 'read':
      // Keyed by profile too: switching profile must rebuild PlaybackProgress for the new profile.
      view = html`<${ReaderView} bookId=${route.bookId} mode=${route.mode} startSeq=${seqParam(route.query)} key=${`${user.id}:${route.bookId}`} />`;
      break;
    case 'bookmarks':
      view = html`<${BookmarksView} />`;
      break;
    case 'account':
      view = html`<${AccountView} />`;
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
      <${TopProgressBar} />
      <main class="app-main ${showNav ? 'app-main--with-nav' : ''}" inert=${needsProfile ? true : undefined}>
        <div class="route-view ${DEEP_ROUTES.has(route.name) ? 'route-view--deep' : ''}" key=${routeKey}>${view}</div>
      </main>
      ${showNav && html`<${BottomNav} currentRoute=${hash || '#/library'} />`}
      ${needsProfile && html`<${ProfilePickerView} currentUser=${user} overlay onPicked=${onPicked} />`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw register failed', err));
  });
}
