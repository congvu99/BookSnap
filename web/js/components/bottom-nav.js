// Bottom nav: Thư viện · Chụp (primary) · Đang nghe · Của tôi (current profile's avatar). Hidden in read mode/camera (app.js decides).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { booksApi } from '../api-client.js';
import { authStore } from '../store.js';
import { ProfileAvatar } from './profile-avatar.js';

// "Của tôi" owns its sub-screens plus the screens that moved under it.
const ME_PREFIXES = ['#/me', '#/account', '#/bookmarks', '#/profiles'];

/** @param {{ currentRoute: string }} props */
export function BottomNav({ currentRoute }) {
  const [continueBookId, setContinueBookId] = useState(/** @type {string|null} */ (null));
  const [user, setUser] = useState(authStore.get().user);

  useEffect(() => authStore.subscribe((s) => setUser(s.user)), []);

  useEffect(() => {
    let cancelled = false;
    setContinueBookId(null);
    booksApi
      .continueListening()
      .then((books) => {
        if (!cancelled && books.length > 0) setContinueBookId(books[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isLibrary = currentRoute.startsWith('#/library') || currentRoute.startsWith('#/browse') || currentRoute === '#/' || currentRoute === '';
  const isCapture = currentRoute.startsWith('#/capture');
  const routePath = currentRoute.split('?')[0];
  const isMe = ME_PREFIXES.some((p) => routePath === p || routePath.startsWith(`${p}/`));
  // On a listen screen the tab points at that book (any book, not only the latest in progress).
  const listeningBookId = routePath.startsWith('#/listen/') ? routePath.slice('#/listen/'.length) : null;
  const nowPlayingId = listeningBookId || continueBookId;
  const isContinue = listeningBookId != null || (continueBookId != null && routePath === `#/read/${continueBookId}`);

  return html`
    <nav class="bottom-nav" aria-label="Điều hướng chính">
      <a href="#/library" aria-current=${isLibrary ? 'page' : undefined}>
        <${Icon} name="library" />
        <span>Thư viện</span>
      </a>
      <a href="#/capture" class="nav-capture" aria-current=${isCapture ? 'page' : undefined} aria-label="Chụp trang sách">
        <span class="nav-capture-circle"><${Icon} name="camera" /></span>
      </a>
      <a
        href=${nowPlayingId ? `#/listen/${nowPlayingId}` : '#/library'}
        aria-current=${isContinue ? 'page' : undefined}
        aria-label="Đang nghe"
      >
        <${Icon} name="disc" />
        <span>Đang nghe</span>
      </a>
      <a href="#/me" class="nav-me" aria-current=${isMe ? 'page' : undefined} aria-label="Của tôi">
        ${user ? html`<${ProfileAvatar} name=${user.display_name} avatar=${user.avatar} />` : html`<${Icon} name="user" />`}
        <span>Của tôi</span>
      </a>
    </nav>
  `;
}
