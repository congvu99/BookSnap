// Vietnamese labels for TTS voices and the picker's ordering. Pure module (no Preact) so it runs
// under `node --test`. Labels describe how the voice sounds; they were chosen after listening to
// scripts/voice_poc.py output, so update them together with app/tts_voices.py.

/** @type {Record<string, {label: string, gender: 'male'|'female'}>} */
const VOICES = {
  Charon: { label: 'Nam · trầm, rõ', gender: 'male' },
  Orus: { label: 'Nam · chắc', gender: 'male' },
  Fenrir: { label: 'Nam · sôi nổi', gender: 'male' },
  Puck: { label: 'Nam · tươi', gender: 'male' },
  Kore: { label: 'Nữ · chắc', gender: 'female' },
  Aoede: { label: 'Nữ · nhẹ', gender: 'female' },
  Leda: { label: 'Nữ · trẻ', gender: 'female' },
  Zephyr: { label: 'Nữ · sáng', gender: 'female' },
  'vi-VN-NamMinhNeural': { label: 'Nam · Azure', gender: 'male' },
  'vi-VN-HoaiMyNeural': { label: 'Nữ · Azure', gender: 'female' },
};

/** @param {string} voice */
export function voiceLabel(voice) {
  return VOICES[voice] ? VOICES[voice].label : voice;
}

const GENDER_RANK = { male: 0, female: 1 };

/**
 * Flatten GET /api/voices into picker options: the default provider first, and within each
 * provider the default voice, then male voices, then female, keeping the server's order.
 * @param {any} response
 * @returns {{provider: string, voice: string, label: string, isDefault: boolean, configured: boolean, previewUrl: string|null}[]}
 */
export function orderVoices(response) {
  if (!response || !response.providers) return [];
  const providers = Object.keys(response.providers).sort((a, b) => (a === response.default_provider ? -1 : b === response.default_provider ? 1 : 0));
  const out = [];
  for (const provider of providers) {
    const info = response.providers[provider];
    const isDefaultProvider = provider === response.default_provider;
    const rank = (v) => (v === info.default && isDefaultProvider ? -1 : GENDER_RANK[(VOICES[v] || {}).gender] ?? 2);
    const voices = [...new Set(info.voices)].map((v, i) => ({ v, i })).sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i);
    for (const { v } of voices) {
      out.push({
        provider,
        voice: v,
        label: voiceLabel(v),
        isDefault: isDefaultProvider && v === info.default,
        configured: info.configured !== false,
        previewUrl: (info.preview_urls && info.preview_urls[v]) || null,
      });
    }
  }
  return out;
}

/** User-facing message for a failed preview, keyed by API error code (never by HTTP status:
 * the service worker also answers 503 when offline). @param {string} code */
export function previewErrorMessage(code) {
  switch (code) {
    case 'tts_quota':
      return 'Hết lượt nghe thử, thử lại sau';
    case 'tts_timeout':
      return 'Máy chủ đang chậm, thử lại sau';
    case 'rate_limited':
      return 'Nghe thử nhiều quá, đợi 1 phút';
    case 'provider_unavailable':
      return 'Giọng này chưa được cấu hình';
    case 'offline':
    case 'network_error':
      return 'Đang ngoại tuyến';
    default:
      return 'Không nghe thử được';
  }
}
