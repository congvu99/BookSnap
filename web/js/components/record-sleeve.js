// Square record sleeve: the book's cover in the vinyl library. Leather colour comes from the book id
// (sleeve-palette.js); gold double frame, scrolled corners, fleurons and a faint ring-wear circle.
// Layout reference: docs/mockups/vinyl-library-preview.html.
import { html } from '../../vendor/preact-htm.module.js';
import { CornerFlourish, Fleuron, SQUARE_MIRRORED_CORNERS } from './ornament-shapes.js';
import { sleeveStyle } from '../sleeve-palette.js';

function SleeveOrnament() {
  return html`
    <svg class="sleeve-ornament" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle class="sleeve-ring-wear" cx="100" cy="100" r="84" />
      <rect x="8" y="8" width="184" height="184" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" />
      <rect x="12.5" y="12.5" width="175" height="175" rx="1.5" fill="none" stroke="currentColor" stroke-width=".6" />
      ${SQUARE_MIRRORED_CORNERS.map((t) => html`<${CornerFlourish} transform=${t} />`)}
      <${Fleuron} transform="translate(100 50)" />
      <${Fleuron} transform="translate(100 150) scale(1 -1)" />
    </svg>
  `;
}

/** Lowercase-width glyphs of the longest word that fit one line of the title box at scale 1 (Playfair Display 600). */
const WORD_FIT_CHARS = 11;
/** Playfair capitals are ~1.35x as wide as its lowercase. */
const CAPITAL_WIDTH = 1.35;
/** Below this the title stops being legible; a single very long word may then wrap mid-word. */
const MIN_SCALE = 0.5;

function wordWidth(word) {
  let width = 0;
  for (const ch of word) width += ch !== ch.toLowerCase() ? CAPITAL_WIDTH : 1;
  return width;
}

/** Longer titles get a smaller type size so they stay inside the frame; long words shrink the type instead of breaking. */
function titleScale(title) {
  const n = title.length;
  const byLength = n <= 8 ? 1.3 : n <= 22 ? 1 : n <= 40 ? 0.8 : 0.66;
  const widestWord = Math.max(1, ...title.split(/[\s\-–—]+/).map(wordWidth));
  return Math.max(MIN_SCALE, Math.min(byLength, WORD_FIT_CHARS / widestWord));
}

/** Decorative: the title is always shown as text next to the sleeve. @param {{book: {id: string, title: string}, className?: string}} props */
export function RecordSleeve({ book, className = '' }) {
  return html`
    <div class="sleeve ${className}" aria-hidden="true" style=${{ ...sleeveStyle(book.id), '--title-scale': titleScale(book.title) }}>
      <${SleeveOrnament} />
      <div class="sleeve-title"><span>${book.title}</span></div>
    </div>
  `;
}
