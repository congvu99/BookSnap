// "Nghe tiếp" hero: the most recently played book, framed with the screen's only ornate card.
// Layout reference: docs/mockups/vinyl-library-preview.html (.hero).
import { html } from '../../vendor/preact-htm.module.js';
import { OrnateFrame } from './ornate-frame.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Icon } from '../icons.js';

/** @param {{ book: any }} props book from GET /api/me/continue (has progress + chunks) */
export function LibraryHeroCard({ book }) {
  const total = book.chunks ? book.chunks.total : 0;
  const seq = book.progress ? book.progress.chunk_seq + 1 : 1;
  return html`
    <${OrnateFrame} as="section" className="hero" aria-label="Nghe tiếp">
      <div class="hero-text">
        <p class="eyebrow"><span class="lozenge" aria-hidden="true"></span>Nghe tiếp</p>
        <h2 class="hero-title">${book.title}</h2>
        ${total > 0 && html`<p class="hero-meta">Đoạn ${Math.min(seq, total)}/${total}</p>`}
        <a class="btn btn-primary" href=${`#/listen/${book.id}`}><${Icon} name="play" size=${18} />Nghe tiếp</a>
      </div>
      <div class="hero-art" aria-hidden="true">
        <${VinylDisc} book=${book} />
        <${RecordSleeve} book=${book} />
      </div>
    <//>
  `;
}
