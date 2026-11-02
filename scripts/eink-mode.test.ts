import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { applyEinkMode, isEinkModeActive } from '../src/lib/eink'
import {
  captureReaderLayoutAnchor,
  clampPageIndex,
  contentOffsetAtViewportTop,
  collectVisualBreakOffsets,
  findPageIndex,
  paginateOffsets,
  resolvePageTapZone,
  resolveReaderLayoutAnchor,
  scrollTopForPagedOffset,
} from '../src/lib/readerPagination'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  setEinkMode,
} from '../src/sources/preferences'

assert.equal(DEFAULT_PREFERENCES.einkMode, false)

assert.equal(normalizePreferences({}).einkMode, false)
assert.equal(normalizePreferences({ einkMode: true }).einkMode, true)
assert.equal(normalizePreferences({ einkMode: 'yes' as unknown as boolean }).einkMode, false)

const on = setEinkMode(DEFAULT_PREFERENCES, true)
assert.equal(on.einkMode, true)
assert.equal(on.theme, DEFAULT_PREFERENCES.theme)
assert.equal(on.typography, DEFAULT_PREFERENCES.typography)
assert.equal(setEinkMode(on, true), on)
assert.equal(setEinkMode(on, false).einkMode, false)

console.log('eink-mode prefs: ok')

assert.equal(typeof applyEinkMode, 'function')
assert.equal(typeof isEinkModeActive, 'function')

if (typeof document !== 'undefined') {
  applyEinkMode(true)
  assert.equal(document.documentElement.dataset.eink, '1')
  assert.equal(isEinkModeActive(), true)
  applyEinkMode(false)
  assert.equal(document.documentElement.dataset.eink, undefined)
  assert.equal(isEinkModeActive(), false)
  console.log('eink-mode dom: ok')
} else {
  console.log('eink-mode dom: skipped (no document)')
}

assert.equal(resolvePageTapZone(10, 100), 'prev')
assert.equal(resolvePageTapZone(50, 100), 'toggleChrome')
assert.equal(resolvePageTapZone(90, 100), 'next')
assert.equal(resolvePageTapZone(0, 0), 'toggleChrome')
assert.equal(resolvePageTapZone(27, 100), 'prev')
assert.equal(resolvePageTapZone(29, 100), 'toggleChrome')
assert.equal(resolvePageTapZone(71, 100), 'toggleChrome')
assert.equal(resolvePageTapZone(73, 100), 'next')

assert.deepEqual(paginateOffsets([], 150), [{ startOffset: 0, endOffset: 0 }])
assert.deepEqual(paginateOffsets([100], Number.NaN), [{ startOffset: 0, endOffset: 0 }])
assert.deepEqual(paginateOffsets([100, 200], 0), [{ startOffset: 0, endOffset: 0 }])
assert.deepEqual(paginateOffsets([100, 200, 350, 400], 150), [
  { startOffset: 0, endOffset: 100 },
  { startOffset: 100, endOffset: 200 },
  { startOffset: 200, endOffset: 350 },
  { startOffset: 350, endOffset: 400 },
])
assert.deepEqual(paginateOffsets([80, 140], 150), [{ startOffset: 0, endOffset: 140 }])
assert.deepEqual(paginateOffsets([200], 150), [
  { startOffset: 0, endOffset: 150 },
  { startOffset: 150, endOffset: 200 },
])

const longParagraphLines = Array.from({ length: 17 }, (_, index) => (index + 1) * 24)
const longParagraphPages = paginateOffsets(longParagraphLines, 150)
assert.deepEqual(longParagraphPages, [
  { startOffset: 0, endOffset: 144 },
  { startOffset: 144, endOffset: 288 },
  { startOffset: 288, endOffset: 408 },
])
assert.ok(longParagraphPages.every((page) => page.endOffset - page.startOffset <= 150))
assert.equal(longParagraphPages[0]!.startOffset, 0)
assert.equal(longParagraphPages.at(-1)!.endOffset, 408)

const mixedBreaks = paginateOffsets([48, 96, 144, 192, 240, 288, 336, 384], 150)
assert.deepEqual(mixedBreaks, [
  { startOffset: 0, endOffset: 144 },
  { startOffset: 144, endOffset: 288 },
  { startOffset: 288, endOffset: 384 },
])
assert.deepEqual(paginateOffsets([Number.NaN, -1, 75, 150], 75), [
  { startOffset: 0, endOffset: 75 },
  { startOffset: 75, endOffset: 150 },
])
assert.deepEqual(paginateOffsets([100.4, 200.3], 100), [
  { startOffset: 0, endOffset: 100.4 },
  { startOffset: 100.4, endOffset: 200.3 },
])

for (const pageHeight of [15, 75, 150, 600]) {
  const boundaries: number[] = []
  let offset = 0
  for (let index = 0; index < 120; index++) {
    offset += ((index % 4) + 1) * 9
    boundaries.push(offset)
  }
  const generated = paginateOffsets(boundaries, pageHeight)
  assert.equal(generated[0]!.startOffset, 0)
  assert.equal(generated.at(-1)!.endOffset, offset)
  generated.forEach((page, index) => {
    assert.ok(page.endOffset > page.startOffset)
    assert.ok(page.endOffset - page.startOffset <= pageHeight)
    if (index > 0) assert.equal(page.startOffset, generated[index - 1]!.endOffset)
  })
}

const pages = paginateOffsets([100, 200, 350, 400], 150)
assert.equal(findPageIndex(pages, 0), 0)
assert.equal(findPageIndex(pages, 100), 1)
assert.equal(findPageIndex(pages, 350), 3)

assert.equal(clampPageIndex(-1, 3), 0)
assert.equal(clampPageIndex(9, 3), 2)
assert.equal(clampPageIndex(1, 0), 0)

// Scroll and paged-reader offsets use different origins: the article content
// starts below the reader chrome, and the paged surface is translated upward.
assert.equal(contentOffsetAtViewportTop(100, -300), 400)
assert.equal(contentOffsetAtViewportTop(100, -700, 400), 400)
assert.equal(contentOffsetAtViewportTop(100, 250), 0)
assert.equal(scrollTopForPagedOffset(400, 100, 250), 550)
assert.equal(scrollTopForPagedOffset(0, 100, 250), 150)

// Exercise Range-based visual-line collection and DOM-anchor restoration without
// relying on a browser layout engine in the unit-test runner.
{
  const { document, window } = parseHTML(
    '<html><body><div id="content"><p><span>A</span><strong>B</strong><span>C</span></p><img id="media"></div></body></html>',
  )
  const content = document.querySelector('#content') as unknown as HTMLElement
  const paragraph = content.querySelector('p') as unknown as HTMLElement
  const media = content.querySelector('#media') as unknown as HTMLElement
  const textNodes = Array.from(paragraph.childNodes).flatMap((child) =>
    child.nodeType === 1 ? Array.from(child.childNodes) : [child],
  )
  const [firstText, secondText, thirdText] = textNodes as Text[]
  const lineRects = new WeakMap<Node, DOMRect[]>()
  const rect = (top: number, bottom: number) =>
    ({ top, bottom, height: bottom - top, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

  lineRects.set(firstText!, [rect(110, 130)])
  lineRects.set(secondText!, [rect(112, 128)]) // inline fragment on the same line
  lineRects.set(thirdText!, [rect(130, 150)]) // next visual line

  Object.defineProperty(document, 'defaultView', { configurable: true, value: window })
  Object.defineProperty(document, 'createRange', {
    configurable: true,
    value: () => {
      let selected: Node | null = null
      return {
        selectNodeContents(node: Node) { selected = node },
        getClientRects() { return lineRects.get(selected!) ?? [] },
      }
    },
  })
  Object.defineProperty(window, 'getComputedStyle', {
    configurable: true,
    value: (element: Element) => ({
      display: element.tagName.toLowerCase() === 'p' ? 'block' : 'inline',
      position: 'static',
      visibility: 'visible',
    }),
  })
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 80 })
  Object.defineProperty(content, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(100, 180),
  })
  Object.defineProperty(paragraph, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(100, 150),
  })
  Object.defineProperty(media, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(150, 180),
  })

  assert.deepEqual(collectVisualBreakOffsets(content), [30, 50, 80])
  assert.deepEqual(paginateOffsets(collectVisualBreakOffsets(content), 30), [
    { startOffset: 0, endOffset: 30 },
    { startOffset: 30, endOffset: 50 },
    { startOffset: 50, endOffset: 80 },
  ])

  const anchor = captureReaderLayoutAnchor(content, 30)
  assert.equal(anchor?.element, paragraph)
  assert.ok(Math.abs((anchor?.progress ?? 0) - 0.6) < 0.001)

  Object.defineProperty(content, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(150, 350),
  })
  Object.defineProperty(paragraph, 'getBoundingClientRect', {
    configurable: true,
    value: () => rect(200, 250),
  })
  Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 200 })
  assert.equal(resolveReaderLayoutAnchor(content, anchor), 80)

  paragraph.remove()
  assert.equal(resolveReaderLayoutAnchor(content, anchor), null)
}

console.log('eink-mode pagination: ok')
