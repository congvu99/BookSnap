// Web Audio plumbing for the background-music element: element → GainNode → speakers. iOS Safari
// ignores HTMLMediaElement.volume, so this gain stage is the only working volume control there.

export const AudioCtx = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : undefined;

/**
 * Build the whole graph or nothing: the context is only returned once every node is wired, so a
 * half-built graph can never let the element play unattenuated.
 * @param {HTMLAudioElement} el
 * @returns {{ctx: AudioContext, gain: GainNode}}
 */
export function createGainGraph(el) {
  const ctx = new AudioCtx();
  try {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    ctx.createMediaElementSource(el).connect(gain).connect(ctx.destination);
    return { ctx, gain };
  } catch (err) {
    ctx.close().catch(() => {});
    throw err;
  }
}

let silenceUrl = null;
/**
 * 10ms of silent 16-bit mono WAV as a blob: URL. Played on the music element inside a tap before
 * the real file has arrived, so iOS lets the later, non-gesture play() through.
 */
export function silentClipUrl() {
  if (silenceUrl) return silenceUrl;
  const samples = 441;
  const buf = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (at, text) => [...text].forEach((ch, i) => buf.setUint8(at + i, ch.charCodeAt(0)));
  ascii(0, 'RIFF');
  buf.setUint32(4, 36 + samples * 2, true);
  ascii(8, 'WAVEfmt ');
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); // PCM
  buf.setUint16(22, 1, true); // mono
  buf.setUint32(24, 44100, true);
  buf.setUint32(28, 88200, true);
  buf.setUint16(32, 2, true);
  buf.setUint16(34, 16, true);
  ascii(36, 'data');
  buf.setUint32(40, samples * 2, true);
  silenceUrl = URL.createObjectURL(new Blob([buf.buffer], { type: 'audio/wav' }));
  return silenceUrl;
}

/**
 * Ramp linearly from wherever the gain is right now (mid-fade included) to `target`.
 * @param {AudioContext} ctx @param {GainNode} gain @param {number} target @param {number} seconds
 */
export function rampGain(ctx, gain, target, seconds) {
  const g = gain.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  if (seconds > 0) g.linearRampToValueAtTime(target, now + seconds);
  else g.setValueAtTime(target, now);
}
