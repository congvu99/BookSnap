// Header avatar (initial letter) that opens a small menu with the account name and "Đăng xuất".
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

/** @param {{ name: string, onLogout: () => void }} props */
export function LibraryAccountMenu({ name, onLogout }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const logoutRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';

  useEffect(() => {
    if (!open) return undefined;
    logoutRef.current?.focus({ preventScroll: true });
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
      <button ref=${buttonRef} class="avatar" aria-label=${`Tài khoản ${name}`} aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>${initial}</button>
      ${open && html`<div class="menu-scrim" onPointerDown=${(e) => { e.preventDefault(); setOpen(false); }}></div>`}
      ${open &&
      html`
        <div class="menu account-menu" role="menu" aria-label="Tài khoản">
          <div class="menu-heading" aria-hidden="true">${name}</div>
          <button ref=${logoutRef} class="menu-item menu-item--action" role="menuitem" onClick=${onLogout}><${Icon} name="log-out" size=${18} /><span>Đăng xuất</span></button>
        </div>
      `}
    </div>
  `;
}
