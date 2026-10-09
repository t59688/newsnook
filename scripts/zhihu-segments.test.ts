import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { decodeZhihuSegmentInfos } from '../src/features/zhihu/api/decode'
import { normalizeZhihuContentHtml } from '../src/features/zhihu/content/normalize'
import { injectZhihuSegmentHighlights, segmentTargetFromElement } from '../src/features/zhihu/segments/normalize'

const decoded = decodeZhihuSegmentInfos([
  {
    pid: 'p-1',
    text: 'Hello world!',
    marks: [
      {
        startIndex: 6,
        endIndex: 11,
        segInfo: {
          segIds: ['seg-normal'],
          isLike: 0,
          likeCount: 2,
          commentCount: 3,
          myCommentCount: 0,
          isSpan: 'false',
        },
      },
      {
        start_index: 6,
        end_index: 11,
        master_seg_info: {
          seg_ids: ['seg-master'],
          is_like: 'true',
          like_count: 7,
          comment_count: 5,
          my_comment_count: 1,
          is_span: 0,
        },
      },
    ],
  },
])
assert.equal(decoded.length, 1)
assert.equal(decoded[0]?.marks.length, 2)
assert.equal(decoded[0]?.marks[0]?.segInfo?.isLike, false)
assert.equal(decoded[0]?.marks[1]?.masterSegInfo?.isLike, true)

const injected = injectZhihuSegmentHighlights(
  '<p data-pid="p-1">Hello <strong>world</strong>!</p>',
  decoded,
  { kind: 'answer', id: 'answer-1' },
)
const { document: injectedDocument } = parseHTML(`<!doctype html><html><body>${injected}</body></html>`)
const segment = injectedDocument.querySelector('[data-reader-role="zhihu-segment"]')
assert.ok(segment)
assert.equal(segment?.textContent, 'world')
assert.equal(segment?.getAttribute('data-zhihu-segment-id'), 'seg-master,seg-normal')
assert.equal(segment?.getAttribute('data-zhihu-segment-liked'), 'true')
assert.equal(segment?.getAttribute('data-zhihu-segment-like-count'), '7')
assert.equal(segment?.getAttribute('data-zhihu-segment-comment-count'), '5')

const normalized = normalizeZhihuContentHtml(
  '<p data-pid="p-1">Hello <strong>world</strong>!</p>',
  decoded,
  { kind: 'answer', id: 'answer-1' },
)
assert.match(normalized, /data-reader-role="zhihu-segment"/)
assert.match(normalized, /data-zhihu-segment-id="seg-master,seg-normal"/)
assert.doesNotMatch(normalized, /onclick=/i)

const mismatch = injectZhihuSegmentHighlights(
  '<p data-pid="p-1">Hello changed!</p>',
  decoded,
  { kind: 'answer', id: 'answer-1' },
)
assert.doesNotMatch(mismatch, /zhihu-segment/, '服务端 text 与当前正文不一致时不得套用旧 offset')

const unsupportedInline = injectZhihuSegmentHighlights(
  '<p data-pid="p-1">Hello <a href="https://example.com">world</a>!</p>',
  decoded,
  { kind: 'answer', id: 'answer-1' },
)
assert.doesNotMatch(unsupportedInline, /zhihu-segment/, '复杂链接结构不得为套 offset 被粗暴重写')

const overlaps = decodeZhihuSegmentInfos([
  {
    pid: 'p-overlap',
    text: 'abcdefghij',
    marks: [
      { startIndex: 0, endIndex: 5, segInfo: { segIds: ['first'], isLike: false, likeCount: 0, commentCount: 1, myCommentCount: 0, isSpan: false } },
      { startIndex: 3, endIndex: 8, segInfo: { segIds: ['overlap'], isLike: false, likeCount: 0, commentCount: 1, myCommentCount: 0, isSpan: false } },
      { startIndex: 8, endIndex: 10, segInfo: { segIds: ['last'], isLike: false, likeCount: 0, commentCount: 1, myCommentCount: 0, isSpan: false } },
    ],
  },
])
const overlapHtml = injectZhihuSegmentHighlights(
  '<p data-pid="p-overlap">abcdefghij</p>',
  overlaps,
  { kind: 'article', id: 'article-1' },
)
const { document: overlapDocument } = parseHTML(`<!doctype html><html><body>${overlapHtml}</body></html>`)
assert.deepEqual(
  [...overlapDocument.querySelectorAll('[data-reader-role="zhihu-segment"]')].map((node) => node.getAttribute('data-zhihu-segment-id')),
  ['first', 'last'],
  '后来的部分重叠 segment 必须跳过，不能生成交叉可点击范围',
)

const crossParagraph = decodeZhihuSegmentInfos([
  {
    pid: 'p-a',
    text: '第一段末尾',
    marks: [{ startIndex: 3, endIndex: 5, segInfo: { segIds: ['span-1'], isLike: false, likeCount: 1, commentCount: 2, myCommentCount: 0, isSpan: true } }],
  },
  {
    pid: 'p-b',
    text: '第二段开头',
    marks: [{ startIndex: 0, endIndex: 3, segInfo: { segIds: ['span-1'], isLike: false, likeCount: 1, commentCount: 2, myCommentCount: 0, isSpan: true } }],
  },
])
const crossHtml = injectZhihuSegmentHighlights(
  '<p data-pid="p-a">第一段末尾</p><p data-pid="p-b">第二段开头</p>',
  crossParagraph,
  { kind: 'answer', id: 'answer-2' },
)
const { document: crossDocument } = parseHTML(`<!doctype html><html><body>${crossHtml}</body></html>`)
const crossNodes = [...crossDocument.querySelectorAll('[data-reader-role="zhihu-segment"]')]
assert.equal(crossNodes.length, 2)
assert.equal(crossNodes[0]?.getAttribute('data-zhihu-segment-display-text'), '末尾\n\n第二段')

const parsedTarget = segmentTargetFromElement(segment!)
assert.ok(parsedTarget)
assert.deepEqual(parsedTarget?.segmentIds, ['seg-master', 'seg-normal'])
assert.equal(parsedTarget?.contentType, 'answer')
assert.equal(parsedTarget?.contentId, 'answer-1')
assert.equal(parsedTarget?.paragraphId, 'p-1')
assert.equal(parsedTarget?.startOffset, 6)
assert.equal(parsedTarget?.endOffset, 11)
assert.equal(parsedTarget?.liked, true)
assert.equal(parsedTarget?.likeCount, 7)
assert.equal(parsedTarget?.commentCount, 5)

console.log('zhihu segment decode/highlight contract ok')
