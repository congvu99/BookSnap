// Sheet mở rộng: tốc độ, hẹn giờ tắt, cỡ chữ, sáng/tối, tải offline, cài đặt sách (chủ sách).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { setTheme } from '../store.js';
import { TopicInput } from './topic-input.js';

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP_OPTIONS = [
  { label: 'Tắt', value: null },
  { label: '10 phút', value: 10 },
  { label: '20 phút', value: 20 },
  { label: '30 phút', value: 30 },
];
const FONT_SIZES = [16, 18, 20, 22, 24];

/**
 * @param {{
 *   rate:number, onSetRate:(r:number)=>void,
 *   fontSize:number, onSetFontSize:(s:number)=>void,
 *   theme:string, sleepMinutes:number|null, onSetSleep:(m:number|null)=>void,
 *   downloadState:{status:string, done:number, total:number}, onDownload:()=>void,
 *   canManage:boolean, book:object, voices:object|null,
 *   onChangeVoice:(provider:string, voice:string)=>void, onChangeTopic:(name:string)=>Promise<boolean>, onDelete:()=>void, exportUrl:string,
 *   onClose:()=>void,
 * }} props
 */
export function PlayerSheet(props) {
  const { rate, onSetRate, fontSize, onSetFontSize, sleepMinutes, onSetSleep, downloadState, onDownload, canManage, book, voices, onChangeVoice, onChangeTopic, onDelete, exportUrl, onClose } = props;
  const savedTopic = book.topic ? book.topic.name : '';
  const [topicDraft, setTopicDraft] = useState(savedTopic);
  // Show the server's spelling after a save ("VĂN HỌC" → "Văn học").
  useEffect(() => setTopicDraft(savedTopic), [savedTopic]);

  async function commitTopic(value) {
    if (value.trim() === savedTopic) return;
    if (!(await onChangeTopic(value.trim()))) setTopicDraft(savedTopic);
  }

  function close() {
    if (canManage) commitTopic(topicDraft);
    onClose();
  }
  const [confirmVoice, setConfirmVoice] = useState(/** @type {string|null} */ (null));
  const theme = props.theme;

  function pickVoice(key) {
    const [provider, voice] = key.split('::');
    setConfirmVoice(key);
    if (window.confirm('Đổi giọng sẽ sinh lại audio cho TOÀN BỘ sách. Tiếp tục?')) {
      onChangeVoice(provider, voice);
    }
    setConfirmVoice(null);
  }

  return html`
    <div class="player-sheet-backdrop" onClick=${close}></div>
    <div class="player-sheet" role="dialog" aria-label="Tuỳ chọn phát">
      <div class="player-sheet-handle"></div>

      <div class="player-sheet-section">
        <h3>Tốc độ</h3>
        <div class="chip-row">
          ${RATES.map((r) => html`<button class="chip" aria-pressed=${String(r === rate)} onClick=${() => onSetRate(r)}>${r}×</button>`)}
        </div>
      </div>

      <div class="player-sheet-section">
        <h3>Hẹn giờ tắt</h3>
        <div class="chip-row">
          ${SLEEP_OPTIONS.map(
            (o) => html`<button class="chip" aria-pressed=${String(sleepMinutes === o.value)} onClick=${() => onSetSleep(o.value)}>${o.label}</button>`
          )}
        </div>
      </div>

      <div class="player-sheet-section">
        <h3>Cỡ chữ</h3>
        <div class="chip-row">
          ${FONT_SIZES.map((s) => html`<button class="chip" aria-pressed=${String(s === fontSize)} onClick=${() => onSetFontSize(s)}>${s}</button>`)}
        </div>
      </div>

      <div class="player-sheet-section">
        <h3>Giao diện</h3>
        <div class="chip-row">
          <button class="chip" aria-pressed=${String(theme === 'light')} onClick=${() => setTheme('light')}><${Icon} name="sun" size=${16} /> Sáng</button>
          <button class="chip" aria-pressed=${String(theme === 'dark')} onClick=${() => setTheme('dark')}><${Icon} name="moon" size=${16} /> Tối</button>
          <button class="chip" aria-pressed=${String(theme === 'auto')} onClick=${() => setTheme('auto')}>Theo máy</button>
        </div>
      </div>

      <div class="player-sheet-section">
        <h3>Nghe offline</h3>
        <button class="btn btn-secondary btn-block" onClick=${onDownload} disabled=${downloadState.status === 'downloading'}>
          <${Icon} name="download" size=${16} />
          ${downloadState.status === 'downloading'
            ? `Đang tải ${downloadState.done}/${downloadState.total}…`
            : downloadState.status === 'done'
              ? 'Đã tải để nghe offline'
              : 'Tải để nghe offline'}
        </button>
      </div>

      ${canManage &&
      html`
        <div class="player-sheet-section">
          <h3>Cài đặt sách</h3>
          <${TopicInput}
            id="book-topic"
            value=${topicDraft}
            onInput=${setTopicDraft}
            onCommit=${commitTopic}
          />
          ${voices &&
          html`
            <div class="field">
              <label for="voice-select">Giọng đọc (đổi sẽ sinh lại cả sách)</label>
              <select id="voice-select" value=${`${book.tts_provider}::${book.tts_voice}`} onChange=${(e) => pickVoice(e.currentTarget.value)}>
                ${Object.entries(voices.providers).flatMap(([provider, info]) =>
                  info.voices.map((v) => html`<option value=${`${provider}::${v}`} key=${`${provider}-${v}`}>${provider} — ${v}</option>`)
                )}
              </select>
            </div>
          `}
          <div class="book-settings-row">
            <span>Tải bản sao (ZIP)</span>
            <a class="btn btn-secondary" href=${exportUrl}>Tải</a>
          </div>
          <div class="book-settings-row">
            <span>Xoá sách</span>
            <button class="btn btn-danger" onClick=${onDelete}><${Icon} name="trash" size=${16} /> Xoá</button>
          </div>
        </div>
      `}
    </div>
  `;
}
