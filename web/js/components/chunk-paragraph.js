// One reading chunk: tap to play from here, aria-current when active, inline status for
// pending/processing/waiting_quota/failed chunks, long-press or the edit button to edit text.
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

const LONG_PRESS_MS = 500;
// A short line with no sentence ender, followed by more text, is a heading ("Chương một: Mùa nước nổi").
const HEADING_MAX_CHARS = 80;
const ENDS_SENTENCE = /[.!?…:;]["'”’»)\]]*$/;

function formatHHmm(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

/** @param {{chunk: object, isActive: boolean, onPlayFrom: (seq:number)=>void, onRetry:(id:string)=>void, onEdit:(chunk:object)=>void}} props */
export function ChunkParagraph({ chunk, isActive, onPlayFrom, onRetry, onEdit }) {
  const pressTimer = useRef(/** @type {number|undefined} */ (undefined));
  const pending = chunk.status !== 'done';

  function onPointerDown() {
    pressTimer.current = window.setTimeout(() => onEdit(chunk), LONG_PRESS_MS);
  }
  function cancelPress() {
    window.clearTimeout(pressTimer.current);
  }
  function onClick() {
    if (chunk.status === 'done') onPlayFrom(chunk.seq);
  }

  let statusNode = null;
  if (chunk.status === 'waiting_quota') {
    statusNode = html`<span class="reader-paragraph-meta"><${Icon} name="clock" size=${14} /> Chờ quota, tiếp tục lúc ${formatHHmm(chunk.not_before)}</span>`;
  } else if (chunk.status === 'failed') {
    statusNode = html`<span class="reader-paragraph-meta"><${Icon} name="alert-circle" size=${14} /> Lỗi chuyển giọng —
      <button class="reader-retry-link" onClick=${(e) => { e.stopPropagation(); onRetry(chunk.id); }}>Thử lại</button></span>`;
  } else if (chunk.status === 'pending' || chunk.status === 'processing') {
    statusNode = html`<span class="reader-paragraph-meta"><${Icon} name="clock" size=${14} /> Đang chuyển giọng…</span>`;
  }

  // Paragraph breaks from the page survive in chunk text as newlines: one <p> each, so headings
  // stand on their own line. The text itself is what screen readers read; playing and
  // editing are separate buttons (the play one is shown only on keyboard focus).
  const lines = chunk.text.split('\n').filter((line) => line.trim());
  const isHeading = (line, i) => i < lines.length - 1 && line.length <= HEADING_MAX_CHARS && !ENDS_SENTENCE.test(line);
  const dropCapAt = chunk.seq === 0 && !pending ? lines.findIndex((line, i) => !isHeading(line, i)) : -1;
  const lineClass = (line, i) =>
    `reader-line${isHeading(line, i) ? ' reader-line--heading' : ''}${i === dropCapAt ? ' reader-line--dropcap' : ''}`;
  const actions = html`
    ${chunk.status === 'done' &&
    html`<button
      class="icon-btn reader-play-btn"
      aria-label=${`Phát từ đoạn ${chunk.seq + 1}`}
      onClick=${(e) => { e.stopPropagation(); onPlayFrom(chunk.seq); }}
    >
      <${Icon} name="play" size=${16} />
    </button>`}
    <button
      class="icon-btn reader-edit-btn"
      aria-label=${`Sửa đoạn ${chunk.seq + 1}`}
      onClick=${(e) => { e.stopPropagation(); onEdit(chunk); }}
    >
      <${Icon} name="edit" size=${16} />
    </button>
  `;

  return html`
    <div
      class="reader-paragraph${pending ? ' reader-paragraph--' + chunk.status : ''}"
      data-seq=${chunk.seq}
      aria-current=${isActive ? 'true' : undefined}
      onClick=${onClick}
      onPointerDown=${onPointerDown}
      onPointerUp=${cancelPress}
      onPointerLeave=${cancelPress}
    >
      ${statusNode}
      ${lines.map((line, i) => html`<p
        class=${lineClass(line, i)}
        key=${i}
        role=${isHeading(line, i) ? 'heading' : undefined}
        aria-level=${isHeading(line, i) ? '2' : undefined}
      >${line}${i === lines.length - 1 && actions}</p>`)}
    </div>
  `;
}
