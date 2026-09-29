// Classic European ornament pieces drawn in currentColor, shared by the book cover and ornate frames.
// Coordinates are in the cover's 200×300 viewBox; a corner occupies roughly the 12–60 unit square.
import { html } from '../../vendor/preact-htm.module.js';

/** Scrolled corner flourish for the top-left corner; mirror it with a transform for the others. */
export function CornerFlourish({ transform = '' }) {
  return html`
    <g transform=${transform} fill="none" stroke="currentColor" stroke-linecap="round">
      <path d="M22 58 V34 Q22 22 34 22 H58" stroke-width="1.3" />
      <path d="M28 50 C28 36 36 28 50 28" stroke-width=".8" />
      <path d="M34 22 C30 30 36 36 42 32 C46 29 43 24 39 26" stroke-width=".9" />
      <path d="M22 34 C30 30 36 36 32 42 C29 46 24 43 26 39" stroke-width=".9" />
      <path d="M16 16 l4 4 -4 4 -4 -4 z" fill="currentColor" stroke="none" />
      <circle cx="58" cy="22" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="22" cy="58" r="1.4" fill="currentColor" stroke="none" />
    </g>
  `;
}

/** Twin scrolls around a lozenge with hairlines either side, centred on the origin (80 × 16 units). */
export function Fleuron({ transform = '' }) {
  return html`
    <g transform=${transform} fill="none" stroke="currentColor">
      <path d="M0 0 C-6 -6 -14 -3 -13 3 C-12 8 -5 7 -4 3 C-3 0 -7 -1 -8 1" stroke-width=".9" />
      <path d="M0 0 C6 -6 14 -3 13 3 C12 8 5 7 4 3 C3 0 7 -1 8 1" stroke-width=".9" />
      <path d="M0 -5 l3 5 -3 5 -3 -5 z" fill="currentColor" stroke="none" />
      <path d="M-40 0 H-18 M18 0 H40" stroke-width=".7" />
    </g>
  `;
}

export const MIRRORED_CORNERS = ['', 'translate(200 0) scale(-1 1)', 'translate(0 300) scale(1 -1)', 'translate(200 300) scale(-1 -1)'];
