// Service worker: app shell cache-first, /api/* network-first, EXCEPT chunk audio which is
// cache-first from 'booksnap-audio-v1' (shared with offline-audio-cache.js) and must answer
// Range requests with 206 + Content-Range for Safari's <audio> to seek while offline.
// v2: fixes C3 (206 responses can never be cache.put'd — see handleChunkAudio) and ships the
// H3/M3/M4 client-side fixes; bumped so already-installed clients pick up the new sw.js bytes.
const SHELL_CACHE = 'booksnap-shell-v15';
const AUDIO_CACHE = 'booksnap-audio-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/account.css',
  '/css/app.css',
  '/css/auth.css',
  '/css/bookmarks.css',
  '/css/camera.css',
  '/css/library.css',
  '/css/now-playing.css',
  '/css/ornaments.css',
  '/css/reader.css',
  '/css/tokens.css',
  '/css/vinyl.css',
  '/vendor/preact-htm.module.js',
  '/js/api-client.js',
  '/js/app.js',
  '/js/audio-playlist.js',
  '/js/camera-capture.js',
  '/js/icons.js',
  '/js/media-session.js',
  '/js/offline-audio-cache.js',
  '/js/offline-book-cache.js',
  '/js/playback-progress.js',
  '/js/sign-out.js',
  '/js/sleeve-palette.js',
  '/js/store.js',
  '/js/text-fold.js',
  '/js/upload-queue.js',
  '/js/use-book-bookmarks.js',
  '/js/components/account-profile-forms.js',
  '/js/components/bottom-nav.js',
  '/js/components/chunk-editor.js',
  '/js/components/chunk-paragraph.js',
  '/js/components/library-account-menu.js',
  '/js/components/library-crate.js',
  '/js/components/library-hero-card.js',
  '/js/components/mini-player.js',
  '/js/components/now-playing-panel.js',
  '/js/components/ornament-shapes.js',
  '/js/components/ornate-frame.js',
  '/js/components/player-sheet.js',
  '/js/components/progress-timeline.js',
  '/js/components/record-sleeve.js',
  '/js/components/tonearm.js',
  '/js/components/usage-meter-list.js',
  '/js/components/topic-filter-menu.js',
  '/js/components/topic-input.js',
  '/js/components/vinyl-disc.js',
  '/js/views/account-view.js',
  '/js/views/auth-view.js',
  '/js/views/book-status-view.js',
  '/js/views/bookmarks-view.js',
  '/js/views/capture-view.js',
  '/js/views/library-view.js',
  '/js/views/reader-view.js',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== AUDIO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isChunkAudio(url) {
  return /\/api\/chunks\/[^/]+\/audio/.test(url.pathname);
}
function isAuthEndpoint(url) {
  return url.pathname.startsWith('/api/auth/') || url.pathname === '/api/me';
}

/** Slice a cached full response into a 206 Partial Content reply for the requested Range header. */
async function respondWithRange(response, rangeHeader) {
  const buf = await response.arrayBuffer();
  const total = buf.byteLength;
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader || '');
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : total - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= total) end = total - 1;
  const sliced = buf.slice(start, end + 1);
  const headers = new Headers(response.headers);
  headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
  headers.set('Content-Length', String(sliced.byteLength));
  headers.set('Accept-Ranges', 'bytes');
  return new Response(sliced, { status: 206, statusText: 'Partial Content', headers });
}

async function handleChunkAudio(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cached = await cache.match(request.url);
  if (!cached) {
    // Not downloaded yet: pass the request straight through to the network, Range header and
    // all. Do NOT try to cache.put the response here — <audio> always sends a Range request, the
    // server always answers 206, and the Cache API spec requires put() to reject any 206 with a
    // TypeError (that used to bubble up as a 503 and break online playback for every chunk that
    // wasn't already downloaded — see C3). Only offline-audio-cache.js populates AUDIO_CACHE, via
    // a plain non-Range GET that gets a cacheable 200.
    try {
      return await fetch(request);
    } catch {
      return new Response('Offline và chưa tải sẵn', { status: 503 });
    }
  }
  const range = request.headers.get('range');
  if (range) return respondWithRange(cached.clone(), range);
  return cached;
}

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: { code: 'offline', message: 'Không có kết nối mạng' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(SHELL_CACHE);
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return; // Let non-GET (POST/PATCH/DELETE) pass through untouched.

  if (isChunkAudio(url)) {
    event.respondWith(handleChunkAudio(event.request));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    // Never cache auth or other user-data endpoints — always hit the network.
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (!isAuthEndpoint(url)) {
    event.respondWith(cacheFirstShell(event.request));
  }
});
