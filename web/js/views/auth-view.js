// Sign-in to the family account (sign-up only until it exists), laid out for one-handed iPhone use:
// brand art on top, form in the thumb zone.
// Errors render under the named field (err.field); anything else uses the banner.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { authApi, ApiError } from '../api-client.js';
import { authStore, cacheUser, safeLocalStorage } from '../store.js';
import { Icon } from '../icons.js';
import { RecordSleeve } from '../components/record-sleeve.js';
import { VinylDisc } from '../components/vinyl-disc.js';
import { readRegistrationOpen, writeRegistrationOpen } from '../registration-status-cache.js';

// Limits mirror app/auth/auth_routes.py (USERNAME_RE, PASSWORD_MIN/MAX, DISPLAY_NAME_MAX).
const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;
const DISPLAY_NAME_MAX = 40;

// The id only picks the leather colour (hashes to the 'wine' palette).
const BRAND_BOOK = { id: 'brand', title: 'BookSnap' };
const ERROR_ID = 'signin-error';

const FIELD_LABEL = {
  username: 'Tên đăng nhập',
  display_name: 'Tên hồ sơ của bạn',
  password: 'Mật khẩu',
  invite_code: 'Mã mời',
};

const FOOT_HINT = {
  login: 'Cả nhà dùng chung một tài khoản. Quên mật khẩu? Nhờ người quản lý thư viện đặt lại.',
  register: 'Tạo tài khoản gia đình một lần, sau đó mỗi người thêm hồ sơ riêng. Mã mời do người quản lý thư viện cung cấp.',
};

/** One labelled row; `extra` is rendered after the input (eye toggle). */
function Row({ name, id, value, onValue, invalid, extra, ...inputProps }) {
  return html`
    <div class="signin-row" data-error=${invalid ? '' : null}>
      <label for=${id}>${FIELD_LABEL[name]}</label>
      <input
        id=${id}
        name=${name}
        required
        value=${value}
        onInput=${(e) => onValue(name, e.currentTarget.value)}
        aria-invalid=${invalid ? 'true' : null}
        aria-describedby=${invalid ? ERROR_ID : null}
        ...${inputProps}
      />
      ${extra}
    </div>
  `;
}

/** @param {{ onAuthed: () => void }} props */
export function AuthView({ onAuthed }) {
  const [tab, setTab] = useState('login');
  const [busy, setBusy] = useState(false);
  // Hero collapses while a field is focused (room above the iOS keyboard). It re-expands only after a
  // short delay: Safari never focuses a tapped button, so expanding on blur moved "Đăng nhập" 300px
  // down under the finger and the tap was lost.
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(/** @type {any} */ (0));
  const onFocusIn = (e) => {
    if (e.target instanceof HTMLInputElement) {
      clearTimeout(typingTimer.current);
      setTyping(true);
    }
  };
  const onFocusOut = () => {
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      if (!(document.activeElement instanceof HTMLInputElement)) setTyping(false);
    }, 350);
  };
  useEffect(() => () => clearTimeout(typingTimer.current), []);
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState(/** @type {string|null} */ (null));
  const [fieldErrors, setFieldErrors] = useState(/** @type {Record<string,string>} */ ({}));
  const [values, setValues] = useState({ username: '', display_name: '', password: '', invite_code: '' });
  // Seeded from the last known answer so the layout is final on first paint; null = never seen.
  const [registrationOpen, setRegistrationOpen] = useState(() => readRegistrationOpen(safeLocalStorage()));

  useEffect(() => {
    let alive = true;
    authApi
      .status()
      .then((s) => {
        if (!alive) return;
        const open = Boolean(s.registration_open);
        writeRegistrationOpen(safeLocalStorage(), open);
        setRegistrationOpen((prev) => (prev === open ? prev : open));
        // Tapped "Tạo tài khoản" from a stale cache, then the server said closed: back to login,
        // otherwise the register form would stay with no tabs to leave it.
        if (!open) setTab('login');
      })
      // Keep a cached answer on failure; only fall back to "closed" when nothing is known.
      .catch(() => alive && setRegistrationOpen((prev) => (prev === null ? false : prev)));
    return () => {
      alive = false;
    };
  }, []);

  const isLogin = tab === 'login';
  const errorField = Object.keys(fieldErrors)[0];
  const errorMessage = errorField ? fieldErrors[errorField] : null;

  function set(key, val) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function switchTab(next) {
    if (next === tab) return;
    setTab(next);
    setFormError(null);
    setFieldErrors({});
  }

  async function submit(ev) {
    ev.preventDefault();
    if (busy) return;
    setFormError(null);
    setFieldErrors({});
    setBusy(true);
    // Drop the keyboard so the hero expands back while the record spins.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    try {
      const res = isLogin
        ? await authApi.login({ username: values.username.trim(), password: values.password })
        : await authApi.register({
            username: values.username.trim(),
            display_name: values.display_name.trim(),
            password: values.password,
            invite_code: values.invite_code.trim(),
          });
      if (res.profile_required) {
        // Several profiles: the app shows "Ai đang nghe?" next.
        authStore.set({ user: null, needsProfile: true, ready: true, offline: false });
      } else {
        const me = { id: res.id, username: res.username, display_name: res.display_name, avatar: res.avatar };
        cacheUser(me);
        authStore.set({ user: me, needsProfile: false, ready: true, offline: false });
      }
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

  const eyeButton = html`
    <button
      type="button"
      class="icon-btn"
      aria-label=${showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      aria-pressed=${String(showPassword)}
      onClick=${() => setShowPassword((s) => !s)}
    >
      <${Icon} name=${showPassword ? 'eye-off' : 'eye'} size=${22} />
    </button>
  `;

  const row = (name) => ({ name, value: values[name], onValue: set, invalid: errorField === name });

  return html`
    <div class=${`signin ${busy ? 'is-busy' : ''} ${typing ? 'is-typing' : ''}`} onFocusIn=${onFocusIn} onFocusOut=${onFocusOut}>
      <div class="signin-hero">
        <div class="signin-art" aria-hidden="true">
          <${VinylDisc} book=${BRAND_BOOK} spinning=${busy} />
          <${RecordSleeve} book=${BRAND_BOOK} />
        </div>
        <div class="signin-brand">
          <h1>BookSnap</h1>
          <div class="fleuron-rule" aria-hidden="true"><i></i></div>
          <p>Chụp trang sách, nghe lại bằng giọng đọc tiếng Việt</p>
        </div>
      </div>

      ${/* While status is unknown (no cache) the control is rendered invisibly: same box, same height,
          so the form never moves when the answer is "open"; it then just fades in. Only a first-ever
          visit that turns out closed collapses the gap. */ ''}
      ${/* Tabs switch on pointerdown: a focus change re-lays out the hero and could move the tab
         before the click lands. onClick keeps keyboard activation; repeats are no-ops. */ ''}
      ${registrationOpen !== false &&
      html`<div
        class=${`signin-segmented ${registrationOpen === null ? 'is-pending' : ''}`}
        data-value=${tab}
        role="tablist"
        aria-hidden=${registrationOpen === null ? 'true' : null}
        aria-label="Chọn đăng nhập hoặc đăng ký"
      >
        <button type="button" role="tab" aria-selected=${String(isLogin)} onPointerDown=${() => switchTab('login')} onClick=${() => switchTab('login')}>Đăng nhập</button>
        <button type="button" role="tab" aria-selected=${String(!isLogin)} onPointerDown=${() => switchTab('register')} onClick=${() => switchTab('register')}>Tạo tài khoản gia đình</button>
      </div>`}

      ${formError && html`<div class="banner banner-error signin-banner" role="alert">${formError}</div>`}

      <form onSubmit=${submit} novalidate>
        <div class="signin-group">
          <${Row}
            ...${row('username')}
            id="signin-username"
            autocomplete="username"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="next"
            minlength=${USERNAME_MIN}
            maxlength=${USERNAME_MAX}
          />
          ${!isLogin &&
          html`<${Row}
            ...${row('display_name')}
            id="signin-display-name"
            autocomplete="name"
            autocapitalize="words"
            enterkeyhint="next"
            maxlength=${DISPLAY_NAME_MAX}
          />`}
          <${Row}
            ...${row('password')}
            id="signin-password"
            type=${showPassword ? 'text' : 'password'}
            autocomplete=${isLogin ? 'current-password' : 'new-password'}
            passwordrules=${isLogin ? null : `minlength: ${PASSWORD_MIN}; maxlength: ${PASSWORD_MAX};`}
            minlength=${isLogin ? null : PASSWORD_MIN}
            maxlength=${PASSWORD_MAX}
            enterkeyhint=${isLogin ? 'go' : 'next'}
            extra=${eyeButton}
          />
          ${!isLogin &&
          html`<${Row}
            ...${row('invite_code')}
            id="signin-invite"
            placeholder="Hỏi người quản lý thư viện"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="go"
          />`}
        </div>

        ${errorMessage &&
        html`<p class="signin-error" id=${ERROR_ID} role="alert"><${Icon} name="alert-circle" size=${16} /><span>${errorMessage}</span></p>`}

        <button type="submit" class="btn btn-primary signin-submit" disabled=${busy} aria-busy=${busy ? 'true' : null}>
          ${busy ? 'Đang mở thư viện…' : isLogin ? 'Đăng nhập' : 'Tạo tài khoản'}
        </button>
        <p class="signin-foot">${FOOT_HINT[tab]}</p>
      </form>
    </div>
  `;
}
