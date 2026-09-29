// Trạng thái xử lý 1 sách: timeline + danh sách trang lỗi có thể thử lại (§Implementation step 7).
// Polls every 3s while there is work in progress, stops once nothing is pending.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, pagesApi } from '../api-client.js';
import { ProgressTimeline } from '../components/progress-timeline.js';
import { Icon } from '../icons.js';

const POLL_MS = 3000;

/** @param {{ bookId: string }} props */
export function BookStatusView({ bookId }) {
  const [book, setBook] = useState(/** @type {any|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [retrying, setRetrying] = useState(/** @type {Set<string>} */ (new Set()));
  const [discarding, setDiscarding] = useState(/** @type {Set<number>} */ (new Set()));
  const timerRef = useRef(/** @type {number|undefined} */ (undefined));

  async function load() {
    try {
      const b = await booksApi.get(bookId);
      setBook(b);
      setError(null);
      const hasWork = b.pages.processing > 0 || b.chunks.processing > 0 || b.chunks.waiting_quota > 0 || b.state === 'processing';
      if (hasWork) {
        timerRef.current = window.setTimeout(load, POLL_MS);
      }
    } catch (err) {
      setError(err.message || 'Không tải được sách');
    }
  }

  useEffect(() => {
    load();
    return () => window.clearTimeout(timerRef.current);
  }, [bookId]);

  async function retryPage(pageId) {
    setRetrying((s) => new Set(s).add(pageId));
    try {
      await pagesApi.retry(pageId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setRetrying((s) => {
        const next = new Set(s);
        next.delete(pageId);
        return next;
      });
    }
  }

  /** @param {number} seq @param {boolean} isMissing whether this seq has no page row at all (a gap) */
  async function discard(seq, isMissing) {
    const warning = isMissing
      ? `Bỏ qua trang ${seq}? Trang này chưa được tải lên — sách sẽ thiếu nội dung của trang này.`
      : `Bỏ trang ${seq}? Nội dung trang này sẽ KHÔNG có trong sách nói, và không thể hoàn tác.`;
    if (!window.confirm(warning)) return;
    setDiscarding((s) => new Set(s).add(seq));
    try {
      await pagesApi.discard(bookId, seq);
      await load();
    } catch (err) {
      setError(err.message || 'Không bỏ được trang này');
    } finally {
      setDiscarding((s) => {
        const next = new Set(s);
        next.delete(seq);
        return next;
      });
    }
  }

  async function remove() {
    if (!window.confirm('Xoá sách này? Không thể hoàn tác.')) return;
    try {
      await booksApi.remove(bookId);
      window.location.hash = '#/library';
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !book) {
    return html`<div class="container"><div class="banner banner-error" role="alert">${error}</div></div>`;
  }
  if (!book) {
    return html`<div class="container"><div class="skeleton" style=${{ height: '200px' }}></div></div>`;
  }

  const failedPages = book.page_list.filter((p) => p.status === 'failed');
  // These two fields are new (added alongside the discard endpoint); default them defensively in
  // case this book status view loads against an older backend that hasn't shipped them yet.
  const missingSeqs = book.pages.missing_seqs || [];
  const blockedAtSeq = book.pages.blocked_at_seq ?? null;

  return html`
    <div>
      <div class="page-header">
        <div class="page-header-back">
          <a class="icon-btn" href="#/library" aria-label="Về thư viện"><${Icon} name="chevron-left" /></a>
          <h1 style=${{ fontSize: '20px', margin: 0 }}>${book.title}</h1>
        </div>
        ${book.can_manage && html`<button class="icon-btn" aria-label="Xoá sách" onClick=${remove}><${Icon} name="trash" /></button>`}
      </div>

      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        <p class="text-muted">Chụp bởi ${book.created_by_name}</p>

        <${ProgressTimeline} book=${book} />

        ${blockedAtSeq != null &&
        html`<div class="banner banner-info">
          <${Icon} name="alert-circle" size=${14} /> Trang ${blockedAtSeq + 1} đang chặn xử lý — các trang sau đó phải chờ đến khi trang này xong hoặc được bỏ qua.
        </div>`}

        ${(failedPages.length > 0 || missingSeqs.length > 0) &&
        html`
          <div class="ornament"><span>Trang lỗi</span></div>
          <ul style=${{ listStyle: 'none', padding: 0 }}>
            ${failedPages.map(
              (p) => html`
                <li key=${p.id} class="card" style=${{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span>Trang ${p.seq + 1}${p.error ? ` — ${p.error}` : ''}</span>
                  <span style=${{ display: 'flex', gap: '8px' }}>
                    <button class="btn btn-secondary" disabled=${retrying.has(p.id)} onClick=${() => retryPage(p.id)}>
                      <${Icon} name="refresh-cw" size=${16} /> Thử lại
                    </button>
                    <button class="btn btn-danger" disabled=${discarding.has(p.seq)} onClick=${() => discard(p.seq, false)}>
                      <${Icon} name="trash" size=${16} /> Bỏ trang này
                    </button>
                  </span>
                </li>
              `
            )}
            ${missingSeqs.map(
              (seq) => html`
                <li key=${`missing-${seq}`} class="card" style=${{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <span>Trang ${seq + 1} chưa được tải lên</span>
                  <button class="btn btn-danger" disabled=${discarding.has(seq)} onClick=${() => discard(seq, true)}>
                    <${Icon} name="trash" size=${16} /> Bỏ qua trang này
                  </button>
                </li>
              `
            )}
          </ul>
        `}

        <div style=${{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <a class="btn btn-secondary" href="#/capture/${bookId}">Thêm trang</a>
          ${(book.state === 'ready' || book.chunks.done > 0) && html`<a class="btn btn-primary" href="#/read/${bookId}">Đọc / Nghe</a>`}
          ${book.can_manage && html`<a class="btn btn-ghost" href=${booksApi.exportUrl(bookId)}>Tải bản sao</a>`}
        </div>
      </div>
    </div>
  `;
}
