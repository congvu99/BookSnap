// Sheet "Chụp lại Trang N": shoot a new photo with the native camera or pick one from the device,
// to replace a failed page in place (same page number, OCR runs again).
import { html, useEffect, useRef } from '../../vendor/preact-htm.module.js';
import { Icon } from '../icons.js';

/** @param {{ seq: number, onPick: (file: File) => void, onClose: () => void }} props */
export function RecapturePageSheet({ seq, onPick, onClose }) {
  const dialogRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const cameraRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const fileRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  useEffect(() => {
    const opener = /** @type {HTMLElement|null} */ (document.activeElement);
    const first = dialogRef.current && dialogRef.current.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  function onChange(e) {
    const input = /** @type {HTMLInputElement} */ (e.currentTarget);
    const file = input.files && input.files[0];
    input.value = ''; // picking the same file again must still fire change
    if (file) onPick(file);
  }

  // Real buttons (focusable, keyboard-operable) open the hidden file inputs.
  return html`
    <div class="player-sheet-backdrop" onClick=${onClose}></div>
    <div class="player-sheet" role="dialog" aria-modal="true" aria-label=${`Chụp lại Trang ${seq + 1}`} tabindex="-1" ref=${dialogRef}>
      <div class="player-sheet-handle"></div>
      <div class="player-sheet-section">
        <h3>Chụp lại Trang ${seq + 1}</h3>
        <p class="text-muted">Ảnh mới thay cho ảnh lỗi, giữ đúng vị trí trang trong sách.</p>
        <div style=${{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" class="btn btn-primary" onClick=${() => cameraRef.current && cameraRef.current.click()}>
            <${Icon} name="camera" size=${16} /> Chụp ảnh
          </button>
          <button type="button" class="btn btn-secondary" onClick=${() => fileRef.current && fileRef.current.click()}>Chọn từ máy</button>
          <button type="button" class="btn btn-ghost" onClick=${onClose}>Đóng</button>
        </div>
        <input ref=${cameraRef} type="file" accept="image/*" capture="environment" hidden tabindex="-1" onChange=${onChange} />
        <input ref=${fileRef} type="file" accept="image/*" hidden tabindex="-1" onChange=${onChange} />
      </div>
    </div>
  `;
}
