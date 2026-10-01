// Header avatar of the current profile that opens a small menu: profile name, "Đổi hồ sơ",
// "Thông tin cá nhân", "Đăng xuất".
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { ProfileAvatar } from './profile-avatar.js';

/** @param {{ name: string, avatar?: string|null, onLogout: () => void }} props */
export function LibraryAccountMenu({ name, avatar, onLogout }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const firstItemRef = useRef(/** @type {HTMLAnchorElement|null} */ (null));

  useEffect(() => {
    if (!open) return undefined;
    firstItemRef.current?.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return html`
    <div class="account">
      <button ref=${buttonRef} class="avatar avatar--profile" aria-label=${`Hồ sơ ${name}`} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}><${ProfileAvatar} name=${name} avatar=${avatar} /></button>
      ${open && html`<div class="menu-scrim" onPointerDown=${(e) => { e.preventDefault(); setOpen(false); }}></div>`}
      ${open &&
      html`
        <div class="menu account-menu" role="menu" aria-label="Tài khoản">
          <div class="menu-heading" aria-hidden="true">${name}</div>
          <a ref=${firstItemRef} class="menu-item menu-item--action" role="menuitem" href="#/profiles" onClick=${() => setOpen(false)}><${Icon} name="refresh-cw" size=${18} /><span>Đổi hồ sơ</span></a>
          <a class="menu-item menu-item--action" role="menuitem" href="#/account" onClick=${() => setOpen(false)}><${Icon} name="user" size=${18} /><span>Thông tin cá nhân</span></a>
          <button class="menu-item menu-item--action menu-item--signout" role="menuitem" onClick=${onLogout}><${Icon} name="log-out" size=${18} /><span>Đăng xuất</span></button>
        </div>
      `}
    </div>
  `;
}
