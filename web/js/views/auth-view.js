// Đăng nhập / Đăng ký (§Implementation step 3). Errors render under the named field (err.field).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { authApi, ApiError } from '../api-client.js';
import { authStore, cacheUser } from '../store.js';
import { Icon } from '../icons.js';

const FIELD_LABEL = {
  username: 'Tên đăng nhập',
  display_name: 'Tên hiển thị',
  password: 'Mật khẩu',
  invite_code: 'Mã mời',
};

/** @param {{ onAuthed: () => void }} props */
export function AuthView({ onAuthed }) {
  const [tab, setTab] = useState('login');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState(/** @type {string|null} */ (null));
  const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [values, setValues] = useState({ username: '', display_name: '', password: '', invite_code: '' });

  function set(key, val) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function submit(ev) {
    ev.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setBusy(true);
    try {
      const user =
        tab === 'login'
          ? await authApi.login({ username: values.username.trim(), password: values.password })
          : await authApi.register({
              username: values.username.trim(),
              display_name: values.display_name.trim(),
              password: values.password,
              invite_code: values.invite_code.trim(),
            });
      cacheUser(user);
      authStore.set({ user, ready: true, offline: false });
      onAuthed();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.field) setFieldErrors({ [err.field]: err.message });
        else setFormError(err.message);
      } else {
        setFormError('Có lỗi xảy ra, thử lại sau.');
      }
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="auth-view">
      <div class="auth-logo">BookSnap</div>
      <p class="auth-tagline text-muted">Chụp trang sách, nghe lại bằng giọng đọc tiếng Việt</p>

      <div class="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="auth-tab"
          aria-selected=${String(tab === 'login')}
          onClick=${() => setTab('login')}
        >
          Đăng nhập
        </button>
        <button
          type="button"
          role="tab"
          class="auth-tab"
          aria-selected=${String(tab === 'register')}
          onClick=${() => setTab('register')}
        >
          Đăng ký
        </button>
      </div>

      ${formError && html`<div class="banner banner-error" role="alert">${formError}</div>`}

      <form onSubmit=${submit}>
        <div class="field">
          <label for="f-username">${FIELD_LABEL.username}</label>
          <input
            id="f-username"
            autocomplete="username"
            required
            value=${values.username}
            onInput=${(e) => set('username', e.currentTarget.value)}
          />
          ${fieldErrors.username && html`<div class="field-error">${fieldErrors.username}</div>`}
        </div>

        ${tab === 'register' &&
        html`
          <div class="field">
            <label for="f-display-name">${FIELD_LABEL.display_name}</label>
            <input
              id="f-display-name"
              autocomplete="name"
              required
              value=${values.display_name}
              onInput=${(e) => set('display_name', e.currentTarget.value)}
            />
            ${fieldErrors.display_name && html`<div class="field-error">${fieldErrors.display_name}</div>`}
          </div>
        `}

        <div class="field">
          <label for="f-password">${FIELD_LABEL.password}</label>
          <div class="field-password-toggle">
            <input
              id="f-password"
              type=${showPassword ? 'text' : 'password'}
              autocomplete=${tab === 'login' ? 'current-password' : 'new-password'}
              required
              value=${values.password}
              onInput=${(e) => set('password', e.currentTarget.value)}
            />
            <button
              type="button"
              class="icon-btn"
              aria-label=${showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              onClick=${() => setShowPassword((s) => !s)}
            >
              <${Icon} name=${showPassword ? 'eye-off' : 'eye'} />
            </button>
          </div>
          ${fieldErrors.password && html`<div class="field-error">${fieldErrors.password}</div>`}
        </div>

        ${tab === 'register' &&
        html`
          <div class="field">
            <label for="f-invite">${FIELD_LABEL.invite_code}</label>
            <input id="f-invite" required value=${values.invite_code} onInput=${(e) => set('invite_code', e.currentTarget.value)} />
            ${fieldErrors.invite_code && html`<div class="field-error">${fieldErrors.invite_code}</div>`}
          </div>
        `}

        <button type="submit" class="btn btn-primary btn-block" disabled=${busy}>
          ${busy ? 'Đang xử lý…' : tab === 'login' ? 'Đăng nhập' : 'Đăng ký'}
        </button>
      </form>
    </div>
  `;
}
