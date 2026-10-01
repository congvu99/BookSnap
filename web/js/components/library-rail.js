// Netflix-style rail: title + count + "Xem tất cả ›" link above a horizontal snap-scrolling row of
// book cards. Also exports the flat grid used by search results and the browse screen.
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { LibraryBookCard } from './library-crate.js';

/** @param {{ rail: {key: string, title: string, books: any[]}, offline: boolean }} props */
export function LibraryRail({ rail, offline }) {
  const buildPercents = useRef(new Map());
  const headingId = `rail-${rail.key.replace(/[^\w-]/g, '_')}`;
  return html`
    <section class="rail" aria-labelledby=${headingId}>
      <div class="rail-head">
        <h2 class="rail-title" id=${headingId}>${rail.title}<small>${rail.books.length}</small></h2>
        ${!offline &&
        html`<a class="see-all" href=${`#/browse/${encodeURIComponent(rail.key)}`} aria-label=${`Xem tất cả ${rail.title}`}>Xem tất cả <span class="see-all-arrow" aria-hidden="true">›</span></a>`}
      </div>
      <div class="rail-row">
        ${rail.books.map((b) => html`<${LibraryBookCard} key=${b.id} book=${b} offline=${offline} buildPercents=${buildPercents.current} showRemaining=${rail.key === 'continue'} />`)}
      </div>
    </section>
  `;
}

/** Wrapping grid of the same cards. @param {{ books: any[], offline: boolean }} props */
export function LibraryBookGrid({ books, offline }) {
  const buildPercents = useRef(new Map());
  return html`<div class="book-grid">${books.map((b) => html`<${LibraryBookCard} key=${b.id} book=${b} offline=${offline} buildPercents=${buildPercents.current} />`)}</div>`;
}
