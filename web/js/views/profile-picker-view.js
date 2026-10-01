// "Ai đang nghe?": pick the profile this device listens as, add one, or manage them (rename,
// recolour, delete). Only calls family-wide endpoints, so it works before a profile is picked.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { profilesApi } from '../api-client.js';
import { AVATAR_KEYS } from '../profile-avatar-style.js';
import { authStore, cacheUser, hasUnsavedWork } from '../store.js';
import { signOut } from '../sign-out.js';
import { ProfileAvatar } from '../components/profile-avatar.js';
import { ProfileManageForm } from '../components/profile-manage-form.js';

// Mirrors app/api/profiles_routes.py MAX_PROFILES.
const MAX_PROFILES = 8;

/**
 * @param {{ currentUser: {id:string}|null, overlay?: boolean, onPicked: (me: any) => void, onBack?: (() => void)|null }} props
 *   currentUser: the profile in use (highlighted, cannot be deleted); onBack: offered when switching
 *   voluntarily, absent when the device must pick (deleted elsewhere, fresh login).
 */
export function ProfilePickerView({ currentUser, overlay = false, onPicked, onBack = null }) {
  const [profiles, setProfiles] = useState(/** @type {any[]|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState(/** @type {any|'new'|null} */ (null));
  const [busyId, setBusyId] = useState(/** @type {string|null} */ (null));
  const headingRef = useRef(/** @type {HTMLHeadingElement|null} */ (null));
  // Deleting needs a picked profile (the server must know who is deleting): only offered when the
  // device is on a valid profile, i.e. not on the forced picker / overlay.
  const canDelete = Boolean(currentUser) && !overlay;

  useEffect(() => {
    // An overlay appears unasked: move focus (and screen readers) to it.
    if (overlay) headingRef.current?.focus({ preventScroll: true });
  }, [overlay, editing === null]);

  async function load() {
    setError(null);
    try {
      setProfiles(await profilesApi.list());
    } catch (err) {
      setError(err.status === 0 || err.status === 503 ? 'Đang ngoại tuyến — cần mạng để chọn hồ sơ.' : err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function pick(profile) {
    if (managing) {
      setEditing(profile);
      return;
    }
    if (busyId) return;
    setBusyId(profile.id);
    setError(null);
    try {
      onPicked(await profilesApi.select(profile.id));
    } catch (err) {
      setError(err.message || 'Không chọn được hồ sơ, thử lại.');
      load();
    } finally {
      setBusyId(null);
    }
  }

  /** @param {any} [updated] the saved profile (create/update), absent after a delete */
  function doneEditing(updated) {
    // Renaming/recolouring the profile in use: refresh the header avatar and cached identity.
    if (updated && currentUser && updated.id === currentUser.id) {
      const me = { ...authStore.get().user, display_name: updated.display_name, avatar: updated.avatar };
      cacheUser(me);
      authStore.set({ user: me });
    }
    setEditing(null);
    load();
  }

  function leaveFamily() {
    if (hasUnsavedWork() && !window.confirm('Còn trang chụp chưa tải xong sẽ bị mất nếu đăng xuất. Vẫn đăng xuất?')) return;
    signOut();
  }

  const list = profiles || [];
  const shellClass = `profiles ${overlay ? 'profiles-overlay' : ''} ${managing ? 'profiles-manage' : ''}`;

  if (editing) {
    const isNew = editing === 'new';
    return html`
      <div class=${shellClass} role=${overlay ? 'dialog' : null} aria-modal=${overlay ? 'true' : null} aria-labelledby="profiles-edit-title">
        <header class="profiles-head">
          <p class="eyebrow">Quản lý hồ sơ</p>
          <h1 id="profiles-edit-title" ref=${headingRef} tabindex="-1">${isNew ? 'Thêm hồ sơ' : 'Sửa hồ sơ'}</h1>
        </header>
        <${ProfileManageForm}
          profile=${isNew ? null : editing}
          defaultAvatar=${AVATAR_KEYS[list.length % AVATAR_KEYS.length]}
          isCurrent=${!isNew && currentUser?.id === editing.id}
          canDelete=${canDelete}
          onDone=${doneEditing}
          onCancel=${() => setEditing(null)}
        />
      </div>
    `;
  }

  return html`
    <div class=${shellClass} role=${overlay ? 'dialog' : null} aria-modal=${overlay ? 'true' : null} aria-labelledby="profiles-title">
      <header class="profiles-head">
        <p class="eyebrow">BookSnap · Thư phòng gia đình</p>
        <h1 id="profiles-title" ref=${headingRef} tabindex="-1">${managing ? 'Quản lý hồ sơ' : 'Ai đang nghe?'}</h1>
        <p>${managing ? 'Chạm vào hồ sơ để đổi tên, màu hoặc xoá.' : 'Mỗi người có tiến độ, đánh dấu và kệ sách riêng.'}</p>
      </header>
      ${overlay &&
      html`<div class="banner banner-info" role="status">Hồ sơ vừa được đổi hoặc xoá ở nơi khác — chọn hồ sơ để tiếp tục. Các trang đã chụp vẫn được giữ và sẽ tải tiếp.</div>`}

      ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
      ${profiles === null && !error && html`<div class="skeleton" style=${{ width: 'min(100%, 300px)', height: '140px', marginTop: '28px' }}></div>`}

      ${profiles !== null &&
      html`
        <ul class="profiles-grid">
          ${list.map(
            (p) => html`
              <li key=${p.id}>
                <button
                  class="profile-tile"
                  aria-current=${currentUser?.id === p.id ? 'true' : null}
                  aria-label=${managing ? `Sửa hồ sơ ${p.display_name}` : `Nghe với hồ sơ ${p.display_name}`}
                  disabled=${busyId !== null}
                  aria-busy=${busyId === p.id ? 'true' : null}
                  onClick=${() => pick(p)}
                >
                  <${ProfileAvatar} name=${p.display_name} avatar=${p.avatar} large />
                  <span class="profile-tile-name">${p.display_name}</span>
                  ${managing && html`<span class="profile-tile-note">Sửa</span>`}
                </button>
              </li>
            `,
          )}
          ${list.length < MAX_PROFILES &&
          html`
            <li>
              <button class="profile-tile profile-tile--add" onClick=${() => setEditing('new')}>
                <span class="profile-add-icon" aria-hidden="true">+</span>
                <span class="profile-tile-name">Thêm hồ sơ</span>
              </button>
            </li>
          `}
        </ul>
      `}

      <div class="profiles-actions">
        ${profiles !== null && list.length > 0 &&
        html`<button class="btn btn-secondary" onClick=${() => setManaging(!managing)}>${managing ? 'Xong' : 'Quản lý hồ sơ'}</button>`}
        ${onBack && !managing && html`<button class="btn btn-ghost" onClick=${onBack}>Quay lại</button>`}
      </div>
      <button class="profiles-signout" onClick=${leaveFamily}>Đăng xuất tài khoản gia đình</button>
    </div>
  `;
}
