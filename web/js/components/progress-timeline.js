// Vertical timeline: Tải ảnh → Nhận dạng chữ → Chuyển giọng → Sẵn sàng (§6.4).
import { html } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

/**
 * @param {{ book: object }} props book_out from GET /api/books/:id
 */
export function ProgressTimeline({ book }) {
  const pages = book.pages;
  const chunks = book.chunks;
  const steps = [
    {
      key: 'upload',
      title: 'Tải ảnh',
      detail: `${pages.total} trang đã gửi`,
      state: pages.total > 0 ? 'done' : 'active',
    },
    {
      key: 'ocr',
      title: 'Nhận dạng chữ',
      detail: pages.failed > 0 ? `${pages.failed} trang lỗi` : `${pages.done}/${pages.total} trang xong`,
      state: pages.failed > 0 ? 'failed' : pages.processing > 0 ? 'active' : pages.done >= pages.total && pages.total > 0 ? 'done' : 'pending',
    },
    {
      key: 'tts',
      title: 'Chuyển giọng',
      detail:
        chunks.failed > 0
          ? `${chunks.failed} đoạn lỗi`
          : chunks.waiting_quota > 0
            ? `Chờ quota — ${chunks.waiting_quota} đoạn`
            : `${chunks.done}/${chunks.total} đoạn xong`,
      state:
        chunks.failed > 0
          ? 'failed'
          : chunks.processing > 0 || chunks.queued > 0 || chunks.waiting_quota > 0
            ? 'active'
            : chunks.total > 0 && chunks.done >= chunks.total
              ? 'done'
              : 'pending',
    },
    {
      key: 'ready',
      title: 'Sẵn sàng',
      detail: book.state === 'ready' ? 'Có thể nghe' : 'Chưa xong',
      state: book.state === 'ready' ? 'done' : 'pending',
    },
  ];

  return html`
    <ol class="status-timeline">
      ${steps.map(
        (s) => html`
          <li class="status-step status-step--${s.state}" key=${s.key}>
            <span class="status-step-dot">
              ${s.state === 'done'
                ? html`<${Icon} name="check" size=${14} />`
                : s.state === 'failed'
                  ? html`<${Icon} name="alert-circle" size=${14} />`
                  : html`<span>${steps.indexOf(s) + 1}</span>`}
            </span>
            <div>
              <div class="status-step-title">${s.title}</div>
              <div class="status-step-detail">${s.detail}</div>
            </div>
          </li>
        `
      )}
    </ol>
  `;
}
