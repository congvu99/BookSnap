// Profile switch flight: a clone of the tapped avatar flies to screen centre and grows while a
// veil covers the app; once covered the caller swaps the profile, then reveal() fades both out.
import { avatarClass, avatarInitial } from './profile-avatar-style.js';

const BASE = 96; // ghost is laid out at 96px and scaled, so the start scale is rect.width / 96
const EASE = 'cubic-bezier(.32,.72,0,1)';

/**
 * @param {Element|null} avatarEl element whose rect the flight starts from
 * @param {{ display_name: string, avatar?: string|null }} profile
 * @returns {Promise<() => Promise<void>>} resolves once the screen is covered, with reveal()
 */
export async function flyAvatarToCentre(avatarEl, profile) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = avatarEl?.getBoundingClientRect?.() ?? { left: vw / 2 - BASE / 2, top: vh, width: BASE, height: BASE };

  const veil = document.createElement('div');
  veil.className = 'zoom-veil';
  const ghost = document.createElement('div');
  ghost.className = `profile-avatar profile-avatar--lg zoom-ghost ${avatarClass(profile.avatar)}`;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.textContent = avatarInitial(profile.display_name);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  ghost.style.left = `${cx - BASE / 2}px`;
  ghost.style.top = `${cy - BASE / 2}px`;
  document.body.append(veil, ghost);

  const dx = vw / 2 - cx;
  const dy = vh * 0.42 - cy;
  const startScale = (r.width || BASE) / BASE;
  const at = (s) => `translate(${dx}px, ${dy}px) scale(${s})`;
  const cleanup = () => {
    veil.remove();
    ghost.remove();
  };

  try {
    veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'forwards', easing: 'ease-out' });
    await ghost.animate(
      [
        { transform: `translate(0, 0) scale(${startScale})` },
        { transform: at(2.7), offset: 0.6 },
        { transform: at(2.5) },
      ],
      { duration: 560, fill: 'forwards', easing: EASE },
    ).finished;
  } catch {
    // Animation cancelled (element removed): drop the overlay rather than strand a veil.
    cleanup();
    return async () => {};
  }

  return async function reveal() {
    try {
      ghost.animate([{ opacity: 1, transform: at(2.5) }, { opacity: 0, transform: at(3.4) }], { duration: 300, fill: 'forwards', easing: 'ease-in' });
      await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, delay: 120, fill: 'forwards', easing: 'ease-out' }).finished;
    } catch {
      // Cancelled mid-reveal: fall through to cleanup.
    } finally {
      cleanup();
    }
  };
}
