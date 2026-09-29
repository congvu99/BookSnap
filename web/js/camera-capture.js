// getUserMedia camera wrapper: video stream + capture-to-Blob. Image bytes never touch disk —
// they stay in RAM (Blob/ObjectURL) until uploaded, then the caller revokes the URL (see D3).

const LONG_EDGE = 2000;
const JPEG_QUALITY = 0.85;

/** Thrown when getUserMedia is denied or unsupported, so the UI can show the permission screen. */
export class CameraError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

function describeCameraFailure(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera đang bị chặn cho trang này. iPhone: Cài đặt → Safari → Camera → chọn "Hỏi" hoặc "Cho phép", hoặc bấm aA trên thanh địa chỉ → Cài đặt trang web → Camera. Sau đó tải lại trang.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Không tìm thấy camera trên thiết bị này.';
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Camera đang được ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.';
  }
  return `Không mở được camera${name ? ` (${name})` : ''}.`;
}

export class CameraCapture {
  /** @param {HTMLVideoElement} videoEl */
  constructor(videoEl) {
    this.videoEl = videoEl;
    /** @type {MediaStream|null} */
    this.stream = null;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // mediaDevices is undefined outside secure contexts (plain http on a LAN IP, e.g. iPhone Safari).
      throw new CameraError(
        window.isSecureContext === false
          ? 'Trang đang mở qua HTTP nên trình duyệt chặn camera. Hãy mở bằng địa chỉ https:// (bản deploy hoặc tunnel HTTPS).'
          : 'Trình duyệt không hỗ trợ camera. Hãy cập nhật trình duyệt.',
      );
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
    } catch (err) {
      console.warn('getUserMedia failed', err);
      throw new CameraError(describeCameraFailure(err), err);
    }
    this.videoEl.srcObject = this.stream;
    this.videoEl.setAttribute('playsinline', '');
    this.videoEl.muted = true;
    await this.videoEl.play().catch(() => {});
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.videoEl.srcObject = null;
  }

  /** @returns {boolean} whether the active track supports torch (flashlight) */
  supportsTorch() {
    const track = this._videoTrack();
    if (!track || !track.getCapabilities) return false;
    return Boolean(track.getCapabilities().torch);
  }

  /** @param {boolean} on */
  async setTorch(on) {
    const track = this._videoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
    } catch {
      // Not fatal — torch is a nice-to-have; ignore unsupported constraint errors.
    }
  }

  _videoTrack() {
    return this.stream ? this.stream.getVideoTracks()[0] : null;
  }

  /**
   * Capture the current video frame, resize so the long edge is <=2000px, encode as JPEG q0.85.
   * @returns {Promise<Blob>}
   */
  async captureFrame() {
    const vw = this.videoEl.videoWidth;
    const vh = this.videoEl.videoHeight;
    if (!vw || !vh) throw new CameraError('Camera chưa sẵn sàng, thử lại sau giây lát.');
    const scale = Math.min(1, LONG_EDGE / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    // M4: `x instanceof OffscreenCanvas` throws a ReferenceError when the global itself is
    // undefined (iOS Safari < 16.4) — never reference the identifier in that branch at all.
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
    if (hasOffscreen) {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(this.videoEl, 0, 0, w, h);
      return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.videoEl, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new CameraError('Không tạo được ảnh'))), 'image/jpeg', JPEG_QUALITY);
    });
  }

  vibrate() {
    if (navigator.vibrate) navigator.vibrate(15);
  }
}
