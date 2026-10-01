// Keeps the connection to the server warm so the first tap after a pause doesn't pay for DNS + TCP +
// TLS (~1.2s from Vietnam to the VPS; the DuckDNS record only lives 60s). When the app comes back to
// the foreground, or a finger lands after a quiet spell, a tiny request opens the connection in
// parallel with whatever the tap is about to load.

const QUIET_MS = 30_000;
let lastNetworkUse = Date.now();
let warming = false;

/** Called by api-client for every request: an active connection needs no warm-up. */
export function noteNetworkUse() {
  lastNetworkUse = Date.now();
}

function warm() {
  if (warming || Date.now() - lastNetworkUse < QUIET_MS || navigator.onLine === false) return;
  warming = true;
  noteNetworkUse();
  fetch('/health', { cache: 'no-store', credentials: 'omit' })
    .catch(() => {})
    .finally(() => {
      warming = false;
    });
}

export function startConnectionWarmup() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') warm();
  });
  // Capture phase: runs before the tapped element's own handlers start their requests.
  document.addEventListener('pointerdown', warm, { capture: true, passive: true });
}
