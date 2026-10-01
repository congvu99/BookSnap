// Listen mode of ReaderView: the record slides out of its sleeve while playing, brass tonearm tracks
// the book position. Purely presentational: all state and handlers come from ReaderView, which keeps
// the single AudioPlaylist alive across listen <-> read (docs/mockups/vinyl-library-preview.html).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';
import { RangeSlider } from './range-slider.js';
import { RecordSleeve } from './record-sleeve.js';
import { VinylDisc } from './vinyl-disc.js';
import { Tonearm, armAngle } from './tonearm.js';
import { formatTime } from './mini-player.js';
import { RATES } from './player-sheet.js';

/** Next playback rate in the shared RATES list (wraps around; unknown rates restart at the first). */
export function nextRate(rate) {
  const i = RATES.indexOf(rate);
  return RATES[(i + 1) % RATES.length];
}

/**
 * @param {{
 *   book: {id: string, title: string, created_by_name?: string},
 *   playing: boolean, ready: boolean, statusLabel?: string|null,
 *   chunkIndex: number, chunkCount: number, excerpt: string,
 *   currentAbsoluteMs: number, totalDurationMs: number, rate: number,
 *   onTogglePlay: () => void, onSeekBack: () => void, onSeekForward: () => void,
 *   onSeekAbsolute: (ms:number) => void, onSetRate: (r:number) => void, onOpenSheet: () => void,
 *   readHref: string, bookmarkSlot?: any, pageText?: string|null, onOpenPages?: () => void,
 *   buffering?: boolean,
 * }} props
 * bookmarkSlot: optional vnode rendered as the last chip (reserved for the bookmark toggle).
 * pageText: "X/N" of the page being heard; without it the eyebrow falls back to chunk numbers.
 */
export function NowPlayingPanel({
  book,
  playing,
  ready,
  statusLabel,
  chunkIndex,
  chunkCount,
  excerpt,
  currentAbsoluteMs,
  totalDurationMs,
  rate,
  onTogglePlay,
  onSeekBack,
  onSeekForward,
  onSeekAbsolute,
  onSetRate,
  onOpenSheet,
  readHref,
  bookmarkSlot,
  pageText,
  onOpenPages,
  buffering = false,
}) {
  // Finger position while scrubbing: labels preview it, the audio only seeks on release.
  const [previewMs, setPreviewMs] = useState(/** @type {number|null} */ (null));
  const progress = totalDurationMs > 0 ? Math.min(1, Math.max(0, currentAbsoluteMs / totalDurationMs)) : 0;
  const pct = progress * 100;

  return html`
    <section class="now-playing ${playing ? 'is-playing' : ''}" aria-label="Đang nghe">
      <div class="np-top">
        <a class="icon-btn" href="#/library" aria-label="Về thư viện"><${Icon} name="chevron-left" /></a>
        <p class="np-eyebrow">Đang nghe</p>
        <button class="icon-btn" aria-label="Tuỳ chọn" onClick=${onOpenSheet}><${Icon} name="settings" /></button>
      </div>

      <div class="stage" role="img" aria-label=${`Đĩa than ${book.title}`}>
        <div class="stage-disc"><${VinylDisc} book=${book} detailed spinning=${playing} /></div>
        <div class="stage-sleeve"><${RecordSleeve} book=${book} /></div>
        <${Tonearm} angle=${armAngle(playing, progress)} />
        <div class="stage-floor"></div>
      </div>

      <div class="np-body">
        <p class="np-eyebrow">
          Mặt A${pageText
            ? html` · <button class="np-page-btn" aria-label=${`Đang ở trang ${pageText.replace('/', ' trên ')}, chọn trang`} onClick=${onOpenPages}>Trang ${pageText}</button>`
            : chunkCount > 0 ? ` · Đoạn ${chunkIndex + 1}/${chunkCount}` : ''}
        </p>
        <h1 class="np-title">${book.title}</h1>
        ${book.created_by_name && html`<p class="np-by">Chụp bởi ${book.created_by_name}</p>`}
        ${statusLabel && html`<p class="np-status"><${Icon} name="clock" size=${14} /> ${statusLabel}</p>`}
        ${excerpt && html`<p class="np-excerpt">${excerpt}</p>`}

        <${RangeSlider}
          className="np-seek"
          min=${0}
          max=${1000}
          value=${Math.round(pct * 10)}
          label="Tiến độ sách"
          valueText=${(v) => `${formatTime((v / 1000) * totalDurationMs)} trên ${formatTime(totalDurationMs)}`}
          bubble=${(v) => `${formatTime((v / 1000) * totalDurationMs)} / ${formatTime(totalDurationMs)}`}
          onScrub=${(v) => setPreviewMs((v / 1000) * totalDurationMs)}
          onCommit=${(v) => {
            onSeekAbsolute((v / 1000) * totalDurationMs);
            setPreviewMs(null);
          }}
        />
        <div class="np-times"><span>${formatTime(previewMs ?? currentAbsoluteMs)}</span><span>${formatTime(totalDurationMs)}</span></div>

        <div class="np-transport">
          <button class="np-skip" aria-label="Lùi 15 giây" onClick=${onSeekBack}><${Icon} name="rotate-ccw" size=${34} /><b>15</b></button>
          <button
            class=${`np-play ${buffering ? 'is-buffering' : ''}`}
            aria-label=${playing ? 'Tạm dừng' : 'Phát'}
            aria-busy=${buffering ? 'true' : null}
            onClick=${onTogglePlay}
            disabled=${!ready}
          >
            <${Icon} name=${playing ? 'pause' : 'play'} size=${30} />
          </button>
          <button class="np-skip" aria-label="Tiến 15 giây" onClick=${onSeekForward}><${Icon} name="rotate-cw" size=${34} /><b>15</b></button>
        </div>

        <div class="np-options">
          <button class="chip" aria-label=${`Tốc độ ${rate}×`} onClick=${() => onSetRate(nextRate(rate))}>${rate}×</button>
          <button class="chip" onClick=${onOpenSheet}><${Icon} name="timer" size=${17} />Hẹn giờ</button>
          <a class="chip" href=${readHref}><${Icon} name="book-open" size=${17} />Đọc cùng</a>
          ${bookmarkSlot || null}
        </div>
      </div>
    </section>
  `;
}
