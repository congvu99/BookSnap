// Per-page status chips for the book status view ("Trang N" + Đã tải / Đang nhận dạng / Xong / Lỗi / Đã bỏ).
import { html } from '../../vendor/preact-htm.module.js';

const CHIPS = {
  uploaded: { label: 'Đã tải', tone: 'idle' },
  ocr_processing: { label: 'Đang nhận dạng', tone: 'active' },
  ocr_done: { label: 'Xong', tone: 'done' },
  failed: { label: 'Lỗi', tone: 'failed' },
  discarded: { label: 'Đã bỏ', tone: 'idle' },
};

/** @param {{ pages: {id: string, seq: number, status: string}[] }} props */
export function BookPageStatusList({ pages }) {
  if (!pages || pages.length === 0) return null;
  return html`
    <div class="ornament"><span>Các trang</span></div>
    <ul class="page-status-list">
      ${pages.map((p) => {
        const chip = CHIPS[p.status] || { label: p.status, tone: 'idle' };
        return html`
          <li key=${p.id} class="page-status-row">
            <span>Trang ${p.seq + 1}</span>
            <span class="page-chip page-chip--${chip.tone}">${chip.label}</span>
          </li>
        `;
      })}
    </ul>
  `;
}
