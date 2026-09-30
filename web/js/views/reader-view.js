// Reader + player: text (Literata), highlight đoạn đang đọc, phát liên tục, nhớ vị trí, offline.
import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.module.js';
import { booksApi, chunksApi } from '../api-client.js';
import { authStore } from '../store.js';
import { AudioPlaylist } from '../audio-playlist.js';
import { PlaybackProgress } from '../playback-progress.js';
import { setupMediaSession, setPlaybackState, setPositionState } from '../media-session.js';
import { downloadBookAudio, isBookDownloaded } from '../offline-audio-cache.js';
import { readOfflineBook, saveOfflineBook } from '../offline-book-cache.js';
import { ChunkParagraph } from '../components/chunk-paragraph.js';
import { ChunkEditor } from '../components/chunk-editor.js';
import { MiniPlayer } from '../components/mini-player.js';
import { PlayerSheet } from '../components/player-sheet.js';
import { NowPlayingPanel } from '../components/now-playing-panel.js';
import { PagePickerSheet } from '../components/page-picker-sheet.js';
import { useBookBookmarks } from '../use-book-bookmarks.js';
import { useBackgroundMusic } from '../use-background-music.js';
import { usePageAnchors } from '../use-page-anchors.js';
import { pageAt, seekForPage } from '../page-position.js';
import { Icon } from '../icons.js';

const CHUNK_POLL_MS = 4000;
const MANUAL_SCROLL_SUPPRESS_MS = 8000;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadNum(key, fallback) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * One instance serves both #/read/:id (mode 'read') and #/listen/:id (mode 'listen'); only the
 * markup differs, so the AudioPlaylist, progress and timers survive a mode switch.
 * startSeq (from ?seq=, a bookmark's "Nghe từ đây") overrides the saved position once, on open.
 * @param {{ bookId: string, mode?: 'read'|'listen', startSeq?: number|null }} props
 */
export function ReaderView({ bookId, mode = 'read', startSeq = null }) {
  const isListen = mode === 'listen';
  const bookmarks = useBookBookmarks(bookId);
  const user = authStore.get().user;
  const [book, setBook] = useState(/** @type {any|null} */ (null));
  const [chunks, setChunks] = useState(/** @type {any[]} */ ([]));
  const [playerState, setPlayerState] = useState({ currentSeq: null, currentTimeMs: 0, durationMs: 0, playing: false, ready: false, rate: 1 });
  const music = useBackgroundMusic(playerState.playing);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [editingChunk, setEditingChunk] = useState(/** @type {any|null} */ (null));
  const [fontSize, setFontSizeState] = useState(loadNum('booksnap:fontSize', 18));
  const [sleepMinutes, setSleepMinutes] = useState(/** @type {number|null} */ (null));
  const [autoScrollSuppressed, setAutoScrollSuppressed] = useState(false);
  const [downloadState, setDownloadState] = useState({ status: 'idle', done: 0, total: 0 });
  const [error, setError] = useState(/** @type {string|null} */ (null));
  const [isOffline, setIsOffline] = useState(false);
  const { anchors } = usePageAnchors(bookId, chunks, downloadState.status === 'done');

  const playlistRef = useRef(/** @type {AudioPlaylist|null} */ (null));
  const progressRef = useRef(/** @type {PlaybackProgress|null} */ (null));
  const bookRef = useRef(/** @type {any|null} */ (null));
  const paraRefs = useRef(/** @type {Map<number, HTMLElement>} */ (new Map()));
  const programmaticScroll = useRef(false);
  const suppressTimer = useRef(/** @type {number|undefined} */ (undefined));
  const sleepTimeoutRef = useRef(/** @type {number|undefined} */ (undefined));
  const pollRef = useRef(/** @type {number|undefined} */ (undefined));
  const contentRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  // Initial load: book detail + chunks + restore progress.
  useEffect(() => {
    let cancelled = false;
    playlistRef.current = new AudioPlaylist((s) => !cancelled && setPlayerState(s));
    progressRef.current = new PlaybackProgress(user.id, bookId);

    async function init() {
      try {
        const [b, cs] = await Promise.all([booksApi.get(bookId), booksApi.chunks(bookId)]);
        if (cancelled) return;
        bookRef.current = b;
        setBook(b);
        setChunks(cs);
        setIsOffline(false);
        playlistRef.current.setChunks(cs);
        const restored = startAt(await progressRef.current.load(), cs);
        if (cancelled) return;
        playlistRef.current.loadAt(restored.chunk_seq, restored.offset_ms, false);
        const downloaded = await isBookDownloaded(cs);
        if (!cancelled && downloaded) {
          setDownloadState({ status: 'done', done: cs.length, total: cs.length });
          saveOfflineBook(bookId, b, cs);
        }
      } catch (err) {
        if (cancelled) return;
        // C4: network/offline failure — fall back to whatever was saved the last time this
        // downloaded book was open (see saveOfflineBook()), instead of showing a dead end.
        const offlineCopy = readOfflineBook(bookId);
        if (offlineCopy) {
          bookRef.current = offlineCopy.book;
          setBook(offlineCopy.book);
          setChunks(offlineCopy.chunks);
          setIsOffline(true);
          setDownloadState({ status: 'done', done: offlineCopy.chunks.length, total: offlineCopy.chunks.length });
          playlistRef.current.setChunks(offlineCopy.chunks);
          const restored = startAt(await progressRef.current.load(), offlineCopy.chunks);
          if (!cancelled) playlistRef.current.loadAt(restored.chunk_seq, restored.offset_ms, false);
        } else {
          setError(err.message || 'Không tải được sách');
        }
      }
    }
    /** Apply ?seq= once (clamped to a chunk that still exists), then drop it from the URL so a
     *  reload resumes from saved progress. */
    function startAt(restored, list) {
      if (startSeq == null || cancelled) return restored;
      history.replaceState(null, '', window.location.hash.split('?')[0]);
      const target = list.find((c) => c.seq >= startSeq) || list[list.length - 1];
      return target ? { chunk_seq: target.seq, offset_ms: 0 } : restored;
    }

    init();
    schedulePoll();

    function schedulePoll() {
      pollRef.current = window.setTimeout(async () => {
        try {
          const cs = await booksApi.chunks(bookId);
          if (cancelled) return;
          setChunks(cs);
          setIsOffline(false);
          playlistRef.current.setChunks(cs);
          if (bookRef.current) {
            const downloaded = await isBookDownloaded(cs);
            if (downloaded) saveOfflineBook(bookId, bookRef.current, cs);
          }
        } catch {
          // Transient network error while polling — if we have an offline copy from init(),
          // isOffline / cached chunks stay as they are and playback keeps using them.
        }
        if (!cancelled) schedulePoll();
      }, CHUNK_POLL_MS);
    }


    return () => {
      cancelled = true;
      clearTimeout(pollRef.current);
      clearTimeout(sleepTimeoutRef.current);
      progressRef.current.flush();
      progressRef.current.destroy();
      playlistRef.current.destroy();
    };
  }, [bookId]);

  // Persist progress on every timeupdate tick.
  useEffect(() => {
    if (playerState.currentSeq != null) progressRef.current.track(playerState.currentSeq, playerState.currentTimeMs);
  }, [playerState.currentTimeMs, playerState.currentSeq]);

  // Flush progress on pause / tab hide.
  useEffect(() => {
    if (!playerState.playing) progressRef.current && progressRef.current.flush();
  }, [playerState.playing]);
  useEffect(() => {
    function onVis() {
      if (document.hidden) progressRef.current && progressRef.current.flush();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Media Session.
  useEffect(() => {
    if (!book) return undefined;
    return setupMediaSession({
      title: book.title,
      onPlay: () => playlistRef.current.play(),
      onPause: () => playlistRef.current.pause(),
      onSeekBack: () => playlistRef.current.seekRelative(-15),
      onSeekForward: () => playlistRef.current.seekRelative(15),
      onNext: () => playlistRef.current.next(),
      onPrev: () => playlistRef.current.prev(),
    });
  }, [book]);
  useEffect(() => {
    setPlaybackState(playerState.playing ? 'playing' : 'paused');
    if (playerState.durationMs) setPositionState({ durationMs: playerState.durationMs, positionMs: playerState.currentTimeMs, playbackRate: playerState.rate });
  }, [playerState.playing, playerState.currentTimeMs, playerState.durationMs]);

  // Auto-scroll to active paragraph (suppressed 8s after manual scroll).
  useEffect(() => {
    if (isListen || autoScrollSuppressed || playerState.currentSeq == null) return;
    const el = paraRefs.current.get(playerState.currentSeq);
    if (!el) return;
    programmaticScroll.current = true;
    el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    setTimeout(() => (programmaticScroll.current = false), 400);
  }, [playerState.currentSeq, autoScrollSuppressed, isListen]);

  useEffect(() => {
    if (isListen) return undefined; // no reading text to follow in listen mode
    setAutoScrollSuppressed(false);
    function onScroll() {
      if (programmaticScroll.current) return;
      setAutoScrollSuppressed(true);
      clearTimeout(suppressTimer.current);
      suppressTimer.current = window.setTimeout(() => setAutoScrollSuppressed(false), MANUAL_SCROLL_SUPPRESS_MS);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(suppressTimer.current);
    };
  }, [isListen]);

  const totalDurationMs = useMemo(() => chunks.reduce((sum, c) => sum + (c.duration_ms || 0), 0), [chunks]);
  const currentAbsoluteMs = useMemo(() => {
    let sum = 0;
    for (const c of chunks) {
      if (c.seq === playerState.currentSeq) return sum + playerState.currentTimeMs;
      sum += c.duration_ms || 0;
    }
    return sum;
  }, [chunks, playerState.currentSeq, playerState.currentTimeMs]);

  function seekAbsolute(ms) {
    let remaining = ms;
    for (const c of chunks) {
      const dur = c.duration_ms || 0;
      if (remaining <= dur || c === chunks[chunks.length - 1]) {
        playlistRef.current.loadAt(c.seq, Math.max(0, remaining), playerState.playing);
        return;
      }
      remaining -= dur;
    }
  }

  function setFontSize(size) {
    setFontSizeState(size);
    localStorage.setItem('booksnap:fontSize', String(size));
  }

  function setSleep(minutes) {
    setSleepMinutes(minutes);
    clearTimeout(sleepTimeoutRef.current);
    if (minutes) sleepTimeoutRef.current = window.setTimeout(() => playlistRef.current.pause(), minutes * 60 * 1000);
  }

  async function retryChunk(id) {
    try {
      await chunksApi.retry(id);
      setChunks(await booksApi.chunks(bookId));
    } catch (err) {
      setError(err.message);
    }
  }

  function onChunkSaved(updated) {
    setChunks((cs) => cs.map((c) => (c.id === updated.id ? updated : c)));
  }

  async function handleDownload() {
    setDownloadState({ status: 'downloading', done: 0, total: chunks.length });
    try {
      await downloadBookAudio(chunks, (p) => setDownloadState({ status: 'downloading', ...p }));
      setDownloadState({ status: 'done', done: chunks.length, total: chunks.length });
    } catch (err) {
      setError(err.message || 'Không tải được để nghe offline');
      setDownloadState({ status: 'idle', done: 0, total: 0 });
    }
  }

  /** @returns {Promise<boolean>} false when the server rejected the topic (the sheet then reverts). */
  async function handleChangeTopic(name) {
    try {
      setBook(await booksApi.patch(bookId, { topic: name || null }));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function handleDelete() {
    if (!window.confirm('Xoá sách này? Không thể hoàn tác.')) return;
    try {
      await booksApi.remove(bookId);
      window.location.hash = '#/library';
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !book) return html`<div class="container"><div class="banner banner-error" role="alert">${error}</div></div>`;
  if (!book) return html`<div class="container"><div class="skeleton" style=${{ height: '300px' }}></div></div>`;

  const statusLabel =
    playerState.chunkStatus === 'waiting_quota'
      ? 'Chờ quota'
      : playerState.chunkStatus === 'pending' || playerState.chunkStatus === 'processing'
        ? 'Đang chuyển giọng'
        : null;

  const chunkIndex = Math.max(0, chunks.findIndex((c) => c.seq === playerState.currentSeq));
  const excerpt = chunks.length ? (chunks[chunkIndex].text || '').replace(/\s+/g, ' ').trim() : '';
  const currentSeq = chunks.length ? chunks[chunkIndex].seq : null;
  const seekBack = () => playlistRef.current.seekRelative(-15);
  const seekForward = () => playlistRef.current.seekRelative(15);
  // Taps are the only place iOS lets the background-music AudioContext start.
  const togglePlay = () => {
    music.unlock();
    playlistRef.current.togglePlay();
  };
  const pagePos = anchors && pageAt(anchors, playerState.currentSeq, playerState.currentTimeMs, playerState.durationMs);
  const pageText = pagePos ? `${pagePos.pageSeq + 1}/${pagePos.total}` : null;
  const openPages = () => setPagePickerOpen(true);
  function playPage(anchor) {
    const target = seekForPage(anchor, chunks.find((c) => c.seq === anchor.chunk_seq));
    if (!target) return;
    music.unlock();
    playlistRef.current.loadAt(target.seq, target.offsetMs, true);
    setPagePickerOpen(false);
  }

  return html`
    <div class="reader-view ${isListen ? 'reader-view--listen' : ''}">
      ${isListen && (error || isOffline) &&
      html`<div class="np-banners">
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${isOffline && html`<div class="banner banner-info"><${Icon} name="clock" size=${14} /> Đang ngoại tuyến — phát từ bản đã tải</div>`}
      </div>`}
      ${isListen
        ? html`<${NowPlayingPanel}
            book=${book}
            playing=${playerState.playing}
            ready=${playerState.ready}
            statusLabel=${statusLabel}
            chunkIndex=${chunkIndex}
            chunkCount=${chunks.length}
            excerpt=${excerpt}
            currentAbsoluteMs=${currentAbsoluteMs}
            totalDurationMs=${totalDurationMs}
            rate=${playerState.rate}
            onTogglePlay=${togglePlay}
            onSeekBack=${seekBack}
            onSeekForward=${seekForward}
            onSeekAbsolute=${seekAbsolute}
            onSetRate=${(r) => playlistRef.current.setRate(r)}
            onOpenSheet=${() => setSheetOpen(true)}
            readHref=${`#/read/${bookId}`}
            pageText=${pageText}
            onOpenPages=${openPages}
            bookmarkSlot=${currentSeq != null &&
            html`<button
              class="chip np-bookmark"
              aria-pressed=${String(bookmarks.seqs.has(currentSeq))}
              aria-label=${bookmarks.seqs.has(currentSeq) ? `Bỏ đánh dấu đoạn ${currentSeq + 1}` : `Đánh dấu đoạn ${currentSeq + 1}`}
              onClick=${() => bookmarks.toggle(currentSeq)}
            ><${Icon} name="bookmark" size=${17} /></button>`}
          />`
        : null}
      ${!isListen && html`<div class="reader-topbar">
        <a class="icon-btn" href="#/book/${bookId}" aria-label="Quay lại"><${Icon} name="chevron-left" /></a>
        <span class="reader-title">${book.title}</span>
        <a class="icon-btn" href="#/listen/${bookId}" aria-label="Mở màn đĩa than"><${Icon} name="disc" /></a>
        <button class="icon-btn" aria-label="Tuỳ chọn" onClick=${() => setSheetOpen(true)}><${Icon} name="settings" /></button>
      </div>`}
      ${isOffline && !isListen &&
      html`<div class="banner banner-info" style=${{ margin: '0 20px 8px' }}><${Icon} name="clock" size=${14} /> Đang ngoại tuyến — phát từ bản đã tải</div>`}

      ${!isListen &&
      html`<div class="reader-content" ref=${contentRef} style=${{ '--reader-font-size': `${fontSize}px` }}>
        ${error && html`<div class="banner banner-error" role="alert">${error}</div>`}
        ${chunks.length === 0 && html`<p class="text-muted">Sách chưa có đoạn nào để đọc. Quay lại khi OCR/chuyển giọng xong.</p>`}
        ${chunks.map(
          (c) => html`
            <div ref=${(el) => el && paraRefs.current.set(c.seq, el)} key=${c.id}>
              <${ChunkParagraph}
                chunk=${c}
                isActive=${c.seq === playerState.currentSeq}
                bookmarked=${bookmarks.seqs.has(c.seq)}
                onToggleBookmark=${bookmarks.toggle}
                onPlayFrom=${(seq) => {
                  music.unlock();
                  playlistRef.current.loadAt(seq, 0, true);
                }}
                onRetry=${retryChunk}
                onEdit=${setEditingChunk}
              />
            </div>
          `
        )}
      </div>`}

      ${!isListen && autoScrollSuppressed &&
      html`<button class="scroll-resume-btn" onClick=${() => setAutoScrollSuppressed(false)}>
        <${Icon} name="chevron-down" size=${16} /> Về đoạn đang đọc
      </button>`}

      ${!isListen &&
      html`<${MiniPlayer}
        book=${book}
        listenHref=${`#/listen/${bookId}`}
        playing=${playerState.playing}
        ready=${playerState.ready}
        statusLabel=${statusLabel}
        currentAbsoluteMs=${currentAbsoluteMs}
        totalDurationMs=${totalDurationMs}
        onTogglePlay=${togglePlay}
        onSeekBack=${seekBack}
        onSeekForward=${seekForward}
        onSeekAbsolute=${seekAbsolute}
        onExpand=${() => setSheetOpen(true)}
        pageText=${pageText}
        onOpenPages=${openPages}
      />`}

      ${pagePickerOpen && anchors &&
      html`<${PagePickerSheet}
        anchors=${anchors}
        currentPageSeq=${pagePos ? pagePos.pageSeq : null}
        onPick=${playPage}
        onClose=${() => setPagePickerOpen(false)}
      />`}

      ${sheetOpen &&
      html`<${PlayerSheet}
        rate=${playerState.rate}
        onSetRate=${(r) => playlistRef.current.setRate(r)}
        fontSize=${fontSize}
        onSetFontSize=${setFontSize}
        theme=${(document.documentElement.getAttribute('data-theme')) || 'auto'}
        sleepMinutes=${sleepMinutes}
        onSetSleep=${setSleep}
        musicTrack=${music.trackId}
        musicVolume=${music.volume}
        onSetMusicTrack=${music.setTrack}
        onSetMusicVolume=${music.setVolume}
        downloadState=${downloadState}
        onDownload=${handleDownload}
        canManage=${book.can_manage}
        book=${book}
        currentVoice=${(chunks[chunkIndex] && chunks[chunkIndex].voice) || book.tts_voice}
        onChangeTopic=${handleChangeTopic}
        onDelete=${handleDelete}
        exportUrl=${booksApi.exportUrl(bookId)}
        onClose=${() => setSheetOpen(false)}
      />`}

      <div class="reader-toast" role="status" aria-live="polite" hidden=${!(bookmarks.message || music.message)}>${bookmarks.message || music.message || ''}</div>

      ${editingChunk &&
      html`<${ChunkEditor} chunk=${editingChunk} onClose=${() => setEditingChunk(null)} onSaved=${onChunkSaved} />`}
    </div>
  `;
}
