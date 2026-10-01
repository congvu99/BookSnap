// Sheet "Chọn trang": every captured page with its opening words; tap a ready page to play from it.
// Pages without an anchor yet (not chunked, failed, discarded, blank) are listed but disabled.
import { html, useEffect, useRef } from '../../vendor/preact-htm.module.js';
import { pageStatusLabel } from '../page-position.js';

/**
 * @param {{
 *   anchors: import('../page-position.js').PageAnchor[], currentPageSeq: number|null,
 *   onPick: (anchor: import('../page-position.js').PageAnchor) => void, onClose: () => void,
 * }} props
 */
export function PagePickerSheet({ anchors, currentPageSeq, onPick, onClose }) {
  const currentRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const dialogRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  useEffect(() => {
    const opener = /** @type {HTMLElement|null} */ (document.activeElement);
    const el = currentRef.current;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Focus lands inside the dialog even with no current page: the current row, else the first pickable one.
    const target = el || (dialogRef.current && dialogRef.current.querySelector('.page-pick-row:not(:disabled)')) || dialogRef.current;
    if (target) target.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return html`
    <div class="player-sheet-backdrop" onClick=${onClose}></div>
    <div class="player-sheet page-picker" role="dialog" aria-modal="true" aria-label="Chọn trang" tabindex="-1" ref=${dialogRef}>
      <div class="player-sheet-handle"></div>
      <div class="player-sheet-section">
        <h3>Chọn trang</h3>
        <ul class="page-pick-list">
          ${anchors.map((a) => {
            const reason = pageStatusLabel(a.status);
            const current = a.page_seq === currentPageSeq;
            return html`
              <li key=${a.page_seq}>
                <button
                  class="page-pick-row"
                  ref=${current ? currentRef : undefined}
                  aria-current=${current ? 'true' : undefined}
                  disabled=${reason != null}
                  onClick=${() => onPick(a)}
                >
                  <span class="page-pick-num">Trang ${a.page_seq + 1}</span>
                  <span class="page-pick-excerpt">${reason || a.excerpt}</span>
                </button>
              </li>
            `;
          })}
        </ul>
      </div>
    </div>
  `;
}
