// "Đổi hồ sơ" bottom sheet: switch the listening profile without leaving the screen. Mounted once in
// the app shell; opened via openProfileSwitcher() from any avatar button.
import { html, useCallback, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { profilesApi } from '../api-client.js';
import { authStore, cacheUser, hasUnsavedWork } from '../store.js';
import { closeProfileSwitcher, getProfileSwitcherState, onProfileSwitcherChange } from '../profile-switcher.js';
import { flyAvatarToCentre } from '../profile-zoom.js';
import { ProfileAvatar } from './profile-avatar.js';

const CLOSE_MS = 380;
/** Last list seen: lets the sheet open instantly; refreshed in the background on every open. */
let cachedProfiles = /** @type {any[]|null} */ (null);

export function ProfileSwitchSheet() {
  const [sw, setSw] = useState(getProfileSwitcherState());
  const [mounted, setMounted] = useState(sw.open); // in the DOM (stays through the close transition)
  const [shown, setShown] = useState(false); // .open class → slide-up / scrim fade
  const [profiles, setProfiles] = useState(cachedProfiles);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const lastFromEl = useRef(/** @type {Element|null} */ (null));
  const [user, setUser] = useState(authStore.get().user);

  useEffect(() => onProfileSwitcherChange(setSw), []);
  // Unmounted on sign-out / lost session: forget this family's profiles and never reopen over login.
  useEffect(() => () => {
    cachedProfiles = null;
    closeProfileSwitcher();
  }, []);
  useEffect(() => authStore.subscribe((s) => setUser(s.user)), []);

  // Open: mount, then flip to .open on the next frames so the transition runs. Close: reverse.
  useEffect(() => {
    if (sw.open) {
      lastFromEl.current = sw.fromEl;
      setError(null);
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      profilesApi
        .list()
        .then((list) => {
          cachedProfiles = list;
          setProfiles(list);
        })
        .catch((err) => {
          if (!cachedProfiles) setError(err.status === 0 || err.status === 503 ? 'Đang ngoại tuyến — cần mạng để đổi hồ sơ.' : err.message);
        });
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [sw.open]);

  // Focus the first profile once visible; hand focus back to the opener when closed.
  useEffect(() => {
    if (shown) sheetRef.current?.querySelector('button')?.focus({ preventScroll: true });
  }, [shown, profiles]);
  useEffect(() => {
    if (!sw.open && lastFromEl.current && document.contains(lastFromEl.current)) {
      /** @type {HTMLElement} */ (lastFromEl.current).focus?.({ preventScroll: true });
    }
  }, [sw.open]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!busy) closeProfileSwitcher();
      return;
    }
    if (e.key !== 'Tab' || !sheetRef.current) return;
    const items = [...sheetRef.current.querySelectorAll('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [busy]);

  async function pick(profile, avatarEl) {
    if (busy) return;
    if (user?.id === profile.id) {
      closeProfileSwitcher();
      return;
    }
    setBusy(true);
    setError(null);
    // Select and fly together; the swap happens only once both finished (screen is covered).
    const flight = flyAvatarToCentre(avatarEl, profile);
    let reveal = async () => {};
    try {
      const [me, revealFn] = await Promise.all([profilesApi.select(profile.id), flight]);
      reveal = revealFn;
      cacheUser(me);
      authStore.set({ user: me, needsProfile: false });
      closeProfileSwitcher();
      // Unsent capture pages live in the current view: switch identity but stay put.
      if (!hasUnsavedWork()) window.location.hash = '#/library';
    } catch (err) {
      setError(err.message || 'Không đổi được hồ sơ, thử lại.');
      reveal = await flight.catch(() => reveal); // flight outlives a failed select: fade it away
    } finally {
      setBusy(false);
      reveal();
    }
  }

  if (!mounted) return null;
  const list = profiles || [];
  return html`
    <div class="switch-layer" onKeyDown=${onKeyDown}>
      <div class=${`switch-scrim ${shown ? 'open' : ''}`} onClick=${() => !busy && closeProfileSwitcher()}></div>
      <div ref=${sheetRef} class=${`switch-sheet ${shown ? 'open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="switch-title">
        <div class="switch-grab" aria-hidden="true"></div>
        <h2 id="switch-title">Đổi hồ sơ</h2>
        ${error && html`<p class="switch-error" role="alert">${error}</p>`}
        ${profiles === null && !error && html`<div class="skeleton" style=${{ width: '70%', height: '96px', margin: '0 auto' }}></div>`}
        <div class="switch-profiles">
          ${list.map((p) => {
            const current = user?.id === p.id;
            return html`
              <button key=${p.id} class=${current ? 'is-current' : ''} disabled=${busy} aria-current=${current ? 'true' : null} onClick=${(e) => pick(p, e.currentTarget.querySelector('.profile-avatar'))}>
                <${ProfileAvatar} name=${p.display_name} avatar=${p.avatar} large />
                <span class="switch-name">${p.display_name}</span>
                ${current && html`<small>Đang dùng</small>`}
              </button>
            `;
          })}
        </div>
        <div class="switch-foot">
          <button class="btn btn-ghost" disabled=${busy} onClick=${() => { closeProfileSwitcher(); window.location.hash = '#/profiles?manage=1'; }}>Quản lý hồ sơ</button>
          <button class="btn btn-ghost" disabled=${busy} onClick=${closeProfileSwitcher}>Đóng</button>
        </div>
      </div>
    </div>
  `;
}
