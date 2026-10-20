// Full-page loading state: a slowly spinning record whose tonearm swings onto it. Markup mirrors the
// static boot loader in index.html so the hand-off from HTML to Preact does not visibly change.
import { html, useState } from '../../vendor/preact-htm.module.js';

// Matches the arm swing delay in css/loading.css.
const ARM_DELAY_MS = 250;

/** @param {{ label?: string, size?: number }} props  label: caption under the record; size: record diameter in px. */
export function VinylLoader({ label = 'BookSnap', size = 112 } = {}) {
  // Run the arm swing on the page-load clock: the boot loader's swing (started at load) carries on
  // without restarting after this replaces it, and a loader mounted later shows the arm already down.
  const [armDelay] = useState(() => `${Math.round(ARM_DELAY_MS - performance.now())}ms`);
  // Screen readers announce live-region text, not a label alone: the caption itself carries "Đang tải".
  return html`<div class="vinyl-loader" role="status" aria-live="polite" style=${{ '--vl-size': `${size}px` }}>
    <div class="vinyl-loader-stage" aria-hidden="true"><div class="vinyl-loader-record"></div><span class="vinyl-loader-arm" style=${{ animationDelay: armDelay }}></span></div>
    <div class="vinyl-loader-label">${label}<span class="visually-hidden"> đang tải</span></div>
  </div>`;
}
