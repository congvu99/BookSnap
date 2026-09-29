// Mini player dính đáy: play/pause 56px, ±15s, thanh tiến độ toàn sách, thời gian tabular (§6.3).
import { html } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

function formatTime(ms) {
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
 *   bookTitle: string, playing: boolean, ready: boolean, statusLabel?: string,
 *   currentAbsoluteMs: number, totalDurationMs: number,
 *   onTogglePlay: () => void, onSeekBack: () => void, onSeekForward: () => void,
 *   onSeekAbsolute: (ms:number) => void, onExpand: () => void,
 * }} props
 */
export function MiniPlayer({
  bookTitle,
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
}) {
  const pct = totalDurationMs > 0 ? Math.min(100, (currentAbsoluteMs / totalDurationMs) * 100) : 0;

  return html`
    <div class="mini-player" role="region" aria-label="Trình phát">
      <input
        type="range"
        class="mini-player-progress"
        min="0"
        max="1000"
        value=${Math.round(pct * 10)}
        aria-label="Tiến độ sách"
        aria-valuenow=${Math.round(pct)}
        onInput=${(e) => onSeekAbsolute((Number(e.currentTarget.value) / 1000) * totalDurationMs)}
      />
      <div class="mini-player-times">
        <span>${formatTime(currentAbsoluteMs)}</span>
        <span>${formatTime(totalDurationMs)}</span>
      </div>
      <div class="mini-player-row">
        <div class="mini-player-meta" onClick=${onExpand} style=${{ cursor: 'pointer' }}>
          <div class="mini-player-book">${bookTitle}</div>
          ${statusLabel && html`<div class="mini-player-status"><${Icon} name="clock" size=${12} /> ${statusLabel}</div>`}
        </div>
        <div class="mini-player-controls">
          <button class="icon-btn" aria-label="Lùi 15 giây" onClick=${onSeekBack}><${Icon} name="rotate-ccw" /></button>
          <button class="mini-player-play" aria-label=${playing ? 'Tạm dừng' : 'Phát'} onClick=${onTogglePlay} disabled=${!ready}>
            <${Icon} name=${playing ? 'pause' : 'play'} size=${28} />
          </button>
          <button class="icon-btn" aria-label="Tiến 15 giây" onClick=${onSeekForward}><${Icon} name="rotate-cw" /></button>
        </div>
        <button class="icon-btn" aria-label="Mở tuỳ chọn phát" onClick=${onExpand}><${Icon} name="chevron-down" style=${{ transform: 'rotate(180deg)' }} /></button>
      </div>
    </div>
  `;
}
