// Shared classic cover (every book looks like one bound set): wine cloth, gold double frame with
// scrolled corners and fleurons, ivory title in Cormorant. Layout reference: docs/mockups/cover-preview.html (A).
import { html } from '../../vendor/preact-htm.module.js';
import { CornerFlourish, Fleuron, MIRRORED_CORNERS } from './ornament-shapes.js';

function Ornament() {
  return html`
  <svg class="book-cover-ornament" viewBox="0 0 200 300" aria-hidden="true" focusable="false">
    <rect x="8" y="8" width="184" height="284" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
    <rect x="12.5" y="12.5" width="175" height="275" rx="1.5" fill="none" stroke="currentColor" stroke-width=".6" />
    ${MIRRORED_CORNERS.map((t) => html`<${CornerFlourish} transform=${t} />`)}
    <${Fleuron} transform="translate(100 78)" />
    <${Fleuron} transform="translate(100 222) scale(1 -1)" />
  </svg>
`;
}

/** Longer titles get a smaller type size so they stay inside the ornament frame. */
function titleScale(title) {
  const n = title.length;
  return n <= 8 ? 1.35 : n <= 22 ? 1 : n <= 40 ? 0.82 : 0.68;
}

/** Decorative: the title is always shown as text next to the cover, so screen readers skip it. @param {{title: string}} props */
export function BookCover({ title }) {
  return html`
    <div class="book-cover" aria-hidden="true" style=${{ '--title-scale': titleScale(title) }}>
      <${Ornament} />
      <div class="book-cover-title"><span>${title}</span></div>
    </div>
  `;
}
