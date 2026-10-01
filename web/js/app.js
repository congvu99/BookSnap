// Hash router + app shell. Routes: #/auth #/profiles #/library #/browse/:railKey #/bookmarks #/me #/me/:section #/capture #/capture/:bookId
// (#/account redirects to #/me)
// #/book/:id #/read/:id #/listen/:id (both take an optional ?seq= to start at a chunk)
import { html, render, useEffect, useState } from '../vendor/preact-htm.module.js';
import { authApi, onProfileRequired, onUnauthorized } from './api-client.js';
import { authErrorKind } from './auth-error-kind.js';
import { authStore, CACHED_USER_KEY, cacheUser, clearCachedUser, hasUnsavedWork, readCachedUser } from './store.js';
import { Icon } from './icons.js';
import { BottomNav } from './components/bottom-nav.js';
import { TopProgressBar } from './components/top-progress-bar.js';
import { VinylLoader } from './components/vinyl-loader.js';
import { AuthView } from './views/auth-view.js';
import { LibraryView } from './views/library-view.js';
import { CaptureView } from './views/capture-view.js';
import { BookStatusView } from './views/book-status-view.js';
import { ReaderView } from './views/reader-view.js';
import { BookmarksView } from './views/bookmarks-view.js';
import { MeView } from './views/me-view.js';
import { MeSectionView } from './views/me-section-view.js';
import { LibraryBrowseView } from './views/library-browse-view.js';
import { ProfilePickerView } from './views/profile-picker-view.js';
import { ProfileSwitchSheet } from './components/profile-switch-sheet.js';
import { directionFor, runRouteTransition } from './route-transition.js';

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
  if (segments[0] === 'me') return segments[1] ? { name: 'me-section', section: segments[1] } : { name: 'me' };
  if (segments[0] === 'browse' && segments[1]) {
    try {
      return { name: 'browse', railKey: decodeURIComponent(segments[1]) };
    } catch {
      return { name: 'library' };
    }
  }
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
const routeKeyOf = (route) => route.name + (route.bookId || route.section || route.railKey || '');
// Deeper screens slide in from the right a few px; top-level tabs just fade/rise (see motion.css).
const DEEP_ROUTES = new Set(['book', 'read', 'capture', 'browse', 'me-section', 'profiles', 'bookmarks']);

function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [authReady, setAuthReady] = useState(authStore.get().ready);
  const [user, setUser] = useState(authStore.get().user);
  const [offline, setOffline] = useState(authStore.get().offline);
  const [needsProfile, setNeedsProfile] = useState(authStore.get().needsProfile);

  useEffect(() => {
    let shownHash = window.location.hash;
    // Hashes visited since the last tab switch: going back to the previous one animates as a pop.
    const navStack = [shownHash];
    const onHashChange = () => {
      // Under the picker overlay the capture view holds unsent pages: back/swipe must not unmount it.
      const s = authStore.get();
      if (s.needsProfile && s.user && hasUnsavedWork()) {
        window.history.replaceState(null, '', shownHash);
        return;
      }
      if (window.location.hash.startsWith('#/account')) {
        window.location.replace('#/me');
        return;
      }
      const from = parseRoute(shownHash);
      const nextHash = window.location.hash;
      shownHash = nextHash;
      // iOS-style motion: push into deeper screens, pop back out, crossfade between tabs.
      let direction = directionFor(from, parseRoute(nextHash));
      if (direction === 'tab') navStack.splice(0, navStack.length, nextHash);
      else if (navStack.length > 1 && navStack[navStack.length - 2] === nextHash) {
        navStack.pop();
        if (direction !== 'none') direction = 'pop';
      } else navStack.push(nextHash);
      // The transition helper waits for the render itself (no frame waits: see route-transition.js).
      runRouteTransition(direction, () => setHash(nextHash)).catch(() => setHash(nextHash));
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
    const unsubProfileRequired = onProfileRequired((e) => {
      const detail = (e && e.detail) || {};
      if (detail.code === 'profile_mismatch' && detail.profileId && detail.profileId !== authStore.get().user?.id) return;
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
    return html`<${VinylLoader} />`;
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

  // Switching profile rebuilds the screen so every view reloads that profile's data (library rails,
  // shelf, progress). Capture is the exception: its unsent pages must survive a profile switch.
  const viewKey = route.name === 'capture' ? routeKey : `${user ? user.id : ''}:${routeKey}`;
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
      window.location.replace('#/me');
      return null;
    case 'me':
      view = html`<${MeView} />`;
      break;
    case 'me-section':
      view = html`<${MeSectionView} section=${route.section} />`;
      break;
    case 'browse':
      view = html`<${LibraryBrowseView} railKey=${route.railKey} />`;
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
        <div class="route-view ${DEEP_ROUTES.has(route.name) ? 'route-view--deep' : ''}" key=${viewKey}>${view}</div>
      </main>
      ${showNav && html`<${BottomNav} currentRoute=${hash || '#/library'} />`}
      ${needsProfile && html`<${ProfilePickerView} currentUser=${user} overlay onPicked=${onPicked} />`}
      ${user && html`<${ProfileSwitchSheet} />`}
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('sw register failed', err));
  });
}
