// Của tôi (#/me): current profile block + grouped rows linking to #/me/<section>, bookmarks and profile management.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { accountApi, booksApi } from '../api-client.js';
import { authStore, safeLocalStorage, themeStore } from '../store.js';
import { readLibraryCache } from '../library-cache.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { signOut } from '../sign-out.js';
import { openProfileSwitcher } from '../profile-switcher.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { Icon } from '../icons.js';
import { loadCached, peekCached } from '../view-cache.js';

export const THEME_LABELS = { light: 'Sáng', dark: 'Tối', auto: 'Theo máy' };

const countLabel = (n, unit) => (typeof n === 'number' ? `${n} ${unit}` : '');
const shelfCountOf = (books) => books.filter((b) => b.on_shelf).length;

function Row({ href, icon, label, meta = '' }) {
  return html`
    <a class="row" href=${href}>
      <${Icon} name=${icon} size=${22} />
      <span>${label}</span>
      <span class="meta">${meta}</span>
      <${Icon} name="chevron-right" size=${16} className="chev" />
    </a>
  `;
}

export function MeView() {
  const user = authStore.get().user;
  const [theme, setTheme] = useState(themeStore.get().theme);
  // Shelf count: show the library snapshot instantly, then refresh from the server.
  const [shelfCount, setShelfCount] = useState(() => {
    const opts = { profileId: user ? user.id : null };
    const books = peekCached('books:list', opts);
    if (books) return shelfCountOf(books);
    const snapshot = readLibraryCache(safeLocalStorage(), opts.profileId);
    return snapshot ? shelfCountOf(snapshot.books) : null;
  });
  const [bookmarkCount, setBookmarkCount] = useState(/** @type {number|null} */ (() => {
    const profile = peekCached('profile', { profileId: user ? user.id : null });
    return profile ? profile.stats.bookmarks : null;
  }));
  const [downloadCount] = useState(() => listOfflineBooks().length);

  useEffect(() => themeStore.subscribe((s) => setTheme(s.theme)), []);

  useEffect(() => {
    const opts = { profileId: user ? user.id : null };
    // Offline: failures are ignored, the snapshot counts stay.
    const stopBooks = loadCached('books:list', () => booksApi.list(), opts, { onValue: (books) => setShelfCount(shelfCountOf(books)) });
    const stopProfile = loadCached('profile', () => accountApi.profile(), opts, { onValue: (p) => setBookmarkCount(p.stats.bookmarks) });
    return () => {
      stopBooks();
      stopProfile();
    };
  }, []);

  if (!user) return null;
  const openSwitcher = (e) => openProfileSwitcher(e.currentTarget);

  return html`
    <div class="me">
      <header class="me-bar"><h1>Của tôi</h1></header>
      <div class="me-head">
        <button class="me-avatar-btn" aria-label="Đổi hồ sơ" onClick=${openSwitcher}>
          <${ProfileAvatar} name=${user.display_name} avatar=${user.avatar} large />
        </button>
        <div class="me-head-text">
          <h2>${user.display_name}</h2>
          <p>Tài khoản gia đình @${user.username}</p>
          <button class="me-link" onClick=${openSwitcher}>Đổi hồ sơ ›</button>
        </div>
      </div>

      <p class="group-title">Của ${user.display_name}</p>
      <div class="group">
        <${Row} href="#/me/shelf" icon="library" label="Kệ của tôi" meta=${countLabel(shelfCount, 'cuốn')} />
        <${Row} href="#/bookmarks" icon="bookmark" label="Đánh dấu" meta=${countLabel(bookmarkCount, 'đoạn')} />
        <${Row} href="#/me/downloads" icon="download" label="Đã tải để nghe offline" meta=${countLabel(downloadCount, 'cuốn')} />
      </div>

      <p class="group-title">Gia đình</p>
      <div class="group">
        <${Row} href="#/profiles?manage=1" icon="user" label="Quản lý hồ sơ" />
        <${Row} href="#/me/password" icon="lock" label="Mật khẩu gia đình" />
        <${Row} href="#/me/quota" icon="gauge" label="Hạn mức dịch vụ" />
      </div>

      <p class="group-title">Ứng dụng</p>
      <div class="group">
        <${Row} href="#/me/theme" icon="sun" label="Giao diện" meta=${THEME_LABELS[theme] || THEME_LABELS.auto} />
        <${Row} href="#/me/name" icon="edit" label="Tên hồ sơ" />
      </div>

      <div class="group">
        <button class="row danger" onClick=${signOut}>Đăng xuất tài khoản gia đình</button>
      </div>
    </div>
  `;
}
