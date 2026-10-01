// Trạng thái xử lý 1 sách: thanh % tổng, dòng trạng thái theo pha, đếm ngược đoạn cuối, timeline,
// danh sách trang và các trang lỗi có thể thử lại / bỏ qua.
// Polls every 3s while work is pending (60s when only waiting for quota), paused on hidden tabs.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, pagesApi } from '../api-client.js';
import { useShelfToggle } from '../use-shelf-toggle.js';
import { ProgressTimeline } from '../components/progress-timeline.js';
import { BookPageStatusList } from '../components/book-page-status-list.js';
import { StatusToast } from '../components/status-toast.js';
import { useVisiblePolling } from '../use-visible-polling.js';
import { overallPercent, phaseOf, isBusyPhase, createEta, statusLine } from '../processing-progress.js';
import { Icon } from '../icons.js';
import { SkeletonStatus, SkeletonLine, SkeletonBlock } from '../components/skeleton.js';
import { authStore } from '../store.js';
import { peekEntry, setCached, invalidateCached } from '../view-cache.js';

const POLL_MS = 3000;
const QUOTA_POLL_MS = 60000;
const TOAST_MS = 4000;

const cacheKey = (bookId) => `book:${bookId}`;
const currentProfileId = () => authStore.get().user?.id ?? null;

/** Layout-faithful placeholder: title bar, progress bar, four status steps. */
function BookStatusSkeleton() {
  return html`
    <div>
      <${SkeletonStatus} />
      <div class="page-header">
        <div class="page-header-back">
          <a class="icon-btn" href="#/library" aria-label="Về thư viện"><${Icon} name="chevron-left" /></a>
          <${SkeletonLine} width="180px" />
        </div>
      </div>
      <div class="container">
        <${SkeletonLine} width="40%" />
        <div class="build-progress">
          <${SkeletonBlock} height="8px" radius="4px" />
          <div class="build-progress-line"><${SkeletonLine} width="55%" /><${SkeletonLine} width="36px" /></div>
        </div>
        <div class="sk-steps">
          ${[0, 1, 2, 3].map((i) => html`
            <div class="sk-step" key=${i}>
              <div class="skeleton sk-icon"></div>
              <${SkeletonLine} width=${['62%', '48%', '56%', '40%'][i]} />
            </div>
          `)}
        </div>
      </div>
    </div>
  `;
}

/** @param {{ bookId: string }} props */
export function BookStatusView({ bookId }) {
  // A visit within the cache window paints the last known status at once; the first poll replaces it.
  const [book, setBook] = useState(() => peekEntry(cacheKey(bookId), { profileId: currentProfileId() })?.value ?? null);
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [retrying, setRetrying] = useState(/** @type {Set<string>} */ (new Set()));
  const [discarding, setDiscarding] = useState(/** @type {Set<number>} */ (new Set()));
  const [sealing, setSealing] = useState(false);
  const [toast, setToast] = useState(/** @type {string|null} */ (null));
  const [toastTone, setToastTone] = useState(/** @type {'info'|'error'} */ ('info'));
  const [now, setNow] = useState(Date.now());
  // Per-visit memory: bar never shrinks, ETA anchored at first load, countdown anchored at receipt.
  const percentRef = useRef(0);
  const etaRef = useRef(createEta());
  const receivedAtRef = useRef(peekEntry(cacheKey(bookId), { profileId: currentProfileId() })?.at ?? Date.now());
  const sawBusyRef = useRef(false);

  // Optimistic shelf toggle; polled `book.on_shelf` never overrides a pending tap.
  const shelf = useShelfToggle(bookId, book?.on_shelf);
  useEffect(() => {
    if (shelf.failures > 0) {
      setToastTone('error');
      setToast(`${shelf.message || 'Không lưu được kệ, thử lại sau'}`);
    }
  }, [shelf.failures]);

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
        setToastTone('info');
        setToast('Sách đã sẵn sàng');
      }
      setCached(cacheKey(bookId), b, { profileId: currentProfileId() });
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
    const entry = peekEntry(cacheKey(bookId), { profileId: currentProfileId() });
    if (entry) receivedAtRef.current = entry.at;
    setBook(entry ? entry.value : null);
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
      invalidateCached(cacheKey(bookId), { profileId: currentProfileId() });
      window.location.hash = '#/library';
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !book) {
    return html`<div class="container"><div class="banner banner-error" role="alert">${error}</div></div>`;
  }
  if (!book) {
    return html`<${BookStatusSkeleton} />`;
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
          <button class="shelf-toggle" aria-pressed=${shelf.onShelf ? 'true' : 'false'} onClick=${shelf.toggle}>
            <${Icon} name="bookmark" size=${16} /> ${shelf.onShelf ?'Trên kệ' : 'Thêm vào kệ'}
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
            <button class="btn btn-secondary" disabled=${sealing} aria-busy=${sealing ? 'true' : null} onClick=${sealNow}>
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
                    <button class="btn btn-secondary" disabled=${retrying.has(p.id)} aria-busy=${retrying.has(p.id) ? 'true' : null} onClick=${() => retryPage(p.id)}>
                      <${Icon} name="refresh-cw" size=${16} /> Thử lại
                    </button>
                    <button class="btn btn-danger" disabled=${discarding.has(p.seq)} aria-busy=${discarding.has(p.seq) ? 'true' : null} onClick=${() => discard(p.seq, false)}>
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
                  <button class="btn btn-danger" disabled=${discarding.has(seq)} aria-busy=${discarding.has(seq) ? 'true' : null} onClick=${() => discard(seq, true)}>
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
      <${StatusToast} message=${toast} tone=${toastTone} />
    </div>
  `;
}
