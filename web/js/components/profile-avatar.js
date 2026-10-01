// Round avatar for a profile: first letter of the name on its colour (c1..c8).
import { html } from '../../vendor/preact-htm.module.js';
import { avatarClass, avatarInitial } from '../profile-avatar-style.js';

/** @param {{ name: string, avatar?: string|null, large?: boolean }} props */
export function ProfileAvatar({ name, avatar, large = false }) {
  return html`<span class=${`profile-avatar ${avatarClass(avatar)} ${large ? 'profile-avatar--lg' : ''}`} aria-hidden="true">${avatarInitial(name)}</span>`;
}
