// Profile forms on the account screen: display name, and password change (signs out other devices).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { accountApi } from '../api-client.js';
import { authStore, cacheUser } from '../store.js';

// Limits mirror app/auth/auth_routes.py (DISPLAY_NAME_MAX, PASSWORD_MIN/MAX).
const DISPLAY_NAME_MAX = 40;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

export function DisplayNameForm({ user, onSaved }) {
  const [value, setValue] = useState(user.display_name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(/** @type {{kind:'ok'|'error', text:string}|null} */ (null));
  const trimmed = value.trim();
  const unchanged = trimmed === user.display_name;

  async function submit(ev) {
    ev.preventDefault();
    if (busy || unchanged || !trimmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const updated = await accountApi.update({ display_name: trimmed });
      cacheUser(updated);
      authStore.set({ user: updated });
      onSaved(updated);
      setValue(updated.display_name);
      setMessage({ kind: 'ok', text: 'Đã lưu tên hiển thị.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err.message || 'Không lưu được, thử lại sau.' });
    } finally {
      setBusy(false);
    }
  }

  return html`
    <form class="card account-form" onSubmit=${submit}>
      <h2 class="section-heading">Tên hiển thị</h2>
      <div class="field">
        <label for="acc-display-name">Tên mọi người thấy</label>
        <input id="acc-display-name" autocomplete="nickname" maxlength=${DISPLAY_NAME_MAX} required value=${value} onInput=${(e) => setValue(e.currentTarget.value)} />
      </div>
      ${message && html`<p class=${message.kind === 'ok' ? 'account-ok' : 'field-error'} role="status">${message.text}</p>`}
      <button class="btn btn-secondary" type="submit" disabled=${busy || unchanged || !trimmed}>${busy ? 'Đang lưu…' : 'Lưu tên'}</button>
    </form>
  `;
}

export function PasswordForm({ username }) {
  const empty = { current_password: '', new_password: '', confirm: '' };
  const [values, setValues] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {{field:string|null, text:string}|null} */ (null));
  const [done, setDone] = useState(/** @type {string|null} */ (null));
  const set = (key) => (e) => setValues({ ...values, [key]: e.currentTarget.value });

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    setError(null);
    setDone(null);
    if (values.new_password !== values.confirm) {
      setError({ field: 'confirm', text: 'Hai lần nhập mật khẩu mới không khớp' });
      return;
    }
    setBusy(true);
    try {
      const { other_sessions_revoked: revoked } = await accountApi.changePassword({
        current_password: values.current_password,
        new_password: values.new_password,
      });
      setValues(empty);
      setDone(revoked > 0 ? `Đã đổi mật khẩu và đăng xuất ${revoked} thiết bị khác.` : 'Đã đổi mật khẩu.');
    } catch (err) {
      setError({ field: err.field || null, text: err.message || 'Không đổi được mật khẩu, thử lại sau.' });
    } finally {
      setBusy(false);
    }
  }

  const row = (key, id, label, autocomplete) => html`
    <div class="field">
      <label for=${id}>${label}</label>
      <input
        id=${id}
        type="password"
        autocomplete=${autocomplete}
        required
        minlength=${key === 'current_password' ? null : PASSWORD_MIN}
        maxlength=${PASSWORD_MAX}
        value=${values[key]}
        onInput=${set(key)}
        aria-invalid=${error?.field === key ? 'true' : null}
      />
      ${error?.field === key && html`<p class="field-error" role="alert">${error.text}</p>`}
    </div>
  `;

  return html`
    <form class="card account-form" onSubmit=${submit}>
      <h2 class="section-heading">Đổi mật khẩu</h2>
      <input type="text" autocomplete="username" value=${username} hidden readonly />
      ${row('current_password', 'acc-pw-current', 'Mật khẩu hiện tại', 'current-password')}
      ${row('new_password', 'acc-pw-new', 'Mật khẩu mới', 'new-password')}
      ${row('confirm', 'acc-pw-confirm', 'Nhập lại mật khẩu mới', 'new-password')}
      ${error && !['current_password', 'new_password', 'confirm'].includes(error.field) && html`<p class="field-error" role="alert">${error.text}</p>`}
      ${done && html`<p class="account-ok" role="status">${done}</p>`}
      <p class="account-hint">Các thiết bị khác sẽ bị đăng xuất; thiết bị này vẫn đăng nhập.</p>
      <button class="btn btn-secondary" type="submit" disabled=${busy}>${busy ? 'Đang đổi…' : 'Đổi mật khẩu'}</button>
    </form>
  `;
}
