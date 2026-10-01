// Tiny open/close state for the "Đổi hồ sơ" bottom sheet. Any avatar button calls
// openProfileSwitcher(event.currentTarget); the sheet component (mounted once) subscribes.
// No Preact here so it stays unit-testable.

/** @typedef {{ open: boolean, fromEl: Element|null }} ProfileSwitcherState */

/** @type {ProfileSwitcherState} */
let state = { open: false, fromEl: null };
/** @type {Set<(s: ProfileSwitcherState) => void>} */
const listeners = new Set();

function emit() {
  for (const fn of [...listeners]) fn(state);
}

/** @param {Element|null} [fromEl] the control that opened it (focus returns there on close) */
export function openProfileSwitcher(fromEl = null) {
  if (state.open) return;
  state = { open: true, fromEl: fromEl || null };
  emit();
}

export function closeProfileSwitcher() {
  if (!state.open) return;
  state = { open: false, fromEl: state.fromEl };
  emit();
}

export function getProfileSwitcherState() {
  return state;
}

/** @param {(s: ProfileSwitcherState) => void} fn @returns {() => void} unsubscribe */
export function onProfileSwitcherChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
