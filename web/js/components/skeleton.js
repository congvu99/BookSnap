// Shape-accurate loading placeholders sharing one warm shimmer (.skeleton in css/app.css).
// Every piece is aria-hidden; a screen renders <SkeletonStatus /> once so assistive tech hears "Đang tải…".
import { html } from '../../vendor/preact-htm.module.js';

/** Visually hidden live status; render exactly once per loading screen. */
export function SkeletonStatus() {
  return html`<span class="visually-hidden" role="status">Đang tải…</span>`;
}

/** One text line. @param {{ width?: string }} props CSS width, default 100% */
export function SkeletonLine({ width = '100%' }) {
  return html`<div class="skeleton sk-line" aria-hidden="true" style=${{ width }}></div>`;
}

/** Free-form block. @param {{ height?: string, radius?: string }} props */
export function SkeletonBlock({ height = '120px', radius }) {
  const style = radius ? { height, borderRadius: radius } : { height };
  return html`<div class="skeleton sk-block" aria-hidden="true" style=${style}></div>`;
}

/** Square, same footprint as a record sleeve. */
export function SkeletonCover({ className = '' }) {
  return html`<div class="skeleton sk-cover ${className}" aria-hidden="true"></div>`;
}

/** Horizontal row of cover + two text lines, like a library rail. @param {{ count?: number }} props */
export function SkeletonCardRow({ count = 4 }) {
  return html`
    <div class="sk-card-row" aria-hidden="true">
      ${Array.from({ length: count }, (_, i) => html`
        <div class="sk-card" key=${i}>
          <${SkeletonCover} />
          <${SkeletonLine} width="88%" />
          <${SkeletonLine} width="56%" />
        </div>
      `)}
    </div>
  `;
}

/**
 * Grid of cover + title placeholders.
 * @param {{ count?: number, className?: string }} props className is the real grid's class (book-grid, me-grid)
 */
export function SkeletonGrid({ count = 6, className = 'book-grid' }) {
  return html`
    <div class="sk-grid ${className}" aria-hidden="true">
      ${Array.from({ length: count }, (_, i) => html`
        <div class="sk-card" key=${i}>
          <${SkeletonCover} />
          <${SkeletonLine} width="80%" />
        </div>
      `)}
    </div>
  `;
}

/** Rows of icon + text + meta, like the Của tôi groups. @param {{ rows?: number }} props */
export function SkeletonList({ rows = 3 }) {
  return html`
    <div class="sk-list" aria-hidden="true">
      ${Array.from({ length: rows }, (_, i) => html`
        <div class="sk-list-row" key=${i}>
          <div class="skeleton sk-icon"></div>
          <${SkeletonLine} width=${i % 2 ? '52%' : '68%'} />
          <div class="skeleton sk-meta"></div>
        </div>
      `)}
    </div>
  `;
}
