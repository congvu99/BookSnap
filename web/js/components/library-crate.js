// One "record crate": a sticky tab (topic name + count) above a horizontally scrolling row of records.
// Each record is a sleeve with the disc peeking out to the right, only once the book is playable.
import { html, useEffect, useRef } from '../../vendor/preact-htm.module.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Icon } from '../icons.js';
import { libraryLabel, overallPercent, phaseOf } from '../processing-progress.js';
import { prefetchBook } from '../book-prefetch.js';

export const BUSY_PHASES = new Set(['ocr', 'tts', 'tail_wait', 'quota']);
const PHASE_ICON = { failed: 'alert-circle' };

/** Label + icon for a record; offline copies may lack counters, so they fall back to book.state. */
export function stateInfo(book) {
  if (!book.pages || !book.chunks) return { label: book.state === 'ready' ? 'Sẵn sàng' : 'Chưa có trang', icon: 'clock', phase: book.state };
  const phase = phaseOf(book);
  return { label: libraryLabel(book), icon: PHASE_ICON[phase] || 'clock', phase };
}

/** Chunk-based fraction of the book already listened to (0-100). */
export function progressPercent(book) {
  const total = book.chunks ? book.chunks.total : 0;
  if (!book.progress || !total) return 0;
  return Math.min(100, Math.round((book.progress.chunk_seq / total) * 100));
}

export function href(book, offline) {
  // Offline, the status/player views cannot load; the reader falls back to the saved offline copy.
  if (offline) return `#/read/${book.id}`;
  return book.state === 'ready' ? `#/listen/${book.id}` : `#/book/${book.id}`;
}

const COVER_TRANSITION_NAME = 'book-cover';
/** Safety net when the navigation never happens (modified click, cancelled): drop the name again. */
const COVER_NAME_FALLBACK_MS = 1500;
/** @type {HTMLElement|null} the one element currently carrying the shared-cover transition name */
let namedCover = null;

// Prefetch waits this long after touch-down and gives up if the finger moves this far (a scroll).
const PREFETCH_DELAY_MS = 120;
const PREFETCH_MOVE_PX = 10;

function clearCoverName(el) {
  if (!el) return;
  el.style.viewTransitionName = '';
  if (namedCover === el) namedCover = null;
  delete document.documentElement.dataset.coverFlight;
}

/**
 * Name this card's sleeve so the view transition flies it into the player; only one at a time.
 * When the route changes the card unmounts, so the player's cover is then the sole holder.
 * @param {HTMLElement|null} el
 */
function nameCover(el) {
  if (!el || namedCover === el) return;
  clearCoverName(namedCover);
  el.style.viewTransitionName = COVER_TRANSITION_NAME;
  namedCover = el;
  // The player's cover takes the same name only while this flag is set (css/now-playing.css), so
  // every other way into or out of the player slides as one page instead of detaching the cover.
  document.documentElement.dataset.coverFlight = '';
  setTimeout(() => clearCoverName(el), COVER_NAME_FALLBACK_MS);
}

/**
 * Pressing a record: prefetch the book shortly after touch-down and, on a plain click into the player,
 * name the record's cover so the view transition flies it there. Shared by cards, rows and the hero.
 * @param {any} book
 * @param {string} target href the record opens
 * @param {string} coverSelector element inside the link that flies into the player's cover
 */
export function useRecordPress(book, target, coverSelector) {
  const opensPlayer = target.startsWith('#/listen/');
  const linkRef = useRef(/** @type {HTMLElement|null} */ (null));
  // A swipe (pointercancel / movement) cancels the prefetch, so scrolling never downloads books.
  const warmTimer = useRef(/** @type {any} */ (0));
  const warmStart = useRef(/** @type {{x: number, y: number}|null} */ (null));
  const cancelWarm = () => {
    clearTimeout(warmTimer.current);
    warmStart.current = null;
  };
  const warm = () => {
    if (opensPlayer) prefetchBook(book.id);
  };
  const onPointerDown = (e) => {
    if (!opensPlayer) return;
    cancelWarm();
    warmStart.current = { x: e.clientX, y: e.clientY };
    warmTimer.current = setTimeout(warm, PREFETCH_DELAY_MS);
  };
  const onPointerMove = (e) => {
    const start = warmStart.current;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > PREFETCH_MOVE_PX) cancelWarm();
  };
  useEffect(() => cancelWarm, []);
  const onClick = (e) => {
    warm();
    if (!opensPlayer || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    nameCover(linkRef.current ? linkRef.current.querySelector(coverSelector) : null);
  };
  const onKeyDown = (e) => e.key === 'Enter' && warm();
  return { opensPlayer, linkRef, handlers: { onPointerDown, onPointerMove, onPointerCancel: cancelWarm, onKeyDown, onClick } };
}

/** Build percent for a busy record, clamped per book so the bar never moves backwards between refreshes. */
export function clampedBuildPercent(book, buildPercents) {
  const percent = overallPercent(book, buildPercents.get(book.id) || 0);
  buildPercents.set(book.id, percent);
  return percent;
}

/**
 * Book card used by the browse grid.
 * @param {{ book: any, offline: boolean, buildPercents: Map<any, number> }} props
 */
export function LibraryBookCard({ book, offline, buildPercents }) {
  const info = stateInfo(book);
  const building = !offline && BUSY_PHASES.has(info.phase);
  const percent = building ? clampedBuildPercent(book, buildPercents) : 0;
  const target = href(book, offline);
  const { linkRef, handlers } = useRecordPress(book, target, '.sleeve');
  return html`
    <a class="rec" ref=${linkRef} href=${target} aria-label=${`${book.title}, ${info.label}`} ...${handlers}>
      <div class="rec-art" aria-hidden="true">
        ${book.state === 'ready' && html`<${VinylDisc} book=${book} />`}
        <${RecordSleeve} book=${book} />
      </div>
      <div class="rec-meta">
        <div class="rec-title">${book.title}</div>
        <div class="rec-by">Chụp bởi ${book.created_by_name}</div>
        ${book.progress && html`<div class="rec-progress"><span style=${{ width: `${progressPercent(book)}%` }}></span></div>`}
        ${building &&
        html`<div class="rec-build-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}><span style=${{ width: `${percent}%` }}></span></div>`}
        ${info.phase !== 'ready' &&
        html`<div class="rec-state${info.phase === 'failed' ? ' rec-state--failed' : ''}"><${Icon} name=${info.icon} size=${13} /><span>${info.label}</span></div>`}
      </div>
    </a>
  `;
}

/** @param {{ shelf: {key: string, name: string, books: any[]}, offline: boolean }} props */
export function LibraryCrate({ shelf, offline }) {
  const buildPercents = useRef(new Map());
  const headingId = `crate-${shelf.key || 'unsorted'}`;
  return html`
    <section class="crate-wrap" aria-labelledby=${headingId}>
      <div class="crate-head"><h2 class="crate-tab" id=${headingId}>${shelf.name} <small>${shelf.books.length}</small></h2></div>
      <div class="crate"><div class="crate-row">${shelf.books.map((b) => html`<${LibraryBookCard} key=${b.id} book=${b} offline=${offline} buildPercents=${buildPercents.current} />`)}</div></div>
    </section>
  `;
}
