// Polling hook shared by the status view and the library.
// - Self-rescheduling setTimeout (no overlapping requests), interval may change between renders.
// - Paused while the tab is hidden; refreshes immediately when it becomes visible again.
// - `fn(isStale)` receives a predicate so a slow response can be dropped when a newer request started.
// - The first call happens after one interval: callers do their own initial load.
import { useCallback, useEffect, useRef } from '../vendor/preact-htm.module.js';

/**
 * @param {(isStale: () => boolean) => Promise<void>|void} fn
 * @param {number} intervalMs
 * @param {boolean} active poll only while true
 * @returns {() => Promise<void>} reload: run `fn` now (also supersedes any in-flight poll)
 */
export function useVisiblePolling(fn, intervalMs, active = true) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const counterRef = useRef(0);

  const run = useCallback(async () => {
    const id = ++counterRef.current;
    try {
      await fnRef.current(() => id !== counterRef.current);
    } catch {
      // fn owns error reporting; a failed poll must never stop the loop.
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let timer;
    let cancelled = false;

    const schedule = () => {
      window.clearTimeout(timer);
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(tick, intervalMs);
    };
    async function tick() {
      if (cancelled || document.hidden) return;
      await run();
      schedule();
    }
    const onVisibility = () => {
      window.clearTimeout(timer);
      if (!document.hidden) tick();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs, run]);

  return run;
}
