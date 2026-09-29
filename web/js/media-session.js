// Media Session API wiring: lock-screen / headset metadata + play/pause/seek/next/prev actions.
/**
 * @param {{
 *   title: string, artist?: string,
 *   onPlay: () => void, onPause: () => void,
 *   onSeekBack: () => void, onSeekForward: () => void,
 *   onNext?: () => void, onPrev?: () => void,
 * }} handlers
 */
export function setupMediaSession(handlers) {
  if (!('mediaSession' in navigator)) return () => {};
  navigator.mediaSession.metadata = new MediaMetadata({
    title: handlers.title,
    artist: handlers.artist || 'BookSnap',
    album: 'BookSnap',
  });
  const actions = {
    play: handlers.onPlay,
    pause: handlers.onPause,
    seekbackward: handlers.onSeekBack,
    seekforward: handlers.onSeekForward,
    nexttrack: handlers.onNext,
    previoustrack: handlers.onPrev,
  };
  const registered = [];
  for (const [action, fn] of Object.entries(actions)) {
    if (!fn) continue;
    try {
      navigator.mediaSession.setActionHandler(action, fn);
      registered.push(action);
    } catch {
      // Action not supported by this browser — safe to skip.
    }
  }
  return () => {
    for (const action of registered) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        /* ignore */
      }
    }
  };
}

/** @param {'playing'|'paused'|'none'} state */
export function setPlaybackState(state) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = state;
}

/** @param {{durationMs:number, positionMs:number, playbackRate:number}} pos */
export function setPositionState(pos) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!pos.durationMs || pos.positionMs > pos.durationMs) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: pos.durationMs / 1000,
      position: pos.positionMs / 1000,
      playbackRate: pos.playbackRate,
    });
  } catch {
    // Some browsers reject out-of-range values transiently during chunk swaps — ignore.
  }
}
