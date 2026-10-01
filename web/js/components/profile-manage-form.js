// Add or edit one profile: name + colour; deleting asks for the family password because it can't be
// undone (progress, bookmarks and shelf go; the profile's books pass to the oldest profile).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { profilesApi } from '../api-client.js';
import { AVATAR_KEYS } from '../profile-avatar-style.js';
import { ProfileAvatar } from './profile-avatar.js';

// Mirrors app/auth/auth_routes.py DISPLAY_NAME_MAX.
const DISPLAY_NAME_MAX = 40;

/**
 * @param {{ profile: {id:string, display_name:string, avatar:string}|null, defaultAvatar: string,
 *   isCurrent: boolean, onDone: () => void, onCancel: () => void }} props
 *   profile null = create a new one.
 */
export function ProfileManageForm({ profile, defaultAvatar, isCurrent, onDone, onCancel }) {
  const [name, setName] = useState(profile ? profile.display_name : '');
  const [avatar, setAvatar] = useState(profile ? profile.avatar : defaultAvatar);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const trimmed = name.trim();

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err.message || 'Có lỗi xảy ra, thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  function save(ev) {
    ev.preventDefault();
    if (!trimmed) return;
    run(() =>
      profile ? profilesApi.update(profile.id, { display_name: trimmed, avatar }) : profilesApi.create({ display_name: trimmed, avatar }),
    );
  }

  function remove() {
    if (!profile || !password) return;
    if (!window.confirm(`Xoá hồ sơ “${profile.display_name}”? Tiến độ nghe, đánh dấu và kệ của hồ sơ này sẽ mất.`)) return;
    run(() => profilesApi.remove(profile.id, password));
  }

  return html`
    <form class="profile-form" onSubmit=${save} novalidate>
      <div class="profile-form-preview"><${ProfileAvatar} name=${trimmed || '?'} avatar=${avatar} large /></div>
      ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
      <div class="field">
        <label for="profile-name">Tên hồ sơ</label>
        <input id="profile-name" required maxlength=${DISPLAY_NAME_MAX} autocomplete="off" autocapitalize="words" value=${name} onInput=${(e) => setName(e.currentTarget.value)} />
      </div>
      <fieldset class="profile-swatches">
        <legend>Màu</legend>
        ${AVATAR_KEYS.map(
          (key, i) => html`
            <label class="profile-swatch" key=${key}>
              <input type="radio" name="profile-avatar" value=${key} checked=${avatar === key} aria-label=${`Màu ${i + 1}`} onChange=${() => setAvatar(key)} />
              <${ProfileAvatar} name="" avatar=${key} />
            </label>
          `,
        )}
      </fieldset>
      <div class="profile-form-buttons">
        <button type="button" class="btn btn-secondary" onClick=${onCancel} disabled=${busy}>Huỷ</button>
        <button type="submit" class="btn btn-primary" disabled=${busy || !trimmed}>${profile ? 'Lưu' : 'Thêm hồ sơ'}</button>
      </div>

      ${profile && !isCurrent &&
      html`
        <section class="profile-danger" aria-labelledby="profile-danger-title">
          <h2 id="profile-danger-title">Xoá hồ sơ</h2>
          <p>Mất tiến độ nghe, đánh dấu và kệ của hồ sơ này. Sách hồ sơ này đã chụp chuyển cho hồ sơ tạo đầu tiên.</p>
          <div class="field">
            <label for="profile-delete-password">Mật khẩu gia đình</label>
            <input id="profile-delete-password" type="password" autocomplete="current-password" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} />
          </div>
          <button type="button" class="btn btn-danger btn-block" disabled=${busy || !password} onClick=${remove}>Xoá hồ sơ</button>
        </section>
      `}
      ${profile && isCurrent && html`<p class="account-hint">Đang dùng hồ sơ này nên không xoá được — đổi sang hồ sơ khác trước.</p>`}
    </form>
  `;
}
