// Wrapping grid of book cards, used by the browse screen ("#/browse/:railKey").
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { LibraryBookCard } from './library-crate.js';

/** @param {{ books: any[], offline: boolean }} props */
export function LibraryBookGrid({ books, offline }) {
  const buildPercents = useRef(new Map());
  return html`<div class="book-grid">${books.map((b) => html`<${LibraryBookCard} key=${b.id} book=${b} offline=${offline} buildPercents=${buildPercents.current} />`)}</div>`;
}
