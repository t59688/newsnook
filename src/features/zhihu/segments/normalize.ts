import { parseHTML } from 'linkedom'

import type { ZhihuSegmentInfoParagraph, ZhihuSegmentMeta } from '../api/decode'
import type { ZhihuEntityRef } from '../types'

export interface ZhihuSegmentTarget {
  kind: 'segment'
  contentId: string
  contentType: 'answer' | 'article'
  segmentId: string
  segmentIds: string[]
  segmentContent: string
  displayText: string
  paragraphId: string
  startOffset: number
  endOffset: number
  liked: boolean
  likeCount: number
  commentCount: number
  myCommentCount: number
  isSpan: boolean
}

interface NormalizedMark {
  startIndex: number
  endIndex: number
  meta: ZhihuSegmentMeta
  isMaster: boolean
}

interface SegmentPart {
  text: string
  mark?: NormalizedMark
}

const SUPPORTED_INLINE_TAGS = new Set(['B', 'STRONG', 'I', 'EM'])

function hasUnsupportedFormat(node: Node): boolean {
  if (node.nodeType !== 1) return false
  const element = node as Element
  if (!SUPPORTED_INLINE_TAGS.has(element.tagName.toUpperCase())) return true
  return [...element.childNodes].some(hasUnsupportedFormat)
}

function mergeMeta(marks: NormalizedMark[]): NormalizedMark {
  const masters = marks.filter((mark) => mark.isMaster)
  const ordered = [...masters, ...marks.filter((mark) => !mark.isMaster)]
  const first = marks[0]!
  return {
    startIndex: first.startIndex,
    endIndex: first.endIndex,
    isMaster: masters.length > 0,
    meta: {
      segIds: [...new Set(ordered.flatMap((mark) => mark.meta.segIds))],
      isLike: ordered.some((mark) => mark.meta.isLike),
      likeCount: Math.max(...ordered.map((mark) => mark.meta.likeCount), 0),
      commentCount: Math.max(...ordered.map((mark) => mark.meta.commentCount), 0),
      myCommentCount: Math.max(...ordered.map((mark) => mark.meta.myCommentCount), 0),
      isSpan: ordered.some((mark) => mark.meta.isSpan),
    },
  }
}

function normalizeMarks(text: string, paragraph: ZhihuSegmentInfoParagraph): NormalizedMark[] {
  const sameRange = new Map<string, NormalizedMark[]>()
  for (const source of paragraph.marks) {
    const startIndex = Math.max(0, Math.min(text.length, source.startIndex))
    const endIndex = Math.max(startIndex, Math.min(text.length, source.endIndex))
    const meta = source.segInfo ?? source.masterSegInfo
    if (!meta || startIndex >= endIndex) continue
    const key = `${startIndex}:${endIndex}`
    const bucket = sameRange.get(key) ?? []
    bucket.push({
      startIndex,
      endIndex,
      meta,
      isMaster: Boolean(source.masterSegInfo),
    })
    sameRange.set(key, bucket)
  }
  return [...sameRange.values()]
    .map(mergeMeta)
    .sort((left, right) => left.startIndex - right.startIndex || left.endIndex - right.endIndex)
}

function buildParts(text: string, paragraph: ZhihuSegmentInfoParagraph): SegmentPart[] {
  const marks = normalizeMarks(text, paragraph)
  if (marks.length === 0) return [{ text }]
  const parts: SegmentPart[] = []
  let cursor = 0
  for (const mark of marks) {
    // Overlapping ranges are ambiguous. Match the reference client and keep the first
    // accepted range instead of generating nested/partially-overlapping interactive spans.
    if (mark.startIndex < cursor) continue
    if (mark.startIndex > cursor) parts.push({ text: text.slice(cursor, mark.startIndex) })
    parts.push({ text: text.slice(mark.startIndex, mark.endIndex), mark })
    cursor = mark.endIndex
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) })
  return parts.filter((part) => part.text.length > 0)
}

function threadId(mark: NormalizedMark): string {
  return mark.meta.segIds.join(',')
}

/**
 * Inject only server-declared Zhihu paragraph segments into otherwise source HTML.
 * We deliberately refuse paragraphs whose plain text no longer exactly matches the
 * segment payload or whose inline structure contains unsupported tags. That prevents
 * stale offsets from making unrelated text clickable after upstream markup changes.
 */
export function injectZhihuSegmentHighlights(
  rawHtml: string,
  segmentInfos: ZhihuSegmentInfoParagraph[],
  ref: ZhihuEntityRef,
): string {
  if (!rawHtml.trim() || segmentInfos.length === 0 || (ref.kind !== 'answer' && ref.kind !== 'article')) return rawHtml
  try {
    const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`)
    const byPid = new Map(segmentInfos.map((paragraph) => [paragraph.pid, paragraph]))
    const prepared: Array<{ element: Element; paragraph: ZhihuSegmentInfoParagraph; parts: SegmentPart[] }> = []

    for (const element of [...document.body.querySelectorAll('p[data-pid]')]) {
      const pid = element.getAttribute('data-pid')?.trim()
      if (!pid) continue
      const paragraph = byPid.get(pid)
      if (!paragraph) continue
      const text = element.textContent ?? ''
      if (text !== paragraph.text) continue
      if ([...element.childNodes].some(hasUnsupportedFormat)) continue
      const parts = buildParts(text, paragraph)
      if (!parts.some((part) => part.mark?.meta.segIds.length)) continue
      prepared.push({ element, paragraph, parts })
    }

    // A span segment can be split over more than one paragraph. The reference client
    // presents the whole logical segment in its action sheet, so preserve that display text.
    const spanFragments = new Map<string, Array<{ pid: string; text: string }>>()
    for (const item of prepared) {
      for (const part of item.parts) {
        const mark = part.mark
        if (!mark?.meta.isSpan) continue
        const id = threadId(mark)
        if (!id) continue
        const fragments = spanFragments.get(id) ?? []
        fragments.push({ pid: item.paragraph.pid, text: part.text })
        spanFragments.set(id, fragments)
      }
    }
    const spanDisplayText = new Map<string, string>()
    for (const [id, fragments] of spanFragments) {
      let result = ''
      let previousPid: string | undefined
      for (const fragment of fragments) {
        if (result && previousPid !== fragment.pid) result += '\n\n'
        result += fragment.text
        previousPid = fragment.pid
      }
      spanDisplayText.set(id, result)
    }
    const displayOwner = new Set(spanDisplayText.keys())

    for (const item of prepared) {
      item.element.replaceChildren()
      for (const part of item.parts) {
        const mark = part.mark
        const id = mark ? threadId(mark) : ''
        if (!mark || !id) {
          item.element.append(document.createTextNode(part.text))
          continue
        }
        const span = document.createElement('span')
        span.setAttribute('data-reader-role', 'zhihu-segment')
        span.setAttribute('data-zhihu-segment-id', id)
        span.setAttribute('data-zhihu-content-id', ref.id)
        span.setAttribute('data-zhihu-content-type', ref.kind)
        span.setAttribute('data-zhihu-segment-pid', item.paragraph.pid)
        span.setAttribute('data-zhihu-segment-start', String(mark.startIndex))
        span.setAttribute('data-zhihu-segment-end', String(mark.endIndex))
        span.setAttribute('data-zhihu-segment-liked', String(mark.meta.isLike))
        span.setAttribute('data-zhihu-segment-like-count', String(mark.meta.likeCount))
        span.setAttribute('data-zhihu-segment-comment-count', String(mark.meta.commentCount))
        span.setAttribute('data-zhihu-segment-my-comment-count', String(mark.meta.myCommentCount))
        span.setAttribute('data-zhihu-segment-is-span', String(mark.meta.isSpan))
        if (mark.meta.isSpan && displayOwner.delete(id)) {
          const display = spanDisplayText.get(id)
          if (display && display !== part.text) span.setAttribute('data-zhihu-segment-display-text', display)
        }
        span.textContent = part.text
        item.element.append(span)
      }
    }
    return document.body.innerHTML
  } catch {
    return rawHtml
  }
}

function intAttr(element: Element, name: string): number | null {
  const value = Number.parseInt(element.getAttribute(name) ?? '', 10)
  return Number.isFinite(value) ? value : null
}

export function segmentTargetFromElement(element: Element): ZhihuSegmentTarget | null {
  const segment = element.closest('[data-reader-role="zhihu-segment"]')
  if (!segment) return null
  const contentType = segment.getAttribute('data-zhihu-content-type')
  const contentId = segment.getAttribute('data-zhihu-content-id')?.trim()
  const segmentId = segment.getAttribute('data-zhihu-segment-id')?.trim()
  const paragraphId = segment.getAttribute('data-zhihu-segment-pid')?.trim()
  const startOffset = intAttr(segment, 'data-zhihu-segment-start')
  const endOffset = intAttr(segment, 'data-zhihu-segment-end')
  if ((contentType !== 'answer' && contentType !== 'article') || !contentId || !segmentId || !paragraphId || startOffset == null || endOffset == null) return null
  const segmentContent = segment.textContent ?? ''
  if (!segmentContent || startOffset >= endOffset) return null
  return {
    kind: 'segment',
    contentId,
    contentType,
    segmentId,
    segmentIds: segmentId.split(',').map((item) => item.trim()).filter(Boolean),
    segmentContent,
    displayText: segment.getAttribute('data-zhihu-segment-display-text') || segmentContent,
    paragraphId,
    startOffset,
    endOffset,
    liked: segment.getAttribute('data-zhihu-segment-liked') === 'true',
    likeCount: intAttr(segment, 'data-zhihu-segment-like-count') ?? 0,
    commentCount: intAttr(segment, 'data-zhihu-segment-comment-count') ?? 0,
    myCommentCount: intAttr(segment, 'data-zhihu-segment-my-comment-count') ?? 0,
    isSpan: segment.getAttribute('data-zhihu-segment-is-span') === 'true',
  }
}
