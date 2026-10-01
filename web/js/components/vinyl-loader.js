// Full-page loading state: a slowly spinning record with a parked tonearm. Markup mirrors the static
// boot loader in index.html so the hand-off from HTML to Preact does not visibly change.
import { html } from '../../vendor/preact-htm.module.js';

/** @param {{ label?: string, size?: number }} props  label: caption under the record; size: record diameter in px. */
export function VinylLoader({ label = 'BookSnap', size = 112 } = {}) {
  // Screen readers announce live-region text, not a label alone: the caption itself carries "Đang tải".
  return html`<div class="vinyl-loader" role="status" aria-live="polite" style=${{ '--vl-size': `${size}px` }}>
    <div class="vinyl-loader-stage" aria-hidden="true"><div class="vinyl-loader-record"></div><span class="vinyl-loader-arm"></span></div>
    <div class="vinyl-loader-label">${label}<span class="visually-hidden"> đang tải</span></div>
  </div>`;
}
