// Vinyl record whose centre label carries the book's sleeve colour. `detailed` prints the title above
// the spindle and "Mặt A · 33⅓" below it (large player only); `spinning` runs the 33⅓ rpm rotation.
// The sheen is drawn outside the rotating group so reflections stay put while the record turns.
import { html } from '../../vendor/preact-htm.module.js';
import { Fleuron } from './ornament-shapes.js';
import { sleeveStyle } from '../sleeve-palette.js';

const GROOVE_RADII = Array.from({ length: 27 }, (_, i) => +(40 + i * 2.1).toFixed(1));
const LABEL_LINE_CHARS = 12;

function sector(r, a0, a1) {
  const point = (a) => [100 + r * Math.cos((a * Math.PI) / 180), 100 + r * Math.sin((a * Math.PI) / 180)].map((v) => v.toFixed(1)).join(' ');
  return `M100 100 L${point(a0)} A${r} ${r} 0 0 1 ${point(a1)} Z`;
}
const SHEEN_PATHS = [sector(96, 205, 245), sector(96, 25, 65)];

/** Wraps the title into at most two label lines; the second is truncated with an ellipsis. */
export function labelLines(title) {
  const lines = [];
  let current = '';
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > LABEL_LINE_CHARS && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  const clip = (s) => (s.length > LABEL_LINE_CHARS ? `${s.slice(0, LABEL_LINE_CHARS - 1).trimEnd()}…` : s);
  if (lines.length <= 2) return lines.map(clip);
  return [clip(lines[0]), clip(lines.slice(1).join(' '))];
}

function DetailedLabel({ title }) {
  const lines = labelLines(title);
  return html`
    <text class="disc-label-small" x="100" y="80" text-anchor="middle" font-size="4.4" letter-spacing="1.3">BOOKSNAP</text>
    <text class="disc-label-title" text-anchor="middle" font-size="9">
      ${lines.map((line, i) => html`<tspan x="100" y=${lines.length === 1 ? 93 : 86 + i * 8.5}>${line}</tspan>`)}
    </text>
    <g class="disc-label-ornament"><${Fleuron} transform="translate(100 107) scale(.26)" /></g>
    <text class="disc-label-small" x="100" y="118" text-anchor="middle" font-size="4" letter-spacing=".8">MẶT A · 33⅓</text>
  `;
}

/** @param {{book: {id: string, title: string}, detailed?: boolean, spinning?: boolean, className?: string}} props */
export function VinylDisc({ book, detailed = false, spinning = false, className = '' }) {
  return html`
    <div class="disc ${spinning ? 'is-spinning' : ''} ${className}" aria-hidden="true" style=${sleeveStyle(book.id)}>
      <svg viewBox="0 0 200 200" focusable="false">
        <g class="disc-spin">
          <circle class="disc-vinyl" cx="100" cy="100" r="99" />
          <circle class="disc-rim" cx="100" cy="100" r="98.3" />
          <g class="disc-grooves">
            ${GROOVE_RADII.map((r, i) => html`<circle cx="100" cy="100" r=${r} class=${i % 3 === 0 ? 'is-major' : ''} />`)}
          </g>
          <circle class="disc-gap" cx="100" cy="100" r="62" />
          <circle class="disc-gap" cx="100" cy="100" r="80" />
          <circle class="disc-label" cx="100" cy="100" r="34" />
          <circle class="disc-label-rule" cx="100" cy="100" r="31.5" />
          <circle class="disc-label-rule is-thin" cx="100" cy="100" r="29.5" />
          ${detailed ? html`<${DetailedLabel} title=${book.title} />` : html`<path class="disc-label-lozenge" d="M100 83 l3 5 -3 5 -3 -5z" />`}
          <circle class="disc-hole" cx="100" cy="100" r="2.6" />
        </g>
        ${SHEEN_PATHS.map((d) => html`<path class="disc-sheen" d=${d} />`)}
      </svg>
    </div>
  `;
}
