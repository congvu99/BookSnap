// Capture step before the camera for an existing book (from the list, "Thêm trang", or a link):
// shows the voice the new pages will be read with. A different voice is only *proposed* here;
// the capture view applies it once the camera is actually running.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { OrnateFrame } from '../components/ornate-frame.js';
import { VoicePicker } from '../components/voice-picker.js';
import { voiceLabel } from '../voice-labels.js';

/**
 * @param {{
 *   bookId: string,
 *   voiceOptions: any[],
 *   onStart: (book: any, voice: {provider: string, voice: string} | null) => void,
 * }} props onStart receives the voice only when it differs from the book's current one.
 */
export function CaptureConfirmStep({ bookId, voiceOptions, onStart }) {
  const [book, setBook] = useState(/** @type {any|null} */ (null));
  const [voice, setVoice] = useState(/** @type {{provider: string, voice: string} | null} */ (null));
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    let cancelled = false;
    booksApi
      .get(bookId)
      .then((b) => {
        if (cancelled) return;
        setBook(b);
        setVoice({ provider: b.tts_provider, voice: b.tts_voice });
      })
      .catch((err) => !cancelled && setError(err.message || 'Không tải được sách'));
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  if (error) {
    return html`<div class="container"><div class="banner banner-error" role="alert">${error}</div><a class="btn btn-ghost btn-block" href="#/library">Về thư viện</a></div>`;
  }
  if (!book || !voice) {
    return html`<div class="container"><div class="skeleton" style=${{ height: '240px' }}></div></div>`;
  }

  const changed = voice.provider !== book.tts_provider || voice.voice !== book.tts_voice;
  // A voice missing from the picker (e.g. set by an older config) is still shown as current.
  const options = voiceOptions.some((o) => o.provider === book.tts_provider && o.voice === book.tts_voice)
    ? voiceOptions
    : [{ provider: book.tts_provider, voice: book.tts_voice, label: voiceLabel(book.tts_voice), isDefault: false, configured: true, previewUrl: null }, ...voiceOptions];

  return html`
    <div class="container">
      <h1 style=${{ marginBottom: 0 }}>${book.title}</h1>
      <div class="fleuron-rule" aria-hidden="true"><i></i></div>
      <${OrnateFrame} className="card" style=${{ marginBottom: '24px' }}>
        <p class="text-muted" style=${{ marginTop: 0 }}>
          Đã có ${book.pages.total} trang. Mỗi ảnh là 1 trang — chụp tiếp từ trang ${book.pages.next_seq + 1}.
        </p>
        <span class="field-label">Giọng đọc</span>
        <${VoicePicker} options=${options} value=${voice} onChange=${setVoice} readOnly=${!book.can_manage} />
        ${!book.can_manage && html`<p class="voice-change-note">Chỉ người tạo sách đổi được giọng.</p>`}
        ${changed &&
        html`<p class="voice-change-note" role="status">
          Các đoạn chưa có audio (gồm trang mới) sẽ đọc bằng giọng ${voiceLabel(voice.voice)}; các đoạn đã có audio giữ giọng
          ${' '}${voiceLabel(book.tts_voice)}.
        </p>`}
        <button type="button" class="btn btn-primary btn-block" onClick=${() => onStart(book, changed ? voice : null)}>Bắt đầu chụp</button>
      <//>
      <a class="btn btn-ghost btn-block" href=${`#/book/${book.id}`}>Huỷ</a>
    </div>
  `;
}
