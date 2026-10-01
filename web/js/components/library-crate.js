// One "record crate": a sticky tab (topic name + count) above a horizontally scrolling row of records.
// Each record is a sleeve with the disc peeking out to the right, only once the book is playable.
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Icon } from '../icons.js';
import { libraryLabel, overallPercent, phaseOf } from '../processing-progress.js';
import { remainingMinutes } from '../library-rails.js';

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
  return html`
    <a class="rec" href=${href(book, offline)} aria-label=${`${book.title}, ${info.label}`}>
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
