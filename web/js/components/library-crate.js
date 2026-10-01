// One "record crate": a sticky tab (topic name + count) above a horizontally scrolling row of records.
// Each record is a sleeve with the disc peeking out to the right, only once the book is playable.
import { html, useEffect, useRef } from '../../vendor/preact-htm.module.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Icon } from '../icons.js';
import { libraryLabel, overallPercent, phaseOf } from '../processing-progress.js';
import { remainingMinutes } from '../library-rails.js';
import { prefetchBook } from '../book-prefetch.js';

const BUSY_PHASES = new Set(['ocr', 'tts', 'tail_wait', 'quota']);
const PHASE_ICON = { ready: 'check', failed: 'alert-circle' };

/** Label + icon for a record; offline copies may lack counters, so they fall back to book.state. */
function stateInfo(book) {
  if (!book.pages || !book.chunks) return { label: book.state === 'ready' ? 'Sẵn sàng' : 'Chưa có trang', icon: 'clock', phase: book.state };
  const phase = phaseOf(book);
  return { label: libraryLabel(book), icon: PHASE_ICON[phase] || 'clock', phase };
}

/** Chunk-based fraction of the book already listened to (0-100). */
function progressPercent(book) {
  const total = book.chunks ? book.chunks.total : 0;
  if (!book.progress || !total) return 0;
  return Math.min(100, Math.round((book.progress.chunk_seq / total) * 100));
}

function href(book, offline) {
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
 * Book card shared by crates, rails and the browse grid.
 * `showRemaining` (continue rail) adds "Còn N phút" under the progress bar.
 * @param {{ book: any, offline: boolean, buildPercents: Map<any, number>, showRemaining?: boolean }} props
 */
export function LibraryBookCard({ book, offline, buildPercents, showRemaining = false }) {
  const info = stateInfo(book);
  const building = !offline && BUSY_PHASES.has(info.phase);
  // Clamp per book so the pressing bar never moves backwards between refreshes.
  const minutes = showRemaining ? remainingMinutes(book) : null;
  const percent = building ? overallPercent(book, buildPercents.get(book.id) || 0) : 0;
  if (building) buildPercents.set(book.id, percent);
  const target = href(book, offline);
  const opensPlayer = target.startsWith('#/listen/');
  const linkRef = useRef(/** @type {HTMLElement|null} */ (null));
  // Start loading book + chunks + progress shortly after the finger lands, ahead of the click.
  // A swipe across a rail cancels it (pointercancel / movement), so scrolling never downloads books.
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
    if (!opensPlayer || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    nameCover(linkRef.current ? linkRef.current.querySelector('.sleeve') : null);
  };
  return html`
    <a class="rec" ref=${linkRef} href=${target} aria-label=${`${book.title}, ${info.label}`} onPointerDown=${onPointerDown} onPointerMove=${onPointerMove} onPointerCancel=${cancelWarm} onKeyDown=${(e) => e.key === 'Enter' && warm()} onClick=${(e) => { warm(); onClick(e); }}>
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
        ${minutes !== null && html`<div class="rec-remaining">Còn ${minutes} phút</div>`}
        <div class="rec-state rec-state--${info.phase === 'failed' ? 'failed' : book.state}"><${Icon} name=${info.icon} size=${13} /><span>${info.label}</span></div>
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
