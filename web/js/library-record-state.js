// Which picture a library record shows in place of a status line. Pure, so it runs under `node --test`.

/** @typedef {'fresh'|'listening'|'done'|'ocr'|'pressing'|'quota'|'tail'|'failed'|'empty'} RecordKind */

/** Busy/blocked phases from processing-progress.js phaseOf(); 'processing' is book.state on offline copies. */
const KIND_BY_PHASE = Object.freeze({
  failed: 'failed',
  quota: 'quota',
  tail_wait: 'tail',
  ocr: 'ocr',
  tts: 'pressing',
  processing: 'pressing',
  empty: 'empty',
});

/**
 * @param {string} phase stateInfo(book).phase
 * @param {number} listenedPercent 0-100, progressPercent(book)
 * @returns {RecordKind}
 */
export function recordKind(phase, listenedPercent) {
  if (phase !== 'ready') return KIND_BY_PHASE[phase] || 'empty';
  if (listenedPercent >= 100) return 'done';
  return listenedPercent > 0 ? 'listening' : 'fresh';
}

/** Kinds whose book can be played right away. @param {RecordKind} kind */
export function isPlayableKind(kind) {
  return kind === 'fresh' || kind === 'listening' || kind === 'done';
}

/** Accessible text for metadata represented visually by the creator avatar and record artwork. */
export function spokenRecordStatus(creatorName, detail) {
  return [creatorName ? `Chụp bởi ${creatorName}` : '', detail || ''].filter(Boolean).join(' · ');
}
