// A library record drawn to show its state without words: a ring around the disc (listened or build
// progress, or a clock face while waiting for a Gemini turn) plus a disc that is glossy when playable,
// matte where it is not pressed yet, and cracked on error. A small avatar marks who captured the book.
// Layout reference: docs/mockups/library-record-states.html.
import { html } from '../../vendor/preact-htm.module.js';
import { VinylDisc } from './vinyl-disc.js';
import { ProfileAvatar } from './profile-avatar.js';
import { sleeveStyle } from '../sleeve-palette.js';

const RING_RADIUS = 47;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;
const CLOCK_TICKS = Array.from({ length: 12 }, (_, i) => (i * Math.PI) / 6);
const GROOVES = Array.from({ length: 10 }, (_, i) => 42 + i * 5.6);
const MATTE_RINGS = [50, 64, 78, 92];
// The chip that breaks off an errored record, and the cracks running from the spindle.
const CHIP_PATH = 'M100 100 L171 1 L213 57Z';
const CRACK_PATH = 'M100 100 L67 138 L76 159 L50 192 M100 100 L43 86 L25 98 M100 100 L121 171';

/** Point on a circle of the 200-unit disc, angle in degrees clockwise from 12 o'clock. */
function point(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(rad), 100 + r * Math.sin(rad)].map((v) => +v.toFixed(1));
}

function sector(r, fromDeg, toDeg) {
  const [x0, y0] = point(r, fromDeg);
  const [x1, y1] = point(r, toDeg);
  return `M100 100 L${x0} ${y0} A${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x1} ${y1}Z`;
}

const Grooves = ({ max = 99 }) => html`<g class="disc-grooves">${GROOVES.filter((r) => r < max).map((r, i) => html`<circle cx="100" cy="100" r=${r} class=${i % 3 === 0 ? 'is-major' : ''} />`)}</g>`;
const MatteRings = ({ from = 0 }) => html`${MATTE_RINGS.filter((r) => r > from).map((r) => html`<circle class="rart-matte-ring" cx="100" cy="100" r=${r} />`)}`;
const Label = ({ children }) => html`
  <circle class="disc-label" cx="100" cy="100" r="34" />
  <circle class="disc-label-rule" cx="100" cy="100" r="31.5" />
  ${children}
  <circle class="disc-hole" cx="100" cy="100" r="2.6" />
`;
const Lozenge = () => html`<path class="disc-label-lozenge" d="M100 83 l3 5 -3 5 -3 -5z" />`;

/** Outer ring: progress arc, listening needle, or a 12-tick clock face with a travelling dot. */
function Ring({ kind, percent }) {
  if (kind === 'failed' || kind === 'empty') return null;
  if (kind === 'quota') {
    return html`
      <svg class="ringed-ring" viewBox="0 0 100 100" focusable="false">
        ${CLOCK_TICKS.map((a, i) => html`<line class=${`ringed-tick${i % 3 ? '' : ' is-major'}`} x1=${50 + 44.5 * Math.cos(a)} y1=${50 + 44.5 * Math.sin(a)} x2=${50 + 49.5 * Math.cos(a)} y2=${50 + 49.5 * Math.sin(a)} />`)}
        <g class="ringed-orbit"><circle class="ringed-orbit-dot" cx="97" cy="50" r="3.4" /></g>
      </svg>
    `;
  }
  const shown = kind === 'done' ? 100 : Math.max(0, Math.min(100, percent));
  const filled = (RING_LENGTH * shown) / 100;
  const tone = kind === 'listening' ? 'is-listened' : 'is-building';
  const needle = (shown / 100) * 2 * Math.PI;
  return html`
    <svg class="ringed-ring" viewBox="0 0 100 100" focusable="false">
      <circle class="ringed-track" cx="50" cy="50" r=${RING_RADIUS} />
      ${filled > 0 && html`<circle class=${`ringed-fill ${tone}`} cx="50" cy="50" r=${RING_RADIUS} stroke-dasharray=${`${filled.toFixed(1)} ${RING_LENGTH.toFixed(1)}`} />`}
      ${kind === 'listening' && html`<circle class="ringed-needle" cx=${(50 + RING_RADIUS * Math.cos(needle)).toFixed(1)} cy=${(50 + RING_RADIUS * Math.sin(needle)).toFixed(1)} r="4" />`}
    </svg>
  `;
}

/** Mark printed over the glossy disc's label: a tick when finished, pause bars while waiting a turn. */
function LabelMark({ kind }) {
  if (kind !== 'done' && kind !== 'quota') return null;
  return html`
    <svg class="rart-mark" viewBox="0 0 200 200" focusable="false">
      <circle class="disc-label" cx="100" cy="100" r="29" />
      ${kind === 'done'
        ? html`<path class="rart-glyph-stroke" d="M86 100 l9 9 l19 -20" />`
        : html`<rect class="rart-glyph" x="89" y="86" width="8" height="28" rx="2" /><rect class="rart-glyph" x="103" y="86" width="8" height="28" rx="2" />`}
    </svg>
  `;
}

/** Disc art for kinds that are not a finished glossy record. */
function StateDisc({ book, kind, percent }) {
  const clipId = `rart-${kind}-${book.id}`;
  let body;
  if (kind === 'empty') {
    body = html`<circle class="rart-outline" cx="100" cy="100" r="97" /><circle class="rart-outline" cx="100" cy="100" r="34" />`;
  } else if (kind === 'failed') {
    body = html`
      <clipPath id=${clipId}><path d=${`M-20 -20H230V230H-20Z ${CHIP_PATH}`} clip-rule="evenodd" /></clipPath>
      <clipPath id=${`${clipId}-chip`}><path d=${CHIP_PATH} /></clipPath>
      <g clip-path=${`url(#${clipId})`}><circle class="disc-vinyl" cx="100" cy="100" r="99" /><${Grooves} /></g>
      <g transform="translate(16 -12) rotate(8 170 40)" clip-path=${`url(#${clipId}-chip)`}><circle class="disc-vinyl" cx="100" cy="100" r="99" /><${Grooves} /></g>
      <path class="rart-crack" d=${CRACK_PATH} />
      <circle class="rart-danger" cx="100" cy="100" r="34" />
      <path class="rart-danger-mark" d="M100 84 v19" /><circle class="rart-danger-dot" cx="100" cy="113" r="3.8" />
    `;
  } else if (kind === 'ocr') {
    body = html`
      <circle class="rart-matte" cx="100" cy="100" r="99" /><${MatteRings} />
      <g class="rart-sweep"><path class="rart-sweep-beam" d=${sector(99, 0, 40)} /><line class="rart-sweep-edge" x1="100" y1="100" x2="100" y2="1" /></g>
      <${Label}><rect class="rart-page" x="91" y="87" width="18" height="24" rx="2" /><path class="rart-page-lines" d="M95 94 h10 M95 99 h10 M95 104 h7" /><//>
    `;
  } else if (kind === 'pressing') {
    const angle = Math.max(0, Math.min(359.9, percent * 3.6));
    const [x, y] = point(99, angle);
    body = html`
      <circle class="rart-matte" cx="100" cy="100" r="99" /><${MatteRings} />
      ${angle > 0 && html`<clipPath id=${clipId}><path d=${sector(100, 0, angle)} /></clipPath>
        <g clip-path=${`url(#${clipId})`}><circle class="disc-vinyl" cx="100" cy="100" r="99" /><${Grooves} /></g>
        <line class="rart-cutter" x1="100" y1="100" x2=${x} y2=${y} />`}
      <${Label}><${Lozenge} /><//>
    `;
  } else {
    // 'tail': the core is pressed, the outer band stays matte with room for more pages.
    body = html`
      <circle class="rart-matte" cx="100" cy="100" r="99" /><${MatteRings} from=${72} />
      <circle class="disc-vinyl" cx="100" cy="100" r="72" /><${Grooves} max=${71} />
      <${Label}><${Lozenge} /><//>
      <g class="rart-more"><circle class="rart-more-badge" cx="100" cy="16" r="17" /><path class="rart-more-plus" d="M100 6 v20 M90 16 h20" /></g>
    `;
  }
  return html`<div class="disc rart-disc" aria-hidden="true" style=${sleeveStyle(book.id)}><svg viewBox="0 0 200 200" focusable="false">${body}</svg></div>`;
}

const GLOSSY_KINDS = new Set(['fresh', 'listening', 'done', 'quota']);

/**
 * @param {{ book: any, kind: import('../library-record-state.js').RecordKind, percent: number }} props
 *   percent: listened share for 'listening', build share for 'pressing'
 */
export function RecordArt({ book, kind, percent }) {
  return html`
    <div class=${`ringed is-${kind}`} aria-hidden="true">
      <${Ring} kind=${kind} percent=${percent} />
      ${GLOSSY_KINDS.has(kind)
        ? html`<${VinylDisc} book=${book} /><div class="rart-mark-wrap" style=${sleeveStyle(book.id)}><${LabelMark} kind=${kind} /></div>`
        : html`<${StateDisc} book=${book} kind=${kind} percent=${percent} />`}
      ${book.created_by_name && html`<${ProfileAvatar} name=${book.created_by_name} avatar=${book.created_by_avatar} />`}
    </div>
  `;
}
