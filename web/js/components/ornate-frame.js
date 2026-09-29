// Double gold rule with scrolled corners, for the few surfaces that carry ornament (auth
// frontispiece, "new book" card). Corners are fixed-size SVGs, so they never stretch with the box.
import { html } from '../../vendor/preact-htm.module.js';
import { CornerFlourish } from './ornament-shapes.js';

const POSITIONS = ['tl', 'tr', 'bl', 'br'];

function Corner({ position }) {
  return html`
    <svg class="ornate-corner ornate-corner--${position}" viewBox="10 10 52 52" aria-hidden="true" focusable="false">
      <${CornerFlourish} />
    </svg>
  `;
}

/** @param {{ children: any, className?: string, as?: string }} props */
export function OrnateFrame({ children, className = '', as = 'div', ...rest }) {
  return html`
    <${as} class="ornate ${className}" ...${rest}>
      ${POSITIONS.map((p) => html`<${Corner} position=${p} key=${p} />`)}
      ${children}
    <//>
  `;
}
