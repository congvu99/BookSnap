// Mini player dính đáy: play/pause 56px, ±15s, thanh tiến độ toàn sách, thời gian tabular (§6.3).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { RangeSlider } from './range-slider.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';

export function formatTime(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * @param {{
 *   book: {id: string, title: string}, listenHref: string, playing: boolean, ready: boolean, statusLabel?: string,
 *   currentAbsoluteMs: number, totalDurationMs: number,
 *   onTogglePlay: () => void, onSeekBack: () => void, onSeekForward: () => void,
 *   onSeekAbsolute: (ms:number) => void, onExpand: () => void,
 *   pageText?: string|null, onOpenPages?: () => void, buffering?: boolean,
 * }} props
 */
export function MiniPlayer({
  book,
  listenHref,
  playing,
  ready,
  statusLabel,
  currentAbsoluteMs,
  totalDurationMs,
  onTogglePlay,
  onSeekBack,
  onSeekForward,
  onSeekAbsolute,
  onExpand,
  pageText,
  onOpenPages,
  buffering = false,
}) {
  // Finger position while scrubbing: labels preview it, the audio only seeks on release.
  const [previewMs, setPreviewMs] = useState(/** @type {number|null} */ (null));
  const pct = totalDurationMs > 0 ? Math.min(100, (currentAbsoluteMs / totalDurationMs) * 100) : 0;

  return html`
    <div class="mini-player" role="region" aria-label="Trình phát">
      <${RangeSlider}
        className="mini-player-progress"
        min=${0}
        max=${1000}
        value=${Math.round(pct * 10)}
        label="Tiến độ sách"
        valueText=${(v) => `${formatTime((v / 1000) * totalDurationMs)} trên ${formatTime(totalDurationMs)}`}
        onScrub=${(v) => setPreviewMs((v / 1000) * totalDurationMs)}
        onCommit=${(v) => {
          onSeekAbsolute((v / 1000) * totalDurationMs);
          setPreviewMs(null);
        }}
      />
      <div class="mini-player-times">
        <span>${formatTime(previewMs ?? currentAbsoluteMs)}</span>
        ${pageText &&
        html`<button class="mini-page-btn" aria-label=${`Đang ở trang ${pageText.replace('/', ' trên ')}, chọn trang`} onClick=${onOpenPages}>Tr. ${pageText}</button>`}
        <span>${formatTime(totalDurationMs)}</span>
      </div>
      <div class="mini-player-row">
        <a class="mini-player-meta" href=${listenHref} aria-label=${`Mở màn đĩa than: ${book.title}`}>
          <span class="mini-art" aria-hidden="true">
            <${RecordSleeve} book=${book} />
            <${VinylDisc} book=${book} spinning=${playing} />
          </span>
          <span class="mini-player-text">
            <span class="mini-player-book">${book.title}</span>
            ${statusLabel && html`<span class="mini-player-status"><${Icon} name="clock" size=${12} /> ${statusLabel}</span>`}
          </span>
        </a>
        <div class="mini-player-controls">
          <button class="icon-btn" aria-label="Lùi 15 giây" onClick=${onSeekBack}><${Icon} name="rotate-ccw" /></button>
          <button
            class=${`mini-player-play ${buffering ? 'is-buffering' : ''}`}
            aria-label=${playing ? 'Tạm dừng' : 'Phát'}
            aria-busy=${buffering ? 'true' : null}
            onClick=${onTogglePlay}
            disabled=${!ready}
          >
            <${Icon} name=${playing ? 'pause' : 'play'} size=${28} />
          </button>
          <button class="icon-btn" aria-label="Tiến 15 giây" onClick=${onSeekForward}><${Icon} name="rotate-cw" /></button>
        </div>
        <button class="icon-btn" aria-label="Mở tuỳ chọn phát" onClick=${onExpand}><${Icon} name="chevron-down" style=${{ transform: 'rotate(180deg)' }} /></button>
      </div>
    </div>
  `;
}
