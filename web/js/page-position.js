// Page ↔ playback position, from the server's page anchors (GET /api/books/:id/page-anchors).
// An anchor says where a captured page starts: chunk seq + fraction of that chunk's text. Audio
// time inside a chunk is estimated linearly from that fraction (TTS reads at a near-even pace).
// Pure module (no Preact) so it runs under `node --test`.

/** Seeking to a page starts this much earlier, so its first words are not clipped by the estimate. */
export const PAGE_LEAD_IN_MS = 1500;
// Slack when comparing positions: the audio element's duration and seek granularity differ slightly
// from the server's duration_ms, which must not flip the label back to the previous page.
const FRAC_EPSILON = 0.002;

const STATUS_LABELS = { pending: 'Chưa sẵn sàng', failed: 'Lỗi', discarded: 'Đã bỏ', empty: 'Trang trống' };

/**
 * @typedef {{ page_seq:number, status:'ready'|'pending'|'failed'|'discarded'|'empty',
 *   chunk_seq:number|null, chunk_frac:number|null, excerpt:string }} PageAnchor
 */

/**
 * @param {PageAnchor} anchor
 * @param {{ seq:number, duration_ms?:number|null }|undefined} chunk the anchor's chunk
 * @returns {{ seq:number, offsetMs:number }|null} null when the page has no anchor yet
 */
export function seekForPage(anchor, chunk) {
  if (anchor.status !== 'ready' || anchor.chunk_seq == null) return null;
  const duration = chunk && chunk.duration_ms;
  const frac = anchor.chunk_frac || 0;
  const offsetMs = frac > 0 && duration ? Math.max(0, Math.floor(frac * duration) - PAGE_LEAD_IN_MS) : 0;
  return { seq: anchor.chunk_seq, offsetMs };
}

/**
 * The page being heard: the last ready page starting at or before the playback position. The
 * position is read PAGE_LEAD_IN_MS ahead so a seek to a page shows that page straight away.
 * @param {PageAnchor[]} anchors
 * @param {number|null} currentSeq
 * @returns {{ pageSeq:number, total:number }|null} total counts every page, so labels (seq + 1) never exceed it
 */
export function pageAt(anchors, currentSeq, timeMs, durationMs) {
  const readyAnchors = anchors.filter((a) => a.status === 'ready' && a.chunk_seq != null);
  if (readyAnchors.length === 0) return null;
  const seq = currentSeq ?? readyAnchors[0].chunk_seq;
  const pos = durationMs > 0 ? Math.min(1, (timeMs + PAGE_LEAD_IN_MS) / durationMs) : 0;
  let found = readyAnchors[0];
  for (const a of readyAnchors) {
    if (a.chunk_seq < seq || (a.chunk_seq === seq && a.chunk_frac <= pos + FRAC_EPSILON)) found = a;
    else break;
  }
  return { pageSeq: found.page_seq, total: anchors.length };
}

/** Changes when chunks are added, removed or edited, i.e. when anchors may have moved. */
export function chunksSignature(chunks) {
  const last = chunks.length ? chunks[chunks.length - 1].seq : -1;
  const chars = chunks.reduce((sum, c) => sum + (c.text ? c.text.length : 0), 0);
  return `${chunks.length}:${last}:${chars}`;
}

/**
 * Pages pointing at a chunk the player does not have (offline copy older than the anchors, or a
 * chunk list not refreshed yet) are shown as not ready instead of seeking into nothing.
 * @param {PageAnchor[]|null} anchors @param {{seq:number}[]} chunks
 */
export function reconcileAnchors(anchors, chunks) {
  if (!anchors) return null;
  const seqs = new Set(chunks.map((c) => c.seq));
  return anchors.map((a) =>
    a.status === 'ready' && !seqs.has(a.chunk_seq) ? { ...a, status: 'pending', chunk_seq: null, chunk_frac: null } : a
  );
}

/** Pending/failed pages can change (OCR finishes, a page is discarded) without any chunk changing. */
export function hasUnsettledPages(anchors) {
  return !!anchors && anchors.some((a) => a.status === 'pending' || a.status === 'failed');
}

/** Why a page cannot be picked yet, or null when it can. */
export function pageStatusLabel(status) {
  return STATUS_LABELS[status] || null;
}
