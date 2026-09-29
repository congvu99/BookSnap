// Capture step 1 (no book yet): create a new book with a voice, or pick an existing one.
// Picking an existing book routes to #/capture/:id, which opens the confirm step.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { booksApi } from '../api-client.js';
import { TopicInput } from '../components/topic-input.js';
import { OrnateFrame } from '../components/ornate-frame.js';
import { VoicePicker } from '../components/voice-picker.js';

/**
 * @param {{ voiceOptions: any[], defaultVoice: {provider: string, voice: string} | null }} props
 */
export function CaptureChooseStep({ voiceOptions, defaultVoice }) {
  const [books, setBooks] = useState(/** @type {any[]} */ ([]));
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [voice, setVoice] = useState(defaultVoice);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  useEffect(() => {
    booksApi.list().then(setBooks).catch(() => setBooks([]));
  }, []);

  useEffect(() => {
    if (!voice && defaultVoice) setVoice(defaultVoice);
  }, [defaultVoice]);

  async function create(ev) {
    ev.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setError(null);
    setBusy(true);
    try {
      const body = { title: name, topic: topic.trim() || null };
      if (voice) Object.assign(body, { tts_provider: voice.provider, tts_voice: voice.voice });
      const book = await booksApi.create(body);
      window.location.hash = `#/capture/${book.id}?start=1`;
    } catch (err) {
      setError(err.message || 'Không tạo được sách');
      setBusy(false);
    }
  }

  return html`
    <div class="container">
      <h1 style=${{ marginBottom: 0 }}>Chụp trang sách</h1>
      <div class="fleuron-rule" aria-hidden="true"><i></i></div>
      ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
      <${OrnateFrame} as="form" onSubmit=${create} className="card" style=${{ marginBottom: '24px' }}>
        <div class="field">
          <label for="new-title">Sách mới</label>
          <input id="new-title" placeholder="Tên sách" value=${title} onInput=${(e) => setTitle(e.currentTarget.value)} />
        </div>
        <${TopicInput} id="new-topic" value=${topic} onInput=${setTopic} />
        ${voiceOptions.length > 0 &&
        html`
          <div class="field">
            <span class="field-label" id="new-voice-label">Giọng đọc</span>
            <${VoicePicker} options=${voiceOptions} value=${voice} onChange=${setVoice} />
          </div>
        `}
        <p class="voice-change-note">Mỗi ảnh là 1 trang — chụp lần lượt từng trang.</p>
        <button type="submit" class="btn btn-primary btn-block" disabled=${!title.trim() || busy}>
          ${busy ? html`<span class="spinner" aria-hidden="true"></span> Đang tạo…` : 'Bắt đầu chụp'}
        </button>
      <//>
      ${books.length > 0 &&
      html`
        <h2 class="section-heading">Thêm vào sách có sẵn</h2>
        <ul style=${{ listStyle: 'none', padding: 0 }}>
          ${books.map(
            (b) => html`
              <li key=${b.id}>
                <a class="btn btn-secondary btn-block" style=${{ marginBottom: '8px', justifyContent: 'space-between' }} href=${`#/capture/${b.id}`}>
                  <span class="book-picker-title">${b.title}</span>
                </a>
              </li>
            `
          )}
        </ul>
      `}
      <a class="btn btn-ghost btn-block" href="#/library">Huỷ</a>
    </div>
  `;
}
