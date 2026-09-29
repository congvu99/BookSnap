import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLabel, orderVoices, previewErrorMessage } from '../../web/js/voice-labels.js';

const response = {
  default_provider: 'gemini',
  providers: {
    gemini: {
      default: 'Charon',
      voices: ['Charon', 'Orus', 'Kore', 'Aoede'],
      configured: true,
      preview_urls: { Charon: '/p/c', Orus: '/p/o', Kore: '/p/k', Aoede: '/p/a' },
    },
    azure: {
      default: 'vi-VN-HoaiMyNeural',
      voices: ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'],
      configured: false,
      preview_urls: {},
    },
  },
};

test('voiceLabel describes known voices and falls back to the raw name', () => {
  assert.equal(voiceLabel('Charon'), 'Nam · trầm, rõ');
  assert.equal(voiceLabel('Kore'), 'Nữ · chắc');
  assert.equal(voiceLabel('SomethingNew'), 'SomethingNew');
});

test('orderVoices puts the default first, then male, then female, per provider in order', () => {
  const list = orderVoices(response);
  assert.deepEqual(
    list.map((o) => `${o.provider}:${o.voice}`),
    ['gemini:Charon', 'gemini:Orus', 'gemini:Kore', 'gemini:Aoede', 'azure:vi-VN-NamMinhNeural', 'azure:vi-VN-HoaiMyNeural'],
  );
  assert.equal(list[0].isDefault, true);
  assert.equal(list.filter((o) => o.isDefault).length, 1);
});

test('orderVoices keeps configured flag and preview URL, no duplicates', () => {
  const list = orderVoices(response);
  const azure = list.find((o) => o.voice === 'vi-VN-NamMinhNeural');
  assert.equal(azure.configured, false);
  assert.equal(azure.previewUrl, null);
  assert.equal(list.find((o) => o.voice === 'Orus').previewUrl, '/p/o');
  assert.equal(new Set(list.map((o) => `${o.provider}:${o.voice}`)).size, list.length);
});

test('orderVoices handles a null response', () => {
  assert.deepEqual(orderVoices(null), []);
});

test('previewErrorMessage maps by error code, not status', () => {
  assert.equal(previewErrorMessage('tts_quota'), 'Hết lượt nghe thử, thử lại sau');
  assert.equal(previewErrorMessage('rate_limited'), 'Nghe thử nhiều quá, đợi 1 phút');
  assert.equal(previewErrorMessage('provider_unavailable'), 'Giọng này chưa được cấu hình');
  assert.equal(previewErrorMessage('offline'), 'Đang ngoại tuyến');
  assert.equal(previewErrorMessage('network_error'), 'Đang ngoại tuyến');
  assert.equal(previewErrorMessage('whatever'), 'Không nghe thử được');
});
