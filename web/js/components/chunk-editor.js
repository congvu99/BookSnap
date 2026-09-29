// Sửa text 1 đoạn → PATCH /api/chunks/:id → server re-queues (pending) → audio sinh lại (step 8).
import { html, useState } from '../../vendor/preact-htm.module.js';
import { chunksApi } from '../api-client.js';
import { Icon } from '../icons.js';

/** @param {{chunk: object, onClose: () => void, onSaved: (chunk:object) => void}} props */
export function ChunkEditor({ chunk, onClose, onSaved }) {
  const [text, setText] = useState(chunk.text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(/** @type {string|null} */ (null));

  async function save() {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Nội dung không được để trống');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await chunksApi.patch(chunk.id, trimmed);
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err.message || 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="player-sheet-backdrop" onClick=${onClose}></div>
    <div class="player-sheet" role="dialog" aria-label="Sửa đoạn ${chunk.seq + 1}">
      <div class="player-sheet-handle"></div>
      <div class="player-sheet-section">
        <h3>Sửa đoạn ${chunk.seq + 1}</h3>
        <textarea
          value=${text}
          onInput=${(e) => setText(e.currentTarget.value)}
          rows="6"
          style=${{ width: '100%', fontFamily: 'var(--font-read)', fontSize: '16px', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)' }}
        ></textarea>
        ${error && html`<div class="field-error">${error}</div>`}
        <p class="text-muted" style=${{ fontSize: '13px' }}>Lưu sẽ sinh lại audio cho đoạn này; các đoạn khác không đổi.</p>
        <div style=${{ display: 'flex', gap: '12px' }}>
          <button class="btn btn-secondary" style=${{ flex: 1 }} onClick=${onClose} disabled=${busy}>Huỷ</button>
          <button class="btn btn-primary" style=${{ flex: 1 }} onClick=${save} disabled=${busy}>
            ${busy ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  `;
}
