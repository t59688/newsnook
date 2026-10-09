import assert from 'node:assert/strict'

import {
  READER_FONT_SCALE_MAX,
  READER_FONT_SCALE_MIN,
  clampReaderFontScale,
  formatFontScaleHud,
  pinchFontScale,
  readerFontSizeCss,
  shouldResetReaderPinchSequence,
} from '../src/lib/readerFontPinch.ts'

assert.equal(clampReaderFontScale(0.5), READER_FONT_SCALE_MIN)
assert.equal(clampReaderFontScale(2), READER_FONT_SCALE_MAX)
assert.equal(clampReaderFontScale(1.1), 1.1)
assert.equal(clampReaderFontScale(Number.NaN), 1)

assert.equal(pinchFontScale(1, 100, 110), 1.1)
assert.equal(pinchFontScale(1, 100, 80), 0.8)
assert.equal(pinchFontScale(1, 100, 200), READER_FONT_SCALE_MAX)
assert.equal(pinchFontScale(1, 0, 100), 1)
assert.equal(pinchFontScale(1.1, 50, 50), 1.1)

assert.equal(formatFontScaleHud(1), '字号 100%')
assert.equal(formatFontScaleHud(1.104), '字号 110%')
assert.equal(formatFontScaleHud(0.88), '字号 88%')

assert.equal(readerFontSizeCss(1), '15.50px')
assert.equal(readerFontSizeCss(1.1), '17.05px')

// A fresh primary touch while an old touch is still recorded means WebView
// swallowed the terminal event from the previous contact sequence. A genuine
// second finger is non-primary and must remain eligible for pinch zoom.
assert.equal(
  shouldResetReaderPinchSequence(0, { pointerType: 'touch', isPrimary: true }),
  false,
)
assert.equal(
  shouldResetReaderPinchSequence(1, { pointerType: 'touch', isPrimary: false }),
  false,
)
assert.equal(
  shouldResetReaderPinchSequence(1, { pointerType: 'touch', isPrimary: true }),
  true,
)
assert.equal(
  shouldResetReaderPinchSequence(2, { pointerType: 'touch', isPrimary: true }),
  true,
)
assert.equal(
  shouldResetReaderPinchSequence(1, { pointerType: 'pen', isPrimary: true }),
  false,
)

console.log('reader-font-pinch: ok')
