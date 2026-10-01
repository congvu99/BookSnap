// Sub-screens of Của tôi (#/me/<section>): shelf, downloads, quota, password, name, theme.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { accountApi, booksApi, usageApi } from '../api-client.js';
import { authStore, setTheme, themeStore } from '../store.js';
import { listOfflineBooks } from '../offline-book-cache.js';
import { UsageMeterList } from '../components/usage-meter-list.js';
import { DisplayNameForm, PasswordForm } from '../components/account-profile-forms.js';
import { RecordSleeve } from '../components/record-sleeve.js';
import { Icon } from '../icons.js';

const TITLES = {
  shelf: 'Kệ của tôi',
  downloads: 'Đã tải để nghe offline',
  quota: 'Hạn mức dịch vụ',
  password: 'Mật khẩu gia đình',
  name: 'Tên hồ sơ',
  theme: 'Giao diện',
};

const JOINED = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const NUMBER = new Intl.NumberFormat('vi-VN');
const STAT_LABELS = [
  ['books_created', 'Sách đã tạo'],
  ['pages_captured', 'Trang đã chụp'],
  ['books_listening', 'Sách đang nghe'],
  ['bookmarks', 'Đoạn đánh dấu'],
];
const isOfflineError = (err) => err.status === 0 || err.status === 503;

/** Back to where the user came from; a deep-linked screen (no history) falls back to #/me. */
function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.hash = '#/me';
}

function BookGrid({ books, offline = false, empty }) {
  if (books.length === 0) return html`<p class="note">${empty}</p>`;
  return html`
    <ul class="me-grid">
      ${books.map((book) => {
        // Offline copies cannot load the status/player views; the reader reads the saved copy.
        const href = offline ? `#/read/${book.id}` : book.state === 'ready' ? `#/listen/${book.id}` : `#/book/${book.id}`;
        return html`
          <li key=${book.id}>
            <a class="me-card" href=${href} aria-label=${book.title}>
              <${RecordSleeve} book=${book} />
              <span class="me-card-title">${book.title}</span>
            </a>
          </li>
        `;
      })}
    </ul>
  `;
}

function ShelfSection() {
  const [books, setBooks] = useState(/** @type {any[]|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    booksApi
      .list()
      .then((list) => setBooks(list.filter((b) => b.on_shelf)))
      .catch((err) => setError(isOfflineError(err) ? 'Đang ngoại tuyến — không xem được kệ.' : err.message));
  }, []);
  if (error) return html`<div class="banner banner-error" role="alert">${error}</div>`;
  if (!books) return html`<div class="skeleton" style=${{ height: '180px' }}></div>`;
  return html`
    <p class="note">Sách bạn giữ lại để nghe sau. Mỗi hồ sơ có kệ riêng.</p>
    <${BookGrid} books=${books} empty="Kệ chưa có sách. Khi nghe, mở ⋮ Tuỳ chọn và chọn “Thêm vào kệ”." />
  `;
}

function DownloadsSection() {
  const [books] = useState(() => listOfflineBooks().map((o) => ({ ...o.book, id: o.id })));
  return html`
    <p class="note">Nghe được khi không có mạng.</p>
    <${BookGrid} books=${books} offline empty="Chưa tải cuốn nào. Mở một cuốn và chọn tải để nghe offline." />
  `;
}

function QuotaSection() {
  const [usage, setUsage] = useState(/** @type {any|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setUsage(await usageApi.get());
    } catch (err) {
      setError(isOfflineError(err) ? 'Đang ngoại tuyến — không xem được hạn mức.' : err.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  return html`
    <div class="me-quota-head">
      <p class="note">Dùng chung cả nhà · đếm trong ứng dụng, lượt gọi từ nơi khác bằng cùng khóa API không được tính.</p>
      <button class="icon-btn" aria-label="Làm mới hạn mức" disabled=${loading} onClick=${load}><${Icon} name="refresh-cw" size=${20} /></button>
    </div>
    <div class="me-pad">
      ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
      ${!usage && !error && html`<div class="skeleton" style=${{ height: '140px' }}></div>`}
      ${usage && html`<${UsageMeterList} services=${usage.services} />`}
    </div>
  `;
}

/** Loads the full profile (stats, username); shared by the password and name screens. */
function useProfile() {
  const [profile, setProfile] = useState(/** @type {any|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  useEffect(() => {
    accountApi
      .profile()
      .then(setProfile)
      .catch((err) => setError(isOfflineError(err) ? 'Đang ngoại tuyến — không sửa được lúc này.' : err.message));
  }, []);
  return { profile, setProfile, error };
}

function PasswordSection() {
  const { profile, error } = useProfile();
  return html`
    <p class="note">Cả nhà dùng chung mật khẩu này. Đổi xong, mọi thiết bị khác phải đăng nhập lại.</p>
    <div class="me-pad">
      ${error && html`<div class="banner banner-info" role="status">${error}</div>`}
      ${profile && html`<${PasswordForm} username=${profile.username} />`}
    </div>
  `;
}

function NameSection() {
  const { profile, setProfile, error } = useProfile();
  return html`
    <div class="me-pad">
      ${error && html`<div class="banner banner-info" role="status">${error}</div>`}
      ${profile &&
      html`
        <p class="note me-flush">Tạo hồ sơ ${JOINED.format(new Date(profile.created_at))}</p>
        <dl class="account-stats">
          ${STAT_LABELS.map(([key, label]) => html`<div key=${key}><dt>${label}</dt><dd>${NUMBER.format(profile.stats[key])}</dd></div>`)}
        </dl>
        <${DisplayNameForm} user=${profile} onSaved=${(u) => setProfile({ ...profile, display_name: u.display_name })} />
      `}
      ${!profile && !error && html`<div class="skeleton" style=${{ height: '160px' }}></div>`}
    </div>
  `;
}

const THEME_OPTIONS = [
  ['light', 'Sáng'],
  ['auto', 'Theo máy'],
  ['dark', 'Tối'],
];

function ThemeSection() {
  const [theme, setCurrent] = useState(themeStore.get().theme);
  useEffect(() => themeStore.subscribe((s) => setCurrent(s.theme)), []);
  return html`
    <p class="note">Áp dụng cho thiết bị này.</p>
    <div class="seg" role="group" aria-label="Giao diện">
      ${THEME_OPTIONS.map(([value, label]) => html`<button key=${value} aria-pressed=${theme === value ? 'true' : 'false'} onClick=${() => setTheme(value)}>${label}</button>`)}
    </div>
  `;
}

const SECTIONS = {
  shelf: ShelfSection,
  downloads: DownloadsSection,
  quota: QuotaSection,
  password: PasswordSection,
  name: NameSection,
  theme: ThemeSection,
};

/** @param {{ section: string }} props */
export function MeSectionView({ section }) {
  const Body = SECTIONS[section];
  if (!Body || !authStore.get().user) {
    window.location.replace('#/me');
    return null;
  }
  return html`
    <div class="me">
      <header class="me-bar me-bar--back">
        <button class="icon-btn" aria-label="Quay lại" onClick=${goBack}><${Icon} name="chevron-left" size=${24} /></button>
        <h1>${TITLES[section]}</h1>
      </header>
      <${Body} />
    </div>
  `;
}
