// Chụp liên tiếp nhiều trang (§6.1). Ảnh chỉ trong RAM; getUserMedia only (D3), never <input capture>.
// Steps: choose (no book) → confirm (existing book: voice for new pages) → camera.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, voicesApi } from '../api-client.js';
import { CameraCapture, CameraError } from '../camera-capture.js';
import { MAX_PAGES_PER_SESSION, UploadQueue } from '../upload-queue.js';
import { authStore, registerUnsavedWork } from '../store.js';
import { orderVoices } from '../voice-labels.js';
import { Icon } from '../icons.js';
import { CaptureThumbStrip } from '../components/capture-thumb-strip.js';
import { StatusToast } from '../components/status-toast.js';
import { formatPageList, newlyDone, pendingPages } from '../upload-notices.js';
import { CaptureChooseStep } from './capture-choose-step.js';
import { CaptureConfirmStep } from './capture-confirm-step.js';

/** @param {{ bookId?: string, skipConfirm?: boolean }} props skipConfirm: book was just created here */
export function CaptureView({ bookId, skipConfirm = false }) {
  const [step, setStep] = useState(bookId ? (skipConfirm ? 'camera' : 'confirm') : 'choose');
  const [voices, setVoices] = useState(/** @type {any|null} */ (null));
  const [activeBookId] = useState(bookId || null);
  // Voice chosen on the confirm step; applied only once the camera is running.
  const [pendingVoice, setPendingVoice] = useState(/** @type {{provider: string, voice: string} | null} */ (null));
  const [voiceError, setVoiceError] = useState(/** @type {string|null} */ (null));
  const [nextSeq, setNextSeq] = useState(0);
  const [items, setItems] = useState(/** @type {any[]} */ ([]));
  const [torchOn, setTorchOn] = useState(false);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [cameraError, setCameraError] = useState(/** @type {string|null} */ (null));
  const videoRef = useRef(/** @type {HTMLVideoElement|null} */ (null));
  const cameraRef = useRef(/** @type {CameraCapture|null} */ (null));
  const queueRef = useRef(/** @type {UploadQueue|null} */ (null));
  const announcedRef = useRef(new Set());
  const toastTimerRef = useRef(/** @type {any} */ (0));
  const [doneToast, setDoneToast] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    if (skipConfirm && bookId) window.history.replaceState(null, '', `#/capture/${bookId}`);
  }, []);

  useEffect(() => {
    if (step === 'camera') return;
    voicesApi.list().then(setVoices).catch(() => setVoices(null));
  }, [step === 'camera']);

  useEffect(() => {
    if (step !== 'camera' || !activeBookId) return undefined;
    let cancelled = false;
    const bookReady = booksApi
      .get(activeBookId)
      .then((book) => {
        if (cancelled) return false;
        setNextSeq(book.pages.next_seq);
        queueRef.current = new UploadQueue(activeBookId, (its) => !cancelled && setItems(its));
        return true;
      })
      .catch((err) => {
        if (!cancelled) setCameraError(err.message);
        return false;
      });

    const cam = new CameraCapture(videoRef.current);
    cameraRef.current = cam;
    const camReady = cam
      .start()
      .then(() => {
        setSupportsTorch(cam.supportsTorch());
        return true;
      })
      .catch((err) => {
        setCameraError(err instanceof CameraError ? err.message : 'Không mở được camera');
        return false;
      });
    Promise.all([bookReady, camReady]).then(([okBook, okCam]) => {
      if (okBook && okCam && !cancelled) applyPendingVoice();
    });

    function stopOnHide() {
      if (document.hidden) cam.stop();
      else if (!cameraError) cam.start().catch(() => {});
    }
    document.addEventListener('visibilitychange', stopOnHide);
    return () => {
      cancelled = true;
      cam.stop();
      document.removeEventListener('visibilitychange', stopOnHide);
    };
  }, [step, activeBookId]);

  useEffect(() => {
    const conflict = items.find((i) => i.status === 'error' && i.error === 'seq_conflict');
    if (!conflict || !activeBookId || !queueRef.current) return;
    booksApi
      .get(activeBookId)
      .then((book) => {
        setNextSeq(book.pages.next_seq);
        queueRef.current.reassignSeq(book.pages.next_seq);
      })
      .catch(() => {});
  }, [items, activeBookId]);

  // Announce pages as they finish uploading; one toast at a time, hidden after 2.5s.
  useEffect(() => {
    const seqs = newlyDone(announcedRef.current, items);
    if (seqs.length === 0) return;
    setDoneToast(`Đã tải trang ${formatPageList(seqs)} ✓`);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setDoneToast(null), 2500);
  }, [items]);
  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  useEffect(() => {
    function warnBeforeUnload(e) {
      if (queueRef.current && queueRef.current.pendingCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    // Unsent pages live only in memory: if the profile is lost meanwhile, the app keeps this view
    // mounted under the picker so the queue can finish after a profile is picked again.
    const unregister = registerUnsavedWork(() => Boolean(queueRef.current && queueRef.current.pendingCount > 0));
    let neededProfile = authStore.get().needsProfile;
    const unsubAuth = authStore.subscribe((s) => {
      if (neededProfile && !s.needsProfile) queueRef.current?.resumeAfterProfilePicked();
      neededProfile = s.needsProfile;
    });
    return () => {
      window.removeEventListener('beforeunload', warnBeforeUnload);
      unregister();
      unsubAuth();
    };
  }, []);

  /** Switch the voice for not-yet-voiced content. Capturing stays blocked until it succeeds or
   * the user keeps the old voice, so no page is ever voiced with a voice they did not pick. */
  async function applyPendingVoice(voice = pendingVoice) {
    if (!voice || !activeBookId) return;
    setVoiceError(null);
    try {
      await booksApi.setVoice(activeBookId, { tts_provider: voice.provider, tts_voice: voice.voice });
      setPendingVoice(null);
    } catch (err) {
      setVoiceError(err.message || 'Không đổi được giọng đọc');
    }
  }

  function keepOldVoice() {
    setPendingVoice(null);
    setVoiceError(null);
  }

  async function capture() {
    const cam = cameraRef.current;
    const queue = queueRef.current;
    if (!cam || !queue || pendingVoice) return;
    const doneOrPending = items.length;
    if (doneOrPending >= MAX_PAGES_PER_SESSION) return;
    try {
      const blob = await cam.captureFrame();
      const seq = queue.nextSeqAfter(nextSeq);
      queue.enqueue(blob, seq);
      cam.vibrate();
    } catch (err) {
      setCameraError(err instanceof CameraError ? err.message : 'Không chụp được ảnh, thử lại');
    }
  }

  async function toggleTorch() {
    const cam = cameraRef.current;
    if (!cam) return;
    const on = !torchOn;
    await cam.setTorch(on);
    setTorchOn(on);
  }

  function finish() {
    const pending = pendingPages(items);
    if (pending.length > 0 && !window.confirm(`Còn trang ${pending.join(', ')} chưa tải xong. Rời khỏi màn hình vẫn tiếp tục tải nền?`)) {
      return;
    }
    window.location.hash = `#/book/${activeBookId}`;
  }

  function retakeOrRetry(item) {
    if (item.status === 'error') queueRef.current.retry(item.uploadId);
  }

  function removeItem(item) {
    if (item.status === 'done' || item.status === 'uploading') return;
    // Async: may discard the seq server-side; the queue reports failures on the item itself.
    queueRef.current.remove(item.uploadId).catch(() => {});
  }

  const voiceOptions = orderVoices(voices);

  if (step === 'choose') {
    const defVoice = voices && voices.providers[voices.default_provider] ? voices.providers[voices.default_provider].default : null;
    const def = defVoice ? { provider: voices.default_provider, voice: defVoice } : null;
    return html`<${CaptureChooseStep} voiceOptions=${voiceOptions} defaultVoice=${def} />`;
  }

  if (step === 'confirm') {
    return html`<${CaptureConfirmStep}
      bookId=${activeBookId}
      voiceOptions=${voiceOptions}
      onStart=${(_book, voice) => {
        setPendingVoice(voice);
        setStep('camera');
      }}
    />`;
  }

  if (cameraError) {
    return html`
      <div class="capture-permission">
        <${Icon} name="alert-circle" size=${48} />
        <h2 style=${{ margin: 0 }}>Không dùng được camera</h2>
        <div class="fleuron-rule" aria-hidden="true"><i></i></div>
        <p>${cameraError}</p>
        <p class="text-muted">Cần bật quyền Camera cho trang này trong cài đặt trình duyệt, và trang phải chạy qua HTTPS.</p>
        <a class="btn btn-primary" href="#/library">Về thư viện</a>
      </div>
    `;
  }

  const doneCount = items.filter((i) => i.status === 'done').length;
  const totalShots = items.length;
  const nextPage = (queueRef.current ? queueRef.current.nextSeqAfter(nextSeq) : nextSeq + totalShots) + 1;
  const failedSeqs = items.filter((i) => i.status === 'error' && i.error !== 'seq_conflict').map((i) => i.seq);
  const atCap = totalShots >= MAX_PAGES_PER_SESSION;

  return html`
    <div class="capture-view">
      <div class="capture-video-wrap">
        <video ref=${videoRef} class="capture-video" playsinline muted></video>
        <div class="capture-frame-guide" aria-hidden="true"></div>
        <div class="capture-topbar">
          <button class="icon-btn" aria-label="Đóng camera" onClick=${finish}><${Icon} name="x" /></button>
          <span class="capture-topbar-title">
            <span class="capture-page-count">Chụp trang ${nextPage}</span>
            <span class="capture-topbar-sub">Đã tải ${doneCount}/${totalShots}</span>
          </span>
          ${supportsTorch
            ? html`<button class="icon-btn" aria-label=${torchOn ? 'Tắt đèn' : 'Bật đèn'} onClick=${toggleTorch}>
                <${Icon} name=${torchOn ? 'flashlight-off' : 'flashlight'} />
              </button>`
            : html`<span style=${{ width: '44px' }}></span>`}
        </div>
      </div>

      <div class="capture-controls">
        ${items.length > 0 && html`<${CaptureThumbStrip} items=${items} onRetry=${retakeOrRetry} onRemove=${removeItem} />`}
        ${voiceError &&
        html`<div class="banner banner-error" role="alert">
          <span>${voiceError}</span>
          <span style=${{ display: 'flex', gap: '8px' }}>
            <button class="btn btn-secondary" onClick=${() => applyPendingVoice()}>Thử lại</button>
            <button class="btn btn-ghost" style=${{ color: '#fff' }} onClick=${keepOldVoice}>Giữ giọng cũ</button>
          </span>
        </div>`}
        ${atCap && html`<p class="banner banner-info">Đã đạt giới hạn ${MAX_PAGES_PER_SESSION} trang/phiên. Bấm Xong để xử lý, rồi chụp tiếp sau.</p>`}
        <${StatusToast}
          message=${failedSeqs.length > 0 ? `Trang ${formatPageList(failedSeqs)} lỗi — chạm ảnh để thử lại` : doneToast}
          tone=${failedSeqs.length > 0 ? 'error' : 'info'}
        />
        <div class="capture-actionrow">
          <span class="capture-side-btn"></span>
          <button class="capture-shutter" aria-label="Chụp trang" onClick=${capture} disabled=${atCap || !!pendingVoice}></button>
          <button class="capture-side-btn btn btn-ghost" style=${{ color: '#fff' }} onClick=${finish}>Xong (${totalShots})</button>
        </div>
      </div>
    </div>
  `;
}
