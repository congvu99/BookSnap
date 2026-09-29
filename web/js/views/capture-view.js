// Chụp liên tiếp nhiều trang (§6.1). Ảnh chỉ trong RAM; getUserMedia only (D3), never <input capture>.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { CameraCapture, CameraError } from '../camera-capture.js';
import { MAX_PAGES_PER_SESSION, UploadQueue } from '../upload-queue.js';
import { Icon } from '../icons.js';
import { TopicInput } from '../components/topic-input.js';
import { OrnateFrame } from '../components/ornate-frame.js';

/** @param {{ bookId?: string }} props */
export function CaptureView({ bookId }) {
  const [step, setStep] = useState(bookId ? 'camera' : 'choose');
  const [books, setBooks] = useState(/** @type {any[]} */ ([]));
  const [newTitle, setNewTitle] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [chooseError, setChooseError] = useState(/** @type {string|null} */ (null));
  const [activeBookId, setActiveBookId] = useState(bookId || null);
  const [nextSeq, setNextSeq] = useState(0);
  const [items, setItems] = useState(/** @type {any[]} */ ([]));
  const [torchOn, setTorchOn] = useState(false);
  const [supportsTorch, setSupportsTorch] = useState(false);
  const [cameraError, setCameraError] = useState(/** @type {string|null} */ (null));
  const videoRef = useRef(/** @type {HTMLVideoElement|null} */ (null));
  const cameraRef = useRef(/** @type {CameraCapture|null} */ (null));
  const queueRef = useRef(/** @type {UploadQueue|null} */ (null));

  useEffect(() => {
    if (step === 'choose') {
      booksApi.list().then(setBooks).catch(() => setBooks([]));
    }
  }, [step]);

  useEffect(() => {
    if (step !== 'camera' || !activeBookId) return undefined;
    let cancelled = false;
    booksApi
      .get(activeBookId)
      .then((book) => {
        if (cancelled) return;
        setNextSeq(book.pages.next_seq);
        queueRef.current = new UploadQueue(activeBookId, (its) => !cancelled && setItems(its));
      })
      .catch((err) => !cancelled && setCameraError(err.message));

    const cam = new CameraCapture(videoRef.current);
    cameraRef.current = cam;
    cam
      .start()
      .then(() => setSupportsTorch(cam.supportsTorch()))
      .catch((err) => setCameraError(err instanceof CameraError ? err.message : 'Không mở được camera'));

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

  useEffect(() => {
    function warnBeforeUnload(e) {
      if (queueRef.current && queueRef.current.pendingCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, []);

  async function startWithNewBook(ev) {
    ev.preventDefault();
    setChooseError(null);
    const title = newTitle.trim();
    if (!title) return;
    try {
      const book = await booksApi.create({ title, topic: newTopic.trim() || null });
      setActiveBookId(book.id);
      setStep('camera');
      window.location.hash = `#/capture/${book.id}`;
    } catch (err) {
      setChooseError(err.message || 'Không tạo được sách');
    }
  }

  function chooseExisting(id) {
    setActiveBookId(id);
    setStep('camera');
    window.location.hash = `#/capture/${id}`;
  }

  async function capture() {
    const cam = cameraRef.current;
    const queue = queueRef.current;
    if (!cam || !queue) return;
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
    const pending = queueRef.current ? queueRef.current.pendingCount : 0;
    if (pending > 0 && !window.confirm(`Còn ${pending} trang chưa tải xong. Rời khỏi màn hình vẫn tiếp tục tải nền?`)) {
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

  if (step === 'choose') {
    return html`
      <div class="container">
        <h1 style=${{ marginBottom: 0 }}>Chụp trang sách</h1>
        <div class="fleuron-rule" aria-hidden="true"><i></i></div>
        ${chooseError && html`<div class="banner banner-error" role="alert">${chooseError}</div>`}
        <${OrnateFrame} as="form" onSubmit=${startWithNewBook} className="card" style=${{ marginBottom: '24px' }}>
          <div class="field">
            <label for="new-title">Sách mới</label>
            <input id="new-title" placeholder="Tên sách" value=${newTitle} onInput=${(e) => setNewTitle(e.currentTarget.value)} />
          </div>
          <${TopicInput} id="new-topic" value=${newTopic} onInput=${setNewTopic} />
          <button type="submit" class="btn btn-primary btn-block" disabled=${!newTitle.trim()}>Bắt đầu chụp</button>
        <//>
        ${books.length > 0 &&
        html`
          <h2 class="section-heading">Thêm vào sách có sẵn</h2>
          <ul style=${{ listStyle: 'none', padding: 0 }}>
            ${books.map(
              (b) => html`
                <li key=${b.id}>
                  <button class="btn btn-secondary btn-block" style=${{ marginBottom: '8px', justifyContent: 'space-between' }} onClick=${() => chooseExisting(b.id)}>
                    <span>${b.title}</span>
                  </button>
                </li>
              `
            )}
          </ul>
        `}
        <a class="btn btn-ghost btn-block" href="#/library">Huỷ</a>
      </div>
    `;
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
  const atCap = totalShots >= MAX_PAGES_PER_SESSION;

  return html`
    <div class="capture-view">
      <div class="capture-video-wrap">
        <video ref=${videoRef} class="capture-video" playsinline muted></video>
        <div class="capture-frame-guide" aria-hidden="true"></div>
        <div class="capture-topbar">
          <button class="icon-btn" aria-label="Đóng camera" onClick=${finish}><${Icon} name="x" /></button>
          <span class="capture-page-count">Trang ${(queueRef.current ? queueRef.current.nextSeqAfter(nextSeq) : nextSeq + totalShots) + 1}</span>
          ${supportsTorch
            ? html`<button class="icon-btn" aria-label=${torchOn ? 'Tắt đèn' : 'Bật đèn'} onClick=${toggleTorch}>
                <${Icon} name=${torchOn ? 'flashlight-off' : 'flashlight'} />
              </button>`
            : html`<span style=${{ width: '44px' }}></span>`}
        </div>
      </div>

      <div class="capture-controls">
        ${items.length > 0 &&
        (() => {
          const blockIndex = items.findIndex((i) => i.status === 'error');
          return html`
          <div class="capture-thumbs">
            ${items.map((item, idx) => {
              const blocked = blockIndex !== -1 && idx > blockIndex && item.status === 'queued';
              return html`
                <div class="capture-thumb" key=${item.uploadId} onClick=${() => retakeOrRetry(item)}>
                  <img src=${item.objectUrl} alt="Trang ${item.seq + 1}" />
                  ${item.status !== 'done' &&
                  html`<div class="capture-thumb-status capture-thumb-status--${item.status === 'error' ? 'error' : ''}">
                    ${item.status === 'uploading' && 'Đang tải…'}
                    ${item.status === 'queued' && !blocked && 'Chờ…'}
                    ${blocked && 'Đang chờ trang trước'}
                    ${item.status === 'error' && 'Lỗi, chạm để thử lại'}
                  </div>`}
                  ${item.status !== 'uploading' &&
                  html`<button class="capture-thumb-remove" aria-label="Xoá trang ${item.seq + 1}" onClick=${(e) => { e.stopPropagation(); removeItem(item); }}>
                    <${Icon} name="x" size=${12} />
                  </button>`}
                </div>
              `;
            })}
          </div>
        `;
        })()}
        ${atCap && html`<p class="banner banner-info">Đã đạt giới hạn ${MAX_PAGES_PER_SESSION} trang/phiên. Bấm Xong để xử lý, rồi chụp tiếp sau.</p>`}
        <div class="capture-actionrow">
          <span class="capture-side-btn"></span>
          <button class="capture-shutter" aria-label="Chụp trang" onClick=${capture} disabled=${atCap}></button>
          <button class="capture-side-btn btn btn-ghost" style=${{ color: '#fff' }} onClick=${finish}>Xong (${totalShots})</button>
        </div>
      </div>
    </div>
  `;
}
