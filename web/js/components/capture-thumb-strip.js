// Thumbnail strip on the capture screen: each shot shows its page number and upload state.
import { html } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

/**
 * @param {{ items: any[], onRetry: (item: any) => void, onRemove: (item: any) => void }} props
 */
export function CaptureThumbStrip({ items, onRetry, onRemove }) {
  const blockIndex = items.findIndex((i) => i.status === 'error');
  return html`
    <div class="capture-thumbs">
      ${items.map((item, idx) => {
        const page = item.seq + 1;
        const blocked = blockIndex !== -1 && idx > blockIndex && item.status === 'queued';
        return html`
          <div class="capture-thumb" key=${item.uploadId} onClick=${() => onRetry(item)}>
            <img src=${item.objectUrl} alt="Trang ${page}" />
            <span class="capture-thumb-badge">Trang ${page}</span>
            ${item.status !== 'done' &&
            html`<div class="capture-thumb-status capture-thumb-status--${item.status === 'error' ? 'error' : ''}">
              ${item.status === 'uploading' && 'Đang tải…'}
              ${item.status === 'queued' && !blocked && 'Chờ…'}
              ${blocked && 'Đang chờ trang trước'}
              ${item.status === 'error' && `Trang ${page} lỗi, chạm để thử lại`}
            </div>`}
            ${item.status !== 'uploading' &&
            html`<button class="capture-thumb-remove" aria-label="Xoá trang ${page}" onClick=${(e) => { e.stopPropagation(); onRemove(item); }}>
              <${Icon} name="x" size=${12} />
            </button>`}
          </div>
        `;
      })}
    </div>
  `;
}
