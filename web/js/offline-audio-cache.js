// "Tải để nghe offline": fetches every done chunk's audio into Cache API 'booksnap-audio-v1'
// (the same cache name the service worker reads from for cache-first /api/chunks/*/audio — see sw.js).
export const AUDIO_CACHE_NAME = 'booksnap-audio-v1';

/**
 * @param {{id:string, audio_url:string|null}[]} chunks
 * @param {(progress:{done:number, total:number, bytes:number}) => void} onProgress
 */
export async function downloadBookAudio(chunks, onProgress) {
  if (!('caches' in window)) throw new Error('Trình duyệt không hỗ trợ tải offline');
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const urls = chunks.filter((c) => c.audio_url).map((c) => c.audio_url);
  let done = 0;
  let bytes = 0;
  for (const url of urls) {
    const already = await cache.match(url);
    if (already) {
      const buf = await already.clone().arrayBuffer();
      bytes += buf.byteLength;
      done += 1;
      onProgress({ done, total: urls.length, bytes });
      continue;
    }
    const res = await fetch(url, { credentials: 'same-origin' });
    if (res.ok) {
      await cache.put(url, res.clone());
      const buf = await res.arrayBuffer();
      bytes += buf.byteLength;
    }
    done += 1;
    onProgress({ done, total: urls.length, bytes });
  }
  if (navigator.storage && navigator.storage.persist) {
    try {
      await navigator.storage.persist();
    } catch {
      // Persistence is a best-effort hint to the browser; ignore if unsupported/denied.
    }
  }
}

/** @param {{audio_url:string|null}[]} chunks @returns {Promise<boolean>} every done chunk is cached */
export async function isBookDownloaded(chunks) {
  if (!('caches' in window)) return false;
  const cache = await caches.open(AUDIO_CACHE_NAME);
  const urls = chunks.filter((c) => c.audio_url).map((c) => c.audio_url);
  if (urls.length === 0) return false;
  for (const url of urls) {
    if (!(await cache.match(url))) return false;
  }
  return true;
}

/** @param {{audio_url:string|null}[]} chunks */
export async function removeBookDownload(chunks) {
  if (!('caches' in window)) return;
  const cache = await caches.open(AUDIO_CACHE_NAME);
  await Promise.all(chunks.filter((c) => c.audio_url).map((c) => cache.delete(c.audio_url)));
}
