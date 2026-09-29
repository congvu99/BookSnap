// Bottom nav: Thư viện · Đánh dấu · Chụp (primary) · Đang nghe. Hidden in reader/camera (app.js decides).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { booksApi } from '../api-client.js';

/** @param {{ currentRoute: string }} props */
export function BottomNav({ currentRoute }) {
  const [continueBookId, setContinueBookId] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    let cancelled = false;
    booksApi
      .continueListening()
      .then((books) => {
        if (!cancelled && books.length > 0) setContinueBookId(books[0].id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isLibrary = currentRoute.startsWith('#/library') || currentRoute === '#/' || currentRoute === '';
  const isCapture = currentRoute.startsWith('#/capture');
  const isBookmarks = currentRoute.startsWith('#/bookmarks');
  const routePath = currentRoute.split('?')[0];
  const isContinue = continueBookId != null && (routePath === `#/listen/${continueBookId}` || routePath === `#/read/${continueBookId}`);

  return html`
    <nav class="bottom-nav" aria-label="Điều hướng chính">
      <a href="#/library" aria-current=${isLibrary ? 'page' : undefined}>
        <${Icon} name="library" />
        <span>Thư viện</span>
      </a>
      <a href="#/bookmarks" aria-current=${isBookmarks ? 'page' : undefined}>
        <${Icon} name="bookmark" />
        <span>Đánh dấu</span>
      </a>
      <a href="#/capture" class="nav-capture" aria-current=${isCapture ? 'page' : undefined} aria-label="Chụp trang sách">
        <span class="nav-capture-circle"><${Icon} name="camera" /></span>
      </a>
      <a
        href=${continueBookId ? `#/listen/${continueBookId}` : '#/library'}
        aria-current=${isContinue ? 'page' : undefined}
        aria-label="Đang nghe"
      >
        <${Icon} name="disc" />
        <span>Đang nghe</span>
      </a>
    </nav>
  `;
}
