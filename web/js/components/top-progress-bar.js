// Thin bar at the very top of the screen while the user waits on the server (mutations and
// opted-in foreground requests, see network-activity.js). It only appears once the work has lasted
// SHOW_DELAY_MS so quick requests never flicker, then finishes with a fill + fade.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.module.js';
import { subscribe, pendingCount } from '../network-activity.js';

const SHOW_DELAY_MS = 150;
/** Matches the fill + fade duration in loading.css. */
const FINISH_MS = 450;

/** Renders nothing visible when idle; mount once near the app root. */
export function TopProgressBar() {
  // 'idle' | 'active' (indeterminate shimmer) | 'done' (fill + fade out)
  const [phase, setPhase] = useState('idle');
  const phaseRef = useRef('idle');
  const showTimer = useRef(null);
  const finishTimer = useRef(null);

  useEffect(() => {
    const go = (next) => {
      phaseRef.current = next;
      setPhase(next);
    };
    const clearTimers = () => {
      clearTimeout(showTimer.current);
      clearTimeout(finishTimer.current);
      showTimer.current = null;
      finishTimer.current = null;
    };
    const onCount = (count) => {
      if (count > 0) {
        if (phaseRef.current === 'active' || showTimer.current) return;
        clearTimeout(finishTimer.current);
        // New work during the fade-out: bring the bar straight back.
        if (phaseRef.current === 'done') go('active');
        else showTimer.current = setTimeout(() => { showTimer.current = null; go('active'); }, SHOW_DELAY_MS);
        return;
      }
      clearTimers();
      if (phaseRef.current !== 'active') return;
      go('done');
      finishTimer.current = setTimeout(() => { finishTimer.current = null; go('idle'); }, FINISH_MS);
    };
    const off = subscribe(onCount);
    onCount(pendingCount());
    return () => {
      off();
      clearTimers();
    };
  }, []);

  return html`
    <div class="top-progress" data-phase=${phase} role="progressbar" aria-label="Đang xử lý" aria-hidden=${phase === 'idle' ? 'true' : null}>
      <span class="top-progress-bar"></span>
    </div>
  `;
}
