// Range input that stays smooth under the finger: while dragging it shows the finger's position
// (live updates such as playback time can't yank the thumb), reports each step via `onScrub`
// (cheap previews: time label, volume) and fires `onCommit` once on release (seek, persist).
// After release it keeps showing the committed value until the live value catches up, so the
// thumb doesn't flash back to the old position while the seek lands.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { fillPercent, shownValue } from '../scrub-math.js';

// How long a committed value is held at most while waiting for the live value to follow.
const SETTLE_MS = 800;

/**
 * @param {{ value: number, min?: number, max: number, step?: number|string, className: string,
 *   label: string, valueText?: (v: number) => string, onScrub?: (v: number) => void,
 *   onCommit: (v: number) => void, disabled?: boolean }} props
 */
export function RangeSlider({ value, min = 0, max, step = 1, className, label, valueText, onScrub, onCommit, disabled = false }) {
  const [dragValue, setDragValue] = useState(/** @type {number|null} */ (null));
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(/** @type {number|null} */ (null));
  const settleTimer = useRef(/** @type {any} */ (0));
  const shown = shownValue(dragValue, value);

  // Release the held value once the live value is within a step (or two) of it.
  useEffect(() => {
    if (dragValue === null || dragRef.current !== null) return;
    const tolerance = Math.max(Number(step) || 1, (max - min) / 200);
    if (Math.abs(value - dragValue) <= tolerance) setDragValue(null);
  }, [value]);

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  function move(e) {
    const v = Number(e.currentTarget.value);
    clearTimeout(settleTimer.current);
    dragRef.current = v;
    setDragging(true);
    setDragValue(v);
    if (onScrub) onScrub(v);
  }

  function release() {
    const v = dragRef.current;
    if (v === null) return;
    dragRef.current = null;
    setDragging(false);
    onCommit(v);
    // Keep `dragValue` (= v) shown until the live value follows, with a safety timeout.
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setDragValue(null), SETTLE_MS);
  }

  return html`
    <input
      type="range"
      class=${`range ${className} ${dragging ? 'is-dragging' : ''}`}
      style=${{ '--fill': `${fillPercent(shown, min, max)}%` }}
      min=${min}
      max=${max}
      step=${step}
      value=${shown}
      disabled=${disabled}
      aria-label=${label}
      aria-valuetext=${valueText ? valueText(shown) : null}
      onInput=${move}
      onChange=${release}
      onPointerUp=${release}
      onPointerCancel=${release}
      onKeyUp=${release}
      onBlur=${release}
    />
  `;
}
