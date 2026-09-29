// iOS-style pull-down menu that filters the library by topic. One 44px button in the toolbar;
// the list opens as a floating menu (role=menu, menuitemradio). Closes on scrim tap and Esc and
// hands focus back to the button. The parent must be `position: relative` (.lib-toolbar).
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

/**
 * @param {{ options: {key: string, label: string, count: number}[], value: string, onChange: (key: string) => void }} props
 * `value` is an option key; 'all' is the "every topic" option.
 */
export function TopicFilterMenu({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const menuRef = useRef(/** @type {HTMLElement|null} */ (null));
  const current = options.find((o) => o.key === value) || options[0];

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open || !menuRef.current) return undefined;
    // Land on the checked item so keyboard / screen-reader users start at the current choice.
    const items = /** @type {HTMLElement[]} */ ([...menuRef.current.querySelectorAll('[role="menuitemradio"]')]);
    (items.find((el) => el.getAttribute('aria-checked') === 'true') || items[0])?.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function choose(key) {
    onChange(key);
    close();
  }

  return html`
    <button ref=${buttonRef} class="menu-btn" aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'} onClick=${() => (open ? close() : setOpen(true))}>
      <span>${current ? current.label : 'Mọi chủ đề'}</span><${Icon} name="chevrons-up-down" size=${16} />
    </button>
    ${open && html`<div class="menu-scrim" onPointerDown=${(e) => { e.preventDefault(); close(false); }}></div>`}
    ${open &&
    html`
      <div class="menu" role="menu" aria-label="Lọc theo chủ đề" ref=${menuRef}>
        <div class="menu-heading" aria-hidden="true">Lọc theo chủ đề</div>
        ${options.map(
          (o) => html`
            <button class="menu-item" role="menuitemradio" aria-checked=${o.key === value ? 'true' : 'false'} key=${o.key} onClick=${() => choose(o.key)}>
              <${Icon} name="check" size=${18} /><span>${o.label}</span><small>${o.count}</small>
            </button>
          `,
        )}
      </div>
    `}
  `;
}
