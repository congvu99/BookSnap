// One reading paragraph: tap to play from here, aria-current when active, inline status for
// pending/processing/waiting_quota/failed chunks, long-press or menu button to edit text.
import { html, useRef } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

const LONG_PRESS_MS = 500;

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

  return html`
    <p
      class="reader-paragraph ${pending ? 'reader-paragraph--' + chunk.status : ''}"
      data-seq=${chunk.seq}
      aria-current=${isActive ? 'true' : undefined}
      onClick=${onClick}
      onPointerDown=${onPointerDown}
      onPointerUp=${cancelPress}
      onPointerLeave=${cancelPress}
      tabIndex="0"
      role="button"
      aria-label=${`Phát từ đoạn ${chunk.seq + 1}`}
    >
      ${statusNode}
      <span>${chunk.text}</span>
      <button
        class="icon-btn"
        style=${{ width: '32px', height: '32px', verticalAlign: 'middle' }}
        aria-label="Sửa đoạn"
        onClick=${(e) => { e.stopPropagation(); onEdit(chunk); }}
      >
        <${Icon} name="edit" size=${16} />
      </button>
    </p>
  `;
}
