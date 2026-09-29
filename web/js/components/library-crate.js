// One "record crate": a sticky tab (topic name + count) above a horizontally scrolling row of records.
// Each record is a sleeve with the disc peeking out to the right, only once the book is playable.
import { html } from '../../vendor/preact-htm.module.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Icon } from '../icons.js';

/** "Đang ép đĩa · done/total" while chunks are being synthesised. */
function stateInfo(book) {
  const { done = 0, total = 0 } = book.chunks || {};
  switch (book.state) {
    case 'ready': return { label: 'Sẵn sàng', icon: 'check' };
    case 'failed': return { label: 'Có lỗi', icon: 'alert-circle' };
    case 'processing':
    case 'waiting_quota': return { label: total > 0 ? `Đang ép đĩa · ${done}/${total}` : 'Đang ép đĩa', icon: 'clock' };
    default: return { label: 'Chưa có trang', icon: 'clock' };
  }
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

function Record({ book, offline }) {
  const info = stateInfo(book);
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
        <div class="rec-state rec-state--${book.state}"><${Icon} name=${info.icon} size=${13} /><span>${info.label}</span></div>
      </div>
    </a>
  `;
}

/** @param {{ shelf: {key: string, name: string, books: any[]}, offline: boolean }} props */
export function LibraryCrate({ shelf, offline }) {
  const headingId = `crate-${shelf.key || 'unsorted'}`;
  return html`
    <section class="crate-wrap" aria-labelledby=${headingId}>
      <div class="crate-head"><h2 class="crate-tab" id=${headingId}>${shelf.name} <small>${shelf.books.length}</small></h2></div>
      <div class="crate"><div class="crate-row">${shelf.books.map((b) => html`<${Record} key=${b.id} book=${b} offline=${offline} />`)}</div></div>
    </section>
  `;
}
