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

export class CameraCapture {
  /** @param {HTMLVideoElement} videoEl */
  constructor(videoEl) {
    this.videoEl = videoEl;
    /** @type {MediaStream|null} */
    this.stream = null;
  }

  async start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new CameraError('Trình duyệt không hỗ trợ camera. Cần HTTPS và trình duyệt hiện đại.');
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
    } catch (err) {
      throw new CameraError('Không truy cập được camera. Vui lòng cấp quyền trong cài đặt trình duyệt.', err);
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
