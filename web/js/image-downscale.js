// Shared page-image encoding: resize so the long edge is <=2000px and encode as JPEG q0.85.
// Used by the live camera (video frames) and by "Chụp lại" (photos picked or shot natively),
// so every upload stays well under the server's size cap whatever the source.

export const LONG_EDGE = 2000;
export const JPEG_QUALITY = 0.85;

/** Target size that fits `maxEdge` on the long side, never upscaling. */
export function fitLongEdge(width, height, maxEdge = LONG_EDGE) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Draw `source` (video frame, ImageBitmap or <img>) scaled to fit and encode it as JPEG.
 * @param {CanvasImageSource} source @param {number} srcWidth @param {number} srcHeight
 * @returns {Promise<Blob>}
 */
export function downscaleToJpeg(source, srcWidth, srcHeight) {
  const { width: w, height: h } = fitLongEdge(srcWidth, srcHeight);
  // `x instanceof OffscreenCanvas` throws a ReferenceError when the global itself is
  // undefined (iOS Safari < 16.4) — never reference the identifier in that branch at all.
  const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
  if (hasOffscreen) {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d').drawImage(source, 0, 0, w, h);
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(source, 0, 0, w, h);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Không tạo được ảnh'))), 'image/jpeg', JPEG_QUALITY);
  });
}

/** Decode a picked/shot photo file (EXIF orientation applied) and re-encode it via `downscaleToJpeg`. */
export async function fileToJpeg(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      try {
        return await downscaleToJpeg(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    } catch {
      // Older Safari rejects the options bag or the format; fall through to <img> decoding.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await downscaleToJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}
