// Pure helpers for range sliders (seek bars, volume). No Preact import, so `node --test` covers them.

/**
 * Fill of a range input as a CSS percentage (0–100), for the `--fill` track gradient.
 * @param {number} value @param {number} min @param {number} max
 */
export function fillPercent(value, min, max) {
  if (!(max > min) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/**
 * Value a slider should show: the finger's position while dragging, otherwise the live value
 * (so playback time never yanks the thumb out from under a drag).
 * @param {number|null} dragValue @param {number} liveValue
 */
export function shownValue(dragValue, liveValue) {
  return dragValue === null || dragValue === undefined ? liveValue : dragValue;
}
