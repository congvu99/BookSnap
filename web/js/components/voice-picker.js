// Voice chooser with a ▶ preview per voice. Playback uses one shared <audio>: `play()` runs
// synchronously inside the tap so iOS keeps the user gesture; the preview URL is versioned
// (`?v=`) and served immutable, so a second play comes straight from the HTTP cache.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { voicesApi } from '../api-client.js';
import { previewErrorMessage } from '../voice-labels.js';
import { Icon } from '../icons.js';

const keyOf = (o) => `${o.provider}::${o.voice}`;

/**
 * @param {{
 *   options: ReturnType<typeof import('../voice-labels.js').orderVoices>,
 *   value: {provider: string, voice: string} | null,
 *   onChange?: (v: {provider: string, voice: string}) => void,
 *   readOnly?: boolean,
 * }} props
 */
export function VoicePicker({ options, value, onChange, readOnly = false }) {
  const audioRef = useRef(/** @type {HTMLAudioElement|null} */ (null));
  const [preview, setPreview] = useState(/** @type {{key: string, state: 'loading'|'playing'} | null} */ (null));
  const [error, setError] = useState(/** @type {{key: string, message: string} | null} */ (null));

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'none';
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  function stop() {
    const audio = audioRef.current;
    if (audio) audio.pause();
    setPreview(null);
  }

  function play(option) {
    const audio = audioRef.current;
    if (!audio || !option.previewUrl) return;
    const key = keyOf(option);
    if (preview && preview.key === key) {
      stop();
      return;
    }
    setError(null);
    setPreview({ key, state: 'loading' });
    audio.onplaying = () => setPreview({ key, state: 'playing' });
    audio.onended = () => setPreview((p) => (p && p.key === key ? null : p));
    audio.onerror = async () => {
      setPreview((p) => (p && p.key === key ? null : p));
      const code = await voicesApi.previewErrorCode(option.previewUrl);
      setError({ key, message: previewErrorMessage(code || 'unknown_error') });
    };
    audio.src = option.previewUrl;
    audio.play().catch((err) => {
      // NotAllowedError: the browser dropped the gesture; AbortError: another chip was tapped.
      if (err && err.name === 'NotAllowedError') {
        setPreview(null);
        setError({ key, message: 'Chạm lần nữa để nghe' });
      }
    });
  }

  const selectedKey = value ? `${value.provider}::${value.voice}` : null;

  return html`
    <div class="voice-picker" role="radiogroup" aria-label="Giọng đọc">
      ${options.map((o) => {
        const key = keyOf(o);
        const selected = key === selectedKey;
        const state = preview && preview.key === key ? preview.state : null;
        const disabled = !o.configured;
        return html`
          <div class="voice-chip ${selected ? 'voice-chip--selected' : ''} ${disabled ? 'voice-chip--disabled' : ''}" key=${key}>
            <button
              type="button"
              class="voice-chip-select"
              role="radio"
              aria-checked=${selected}
              disabled=${disabled || (readOnly && !selected)}
              onClick=${() => !readOnly && onChange && onChange({ provider: o.provider, voice: o.voice })}
            >
              <span class="voice-chip-label">${o.label}</span>
              <span class="voice-chip-name">${disabled ? 'Chưa cấu hình' : o.voice}</span>
            </button>
            ${o.previewUrl && !disabled &&
            html`<button
              type="button"
              class="voice-chip-play"
              aria-label=${state ? `Dừng nghe thử ${o.label}` : `Nghe thử giọng ${o.label}`}
              onClick=${() => play(o)}
            >
              ${state === 'loading'
                ? html`<span class="spinner" aria-hidden="true"></span>`
                : html`<${Icon} name=${state === 'playing' ? 'pause' : 'play'} size=${16} />`}
            </button>`}
            ${error && error.key === key && html`<span class="voice-chip-error" role="status">${error.message}</span>`}
          </div>
        `;
      })}
    </div>
  `;
}
