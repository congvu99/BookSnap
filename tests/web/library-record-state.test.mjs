import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as recordState from '../../web/js/library-record-state.js';

const { isPlayableKind, recordKind } = recordState;

test('recordKind maps busy and blocked phases to their picture', () => {
  assert.equal(recordKind('failed', 0), 'failed');
  assert.equal(recordKind('quota', 0), 'quota');
  assert.equal(recordKind('tail_wait', 0), 'tail');
  assert.equal(recordKind('ocr', 0), 'ocr');
  assert.equal(recordKind('tts', 40), 'pressing');
  assert.equal(recordKind('empty', 0), 'empty');
});

test('recordKind keeps an offline copy that is still processing as a pressing record', () => {
  assert.equal(recordKind('processing', 0), 'pressing');
});

test('recordKind falls back to an empty record for an unknown phase', () => {
  assert.equal(recordKind('something-new', 0), 'empty');
});

test('recordKind on a ready book follows how much was listened', () => {
  assert.equal(recordKind('ready', 0), 'fresh');
  assert.equal(recordKind('ready', 1), 'listening');
  assert.equal(recordKind('ready', 99), 'listening');
  assert.equal(recordKind('ready', 100), 'done');
});

test('isPlayableKind is true only for ready records', () => {
  assert.deepEqual(
    ['fresh', 'listening', 'done', 'ocr', 'pressing', 'quota', 'tail', 'failed', 'empty'].filter(isPlayableKind),
    ['fresh', 'listening', 'done'],
  );
});

test('spokenRecordStatus always keeps the creator when visible metadata becomes artwork', () => {
  assert.equal(recordState.spokenRecordStatus('Bố', 'Chờ lượt Gemini'), 'Chụp bởi Bố · Chờ lượt Gemini');
  assert.equal(recordState.spokenRecordStatus('Mẹ', 'còn 2 phút'), 'Chụp bởi Mẹ · còn 2 phút');
  assert.equal(recordState.spokenRecordStatus('', 'Có lỗi'), 'Có lỗi');
});

test('perpetual record-state animations freeze for reduced-motion users', () => {
  const css = readFileSync(new URL('../../web/css/library.css', import.meta.url), 'utf8');
  const reduced = css.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  for (const selector of ['.ringed-orbit', '.rart-sweep', '.rart-more']) assert.match(reduced, new RegExp(selector.replace('.', '\\.')));
  assert.match(reduced, /animation:\s*none/);
});
