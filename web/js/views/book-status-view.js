// Trạng thái xử lý 1 sách: thanh % tổng, dòng trạng thái theo pha, đếm ngược đoạn cuối, timeline,
// danh sách trang và các trang lỗi có thể thử lại / bỏ qua.
// Polls every 3s while work is pending (60s when only waiting for quota), paused on hidden tabs.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, pagesApi, shelfApi } from '../api-client.js';
import { ProgressTimeline } from '../components/progress-timeline.js';
import { BookPageStatusList } from '../components/book-page-status-list.js';
import { StatusToast } from '../components/status-toast.js';
import { useVisiblePolling } from '../use-visible-polling.js';
import { overallPercent, phaseOf, isBusyPhase, createEta, statusLine } from '../processing-progress.js';
import { Icon } from '../icons.js';

const POLL_MS = 3000;
const QUOTA_POLL_MS = 60000;
const TOAST_MS = 4000;

/** @param {{ bookId: string }} props */
export function BookStatusView({ bookId }) {
  const [book, setBook] = useState(/** @type {any|null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [retrying, setRetrying] = useState(/** @type {Set<string>} */ (new Set()));
  const [discarding, setDiscarding] = useState(/** @type {Set<number>} */ (new Set()));
  const [sealing, setSealing] = useState(false);
  const [toast, setToast] = useState(/** @type {string|null} */ (null));
  const [now, setNow] = useState(Date.now());
  // Per-visit memory: bar never shrinks, ETA anchored at first load, countdown anchored at receipt.
  const percentRef = useRef(0);
  const etaRef = useRef(createEta());
  const receivedAtRef = useRef(Date.now());
  const sawBusyRef = useRef(false);

  const [shelfBusy, setShelfBusy] = useState(false);

  /** Add/remove this book on the current profile's shelf ("Kệ của tôi"). */
  async function toggleShelf() {
    if (!book || shelfBusy) return;
    const next = !book.on_shelf;
    setShelfBusy(true);
    try {
      await (next ? shelfApi.add(bookId) : shelfApi.remove(bookId));
      setBook((b) => (b ? { ...b, on_shelf: next } : b));
    } catch (err) {
      setError(err.message || 'Không cập nhật được kệ');
    } finally {
      setShelfBusy(false);
    }
  }

  async function load(isStale = () => false) {
    try {
      const b = await booksApi.get(bookId);
      if (isStale()) return;
      const at = Date.now();
      receivedAtRef.current = at;
      etaRef.current.observe(b.chunks.done, b.chunks.total, at);
      const phase = phaseOf(b);
      if (isBusyPhase(phase)) sawBusyRef.current = true;
      else if (sawBusyRef.current && phase === 'ready') {
        sawBusyRef.current = false;
        setToast('Sách đã sẵn sàng');
      }
      setBook(b);
      setNow(at);
      setError(null);
    } catch (err) {
      if (!isStale()) setError(err.message || 'Không tải được sách');
    }
  }

  const phase = book ? phaseOf(book) : 'ready';
  const reload = useVisiblePolling(load, phase === 'quota' || phase === 'failed' ? QUOTA_POLL_MS : POLL_MS, book !== null && isBusyPhase(phase));

  useEffect(() => {
    percentRef.current = 0;
    etaRef.current = createEta();
    sawBusyRef.current = false;
    setBook(null);
    reload();
  }, [bookId]);

  // Countdown ticks every second, independent of polling.
  useEffect(() => {
    if (phase !== 'tail_wait') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function sealNow() {
    setSealing(true);
    try {
      await booksApi.sealTail(bookId);
      await reload();
    } catch (err) {
      setError(err.message || 'Không chốt được đoạn cuối');
    } finally {
      setSealing(false);
    }
  }

  async function retryPage(pageId) {
    setRetrying((s) => new Set(s).add(pageId));
    try {
      await pagesApi.retry(pageId);
      await reload();
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
      await reload();
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

  percentRef.current = overallPercent(book, percentRef.current);
  const percent = percentRef.current;
  const etaMs = etaRef.current.remainingMs(now);
  const tws = book.chunks.tail_wait_seconds;
  const countdown = tws == null ? null : Math.max(0, tws - Math.floor((now - receivedAtRef.current) / 1000));
  const line = statusLine(book, { etaMs, countdownSeconds: countdown });
  const canListen = book.state === 'ready' || book.chunks.done > 0;
  const listenMinutes = Math.max(1, Math.round((book.duration_ms || 0) / 60000));
  const listenLabel =
    phase === 'ready' ? 'Đọc / Nghe' : book.duration_ms ? `Nghe ngay · ${listenMinutes} phút đã sẵn sàng` : 'Nghe ngay';
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
        <div class="page-header-actions">
          <button class="shelf-toggle" aria-pressed=${book.on_shelf ? 'true' : 'false'} disabled=${shelfBusy} onClick=${toggleShelf}>
            <${Icon} name="bookmark" size=${16} /> ${book.on_shelf ? 'Trên kệ' : 'Thêm vào kệ'}
          </button>
          ${book.can_manage && html`<button class="icon-btn" aria-label="Xoá sách" onClick=${remove}><${Icon} name="trash" /></button>`}
        </div>
      </div>
      <div class="fleuron-rule header-rule" aria-hidden="true"><i></i></div>

      <div class="container">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        <p class="text-muted">Chụp bởi ${book.created_by_name}</p>

        <div class="build-progress">
          <div class="build-progress-track" role="progressbar" aria-label="Tiến độ xử lý" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}>
            <i style=${{ width: `${percent}%` }}></i>
          </div>
          <div class="build-progress-line ${phase === 'failed' ? 'build-progress-line--failed' : ''}">
            <span aria-live=${phase === 'tail_wait' ? 'off' : 'polite'}>${line}</span>
            <strong>${percent}%</strong>
          </div>
          ${phase === 'tail_wait' &&
          html`<div class="build-progress-actions">
            <button class="btn btn-secondary" disabled=${sealing} onClick=${sealNow}>
              ${sealing && html`<span class="spinner" aria-hidden="true"></span> `}Xong rồi, đọc luôn
            </button>
          </div>`}
        </div>

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

        <${BookPageStatusList} pages=${book.page_list} />

        <div style=${{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <a class="btn btn-secondary" href="#/capture/${bookId}">Thêm trang</a>
          ${canListen && html`<a class="btn btn-primary" href="#/listen/${bookId}">${listenLabel}</a>`}
          ${book.can_manage && html`<a class="btn btn-ghost" href=${booksApi.exportUrl(bookId)}>Tải bản sao</a>`}
        </div>
      </div>
      <${StatusToast} message=${toast} />
    </div>
  `;
}
