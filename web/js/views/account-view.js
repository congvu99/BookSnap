// Thông tin cá nhân: identity + personal stats, shared provider quota, display name, password.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { accountApi, usageApi } from '../api-client.js';
import { authStore } from '../store.js';
import { signOut } from '../sign-out.js';
import { UsageMeterList } from '../components/usage-meter-list.js';
import { DisplayNameForm, PasswordForm } from '../components/account-profile-forms.js';
import { Icon } from '../icons.js';

const JOINED = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

const STAT_LABELS = [
  ['books_created', 'Sách đã tạo'],
  ['pages_captured', 'Trang đã chụp'],
  ['books_listening', 'Sách đang nghe'],
  ['bookmarks', 'Đoạn đánh dấu'],
];

const isOfflineError = (err) => err.status === 0 || err.status === 503;

export function AccountView() {
  const user = authStore.get().user;
  const [profile, setProfile] = useState(/** @type {any|null} */ (null));
  const [usage, setUsage] = useState(/** @type {any|null} */ (null));
  const [profileError, setProfileError] = useState(/** @type {string|null} */ (null));
  const [usageError, setUsageError] = useState(/** @type {string|null} */ (null));
  const [usageLoading, setUsageLoading] = useState(false);

  async function loadUsage() {
    setUsageLoading(true);
    setUsageError(null);
    try {
      setUsage(await usageApi.get());
    } catch (err) {
      setUsageError(isOfflineError(err) ? 'Đang ngoại tuyến — không xem được hạn mức.' : err.message);
    } finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => {
    accountApi
      .profile()
      .then(setProfile)
      .catch((err) => setProfileError(isOfflineError(err) ? 'Đang ngoại tuyến — hiện thông tin đã lưu trên máy.' : err.message));
    loadUsage();
  }, []);

  if (!user) return null;
  const shown = profile || user;
  const initial = (shown.display_name || '?').trim().charAt(0).toUpperCase() || '?';

  return html`
    <div>
      <header class="account-header">
        <p class="account-eyebrow">Tài khoản</p>
        <h1 class="account-title">Thông tin cá nhân</h1>
      </header>
      <div class="fleuron-rule header-rule" aria-hidden="true"><i></i></div>
      <div class="container account-body">
        ${profileError && html`<div class="banner banner-info" role="status">${profileError}</div>`}

        <section class="card account-identity" aria-label="Hồ sơ">
          <span class="avatar account-avatar" aria-hidden="true">${initial}</span>
          <div class="account-identity-text">
            <h2>${shown.display_name}</h2>
            <p>@${shown.username}${profile ? ` · Tham gia ${JOINED.format(new Date(profile.created_at))}` : ''}</p>
          </div>
        </section>

        ${profile &&
        html`
          <dl class="account-stats">
            ${STAT_LABELS.map(
              ([key, label]) => html`<div key=${key}><dt>${label}</dt><dd>${new Intl.NumberFormat('vi-VN').format(profile.stats[key])}</dd></div>`
            )}
          </dl>
        `}

        <section class="account-usage" aria-labelledby="acc-usage-title">
          <div class="account-usage-head">
            <div>
              <h2 id="acc-usage-title" class="section-heading">Hạn mức dịch vụ</h2>
              <p class="account-hint">Dùng chung cả nhà · đếm trong ứng dụng, lượt gọi từ nơi khác bằng cùng khóa API không được tính.</p>
            </div>
            <button class="icon-btn" aria-label="Làm mới hạn mức" disabled=${usageLoading} onClick=${loadUsage}><${Icon} name="refresh-cw" size=${20} /></button>
          </div>
          ${usageError && html`<div class="banner banner-error" role="alert">${usageError}</div>`}
          ${!usage && !usageError && html`<div class="skeleton" style=${{ height: '140px' }}></div>`}
          ${usage && html`<${UsageMeterList} services=${usage.services} />`}
        </section>

        ${profile && html`<${DisplayNameForm} user=${profile} onSaved=${(u) => setProfile({ ...profile, display_name: u.display_name })} />`}
        ${profile && html`<${PasswordForm} username=${profile.username} />`}

        <button class="btn btn-danger btn-block account-signout" onClick=${signOut}><${Icon} name="log-out" size=${18} /> Đăng xuất</button>
      </div>
    </div>
  `;
}
