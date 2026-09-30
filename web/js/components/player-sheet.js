// Sheet mở rộng: tốc độ, hẹn giờ tắt, nhạc nền, cỡ chữ, sáng/tối, tải offline, cài đặt sách (chủ sách).
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { setTheme } from '../store.js';
import { TopicInput } from './topic-input.js';
import { voiceLabel } from '../voice-labels.js';
import { AMBIENT_TRACKS } from '../background-music-tracks.js';
import { MAX_VOLUME } from '../background-music-prefs.js';

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
 *   musicTrack:string|null, musicVolume:number,
 *   onSetMusicTrack:(id:string|null)=>void, onSetMusicVolume:(v:number)=>void,
 *   downloadState:{status:string, done:number, total:number}, onDownload:()=>void,
 *   canManage:boolean, book:object, currentVoice:string,
 *   onChangeTopic:(name:string)=>Promise<boolean>, onDelete:()=>void, exportUrl:string,
 *   onClose:()=>void,
 * }} props
 */
export function PlayerSheet(props) {
  const { rate, onSetRate, fontSize, onSetFontSize, sleepMinutes, onSetSleep, musicTrack, musicVolume, onSetMusicTrack, onSetMusicVolume, downloadState, onDownload, canManage, book, currentVoice, onChangeTopic, onDelete, exportUrl, onClose } = props;
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
  const theme = props.theme;

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
        <h3>Nhạc nền</h3>
        <div class="chip-row">
          <button class="chip" aria-pressed=${String(musicTrack == null)} onClick=${() => onSetMusicTrack(null)}>Tắt</button>
          ${AMBIENT_TRACKS.map(
            (t) => html`<button class="chip" aria-pressed=${String(musicTrack === t.id)} onClick=${() => onSetMusicTrack(t.id)}>${t.label}</button>`
          )}
        </div>
        ${musicTrack != null &&
        html`<input
          type="range"
          class="music-volume"
          min="0"
          max=${Math.round(MAX_VOLUME * 100)}
          step="5"
          value=${Math.round(musicVolume * 100)}
          aria-label="Âm lượng nhạc nền"
          aria-valuetext=${`${Math.round(musicVolume * 100)}%`}
          onInput=${(e) => onSetMusicVolume(Number(e.currentTarget.value) / 100)}
        />`}
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

      <div class="player-sheet-section">
        <div class="book-settings-row">
          <span>Giọng đọc: ${voiceLabel(currentVoice)} <span class="text-muted">(${currentVoice})</span></span>
        </div>
        <p class="voice-change-note">Đổi giọng khi thêm trang mới — áp dụng cho các đoạn chưa có audio.</p>
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
