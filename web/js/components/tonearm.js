// Brass tonearm drawn over the listen-mode stage (viewBox 350x220, pivot at 330,20).
// The angle is a CSS variable so the 800ms swing is a plain CSS transition (see now-playing.css).
// Reference: docs/mockups/vinyl-library-preview.html (ARM).
import { html } from '../../vendor/preact-htm.module.js';

/** Needle in the outer groove at 9.5deg, inner groove at 29.5deg, lifted to its rest at -6deg. */
export const ARM_REST_DEG = -6;
const ARM_OUTER_DEG = 9.5;
const ARM_TRAVEL_DEG = 20;

/** @param {boolean} playing @param {number} progress 0..1 share of the book already played */
export function armAngle(playing, progress) {
  if (!playing) return ARM_REST_DEG;
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  return ARM_OUTER_DEG + p * ARM_TRAVEL_DEG;
}

/** @param {{angle: number}} props */
export function Tonearm({ angle }) {
  return html`
    <svg class="stage-arm" viewBox="0 0 350 220" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="arm-brass" x1="0" x2="1">
          <stop offset="0" stop-color="var(--brass-lo)" />
          <stop offset=".45" stop-color="var(--brass-hi)" />
          <stop offset="1" stop-color="var(--brass)" />
        </linearGradient>
        <linearGradient id="arm-brass-rod" gradientUnits="userSpaceOnUse" x1="328" y1="0" x2="332.5" y2="0">
          <stop offset="0" stop-color="var(--brass-lo)" />
          <stop offset=".45" stop-color="var(--brass-hi)" />
          <stop offset="1" stop-color="var(--brass)" />
        </linearGradient>
        <filter id="arm-shadow" x="-60%" y="-20%" width="220%" height="140%">
          <feDropShadow class="arm-shadow" dx="3" dy="5" stdDeviation="2.5" flood-opacity=".35" />
        </filter>
      </defs>
      <g filter="url(#arm-shadow)">
        <circle cx="330" cy="20" r="11" fill="url(#arm-brass)" stroke="var(--brass-lo)" stroke-width=".8" />
        <g class="tonearm" style=${{ '--arm': `${angle}deg` }}>
          <circle cx="330" cy="6" r="5" fill="url(#arm-brass)" stroke="var(--brass-lo)" stroke-width=".6" />
          <path d="M330 18 V152" stroke="url(#arm-brass-rod)" stroke-width="2.6" stroke-linecap="round" />
          <g transform="rotate(20 330 152)">
            <path class="arm-head" d="M325.5 150 h9 l1.5 18 h-12 z" stroke="var(--brass)" stroke-width=".7" />
            <path d="M336 154 h6" stroke="var(--brass)" stroke-width="1.6" stroke-linecap="round" />
          </g>
        </g>
        <circle class="arm-head" cx="330" cy="20" r="4" />
      </g>
    </svg>
  `;
}
