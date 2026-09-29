// Small bottom toast for background progress ("Đã tải trang 4–6 ✓", "Sách đã sẵn sàng").
// Looks like the reader's bookmark toast; `tone="error"` stays until the caller clears it.
import { html } from '../../vendor/preact-htm.module.js';

/** @param {{ message: string|null, tone?: 'info'|'error' }} props */
export function StatusToast({ message, tone = 'info' }) {
  return html`<div class="reader-toast status-toast status-toast--${tone}" role="status" aria-live="polite" hidden=${!message}>${message || ''}</div>`;
}
