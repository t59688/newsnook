export type PageTapZone = 'prev' | 'toggleChrome' | 'next'

export function resolvePageTapZone(
  clientX: number,
  width: number,
  leftRatio = 0.28,
  rightRatio = 0.28,
): PageTapZone {
  if (width <= 0) return 'toggleChrome'
  const x = Math.min(Math.max(clientX, 0), width)
  if (x < width * leftRatio) return 'prev'
  if (x > width * (1 - rightRatio)) return 'next'
  return 'toggleChrome'
}

export interface PageSlice {
  startOffset: number
  endOffset: number
}

export interface ReaderLayoutAnchor {
  element: Element
  /** Progress through the anchor element, retained when its height changes. */
  progress: number
}

/** Resolve the content-relative offset currently aligned with the viewport top. */
export function contentOffsetAtViewportTop(
  viewportTop: number,
  contentTop: number,
  translatedOffset = 0,
): number {
  if (
    !Number.isFinite(viewportTop) ||
    !Number.isFinite(contentTop) ||
    !Number.isFinite(translatedOffset)
  ) {
    return 0
  }
  return Math.max(0, viewportTop - contentTop - translatedOffset)
}

/** Convert a paged content offset back to the scroll container's coordinate space. */
export function scrollTopForPagedOffset(
  pageOffset: number,
  viewportTop: number,
  contentTop: number,
): number {
  if (
    !Number.isFinite(pageOffset) ||
    !Number.isFinite(viewportTop) ||
    !Number.isFinite(contentTop)
  ) {
    return 0
  }

  return Math.max(0, pageOffset + contentTop - viewportTop)
}

interface TextLineRect {
  node: Text
  top: number
  bottom: number
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function collectTextLineRects(content: HTMLElement): TextLineRect[] {
  const doc = content.ownerDocument
  if (typeof doc.createRange !== 'function') return []

  const result: TextLineRect[] = []
  const range = doc.createRange()
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const text = node as Text
      if (!text.data.trim()) return

      try {
        range.selectNodeContents(text)
        for (const rect of Array.from(range.getClientRects())) {
          if (!isFinitePositive(rect.height)) continue
          result.push({ node: text, top: rect.top, bottom: rect.bottom })
        }
      } catch {
        // Older WebViews may expose Range but fail for detached or unusual nodes.
      }
      return
    }

    if (node.nodeType === 1) {
      const element = node as Element
      const tag = element.tagName.toLowerCase()
      if (
        tag === 'script' ||
        tag === 'style' ||
        tag === 'noscript' ||
        element.hasAttribute('hidden') ||
        element.getAttribute('aria-hidden') === 'true'
      ) {
        return
      }
    }

    for (const child of Array.from(node.childNodes)) visit(child)
  }

  visit(content)
  return result
}

function isFlowBreakElement(element: Element, display: string): boolean {
  if (
    display === 'none' ||
    display === 'contents' ||
    display === 'inline' ||
    display === 'table-cell' ||
    display === 'table-column' ||
    display === 'table-column-group'
  ) {
    return false
  }

  const tag = element.tagName.toLowerCase()
  if (
    tag === 'img' ||
    tag === 'video' ||
    tag === 'iframe' ||
    tag === 'canvas' ||
    tag === 'svg' ||
    tag === 'hr' ||
    tag === 'tr' ||
    tag === 'table'
  ) {
    return true
  }

  return Boolean(display)
}

function sortedUniqueOffsets(values: number[]): number[] {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value * 100) / 100)
    .sort((a, b) => a - b)

  const unique: number[] = []
  for (const value of sorted) {
    const lastIndex = unique.length - 1
    if (lastIndex < 0 || value - unique[lastIndex]! > 1) {
      unique.push(value)
    } else {
      unique[lastIndex] = Math.max(unique[lastIndex]!, value)
    }
  }
  return unique
}

/**
 * Collect legal visual break positions relative to the content root.
 *
 * Text is measured by rendered Range fragments (one fragment per visual line),
 * not only by paragraph/block bottoms. Block and replaced-element bottoms are
 * also included so short paragraphs, figures, tables and media remain together
 * whenever they fit on the current page.
 */
export function collectVisualBreakOffsets(content: HTMLElement): number[] {
  const rootTop = content.getBoundingClientRect().top
  const offsets: number[] = []

  const textRects = collectTextLineRects(content)
  textRects.sort((a, b) => a.top - b.top || a.bottom - b.bottom)

  // Inline fragments from adjacent text nodes on the same visual line overlap.
  // Merge those fragments so a page never breaks between styled words on a line.
  let lineTop = Number.NEGATIVE_INFINITY
  let lineBottom = Number.NEGATIVE_INFINITY
  for (const rect of textRects) {
    if (rect.top < lineBottom - 0.5 || Math.abs(rect.top - lineTop) <= 1) {
      lineTop = Math.min(lineTop, rect.top)
      lineBottom = Math.max(lineBottom, rect.bottom)
      continue
    }

    if (Number.isFinite(lineBottom)) offsets.push(lineBottom - rootTop)
    lineTop = rect.top
    lineBottom = rect.bottom
  }
  if (Number.isFinite(lineBottom)) offsets.push(lineBottom - rootTop)

  const view = content.ownerDocument.defaultView
  for (const element of Array.from(content.querySelectorAll('*'))) {
    const rect = element.getBoundingClientRect()
    if (!isFinitePositive(rect.height)) continue

    let display = ''
    let position = ''
    let visibility = ''
    try {
      const style = view?.getComputedStyle(element)
      display = style?.display ?? ''
      position = style?.position ?? ''
      visibility = style?.visibility ?? ''
    } catch {
      // Tag-based fallbacks below still provide useful break positions.
    }

    if (position === 'absolute' || position === 'fixed' || visibility === 'hidden') continue

    const tag = element.tagName.toLowerCase()
    const isAtomic = ['img', 'video', 'iframe', 'canvas', 'svg', 'hr', 'tr', 'table'].includes(tag)
    if (isAtomic || isFlowBreakElement(element, display)) {
      offsets.push(rect.bottom - rootTop)
    }
  }

  // Include trailing padding/margins and any non-text content not represented by
  // Range fragments. scrollHeight is in the same coordinate space as rootTop.
  offsets.push(Math.max(content.scrollHeight, content.getBoundingClientRect().height))
  return sortedUniqueOffsets(offsets)
}

/**
 * Capture the block intersecting the top of the current visual page. Keeping a
 * DOM anchor lets a later image/font/layout reflow preserve the same reading
 * position instead of reusing a stale absolute pixel offset.
 */
export function captureReaderLayoutAnchor(
  content: HTMLElement,
  pageOffset: number,
): ReaderLayoutAnchor | null {
  const contentRect = content.getBoundingClientRect()
  const viewportTop = contentRect.top + Math.max(pageOffset, 0)
  const lines = collectTextLineRects(content).sort((a, b) => a.top - b.top)

  let visibleLine: TextLineRect | undefined
  for (const line of lines) {
    if (line.bottom > viewportTop + 0.5) {
      visibleLine = line
      break
    }
  }

  let anchorElement: Element | null = visibleLine?.node.parentElement ?? null
  const view = content.ownerDocument.defaultView
  while (anchorElement && anchorElement !== content) {
    let display = ''
    try {
      display = view?.getComputedStyle(anchorElement).display ?? ''
    } catch {
      // Fall back to semantic block tags when computed styles are unavailable.
    }
    if (
      (display && display !== 'inline' && display !== 'contents') ||
      /^(p|li|blockquote|pre|h[1-6]|figure|table|tr|section|article)$/i.test(anchorElement.tagName)
    ) {
      break
    }
    anchorElement = anchorElement.parentElement
  }

  if (!anchorElement || anchorElement === content) {
    for (const element of Array.from(
      content.querySelectorAll('img,video,iframe,canvas,svg,figure,table,pre'),
    )) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom > viewportTop + 0.5) {
        anchorElement = element
        break
      }
    }
  }

  if (!anchorElement || anchorElement === content || !content.contains(anchorElement)) return null

  const rect = anchorElement.getBoundingClientRect()
  const progress =
    rect.height > 0
      ? Math.min(Math.max((viewportTop - rect.top) / rect.height, 0), 1)
      : 0

  return { element: anchorElement, progress }
}

/** Resolve a previously captured anchor after the content has reflowed. */
export function resolveReaderLayoutAnchor(
  content: HTMLElement,
  anchor: ReaderLayoutAnchor | null,
): number | null {
  if (!anchor || !anchor.element.isConnected || !content.contains(anchor.element)) return null

  const rootTop = content.getBoundingClientRect().top
  const rect = anchor.element.getBoundingClientRect()
  const offset = rect.top - rootTop + rect.height * anchor.progress
  if (!Number.isFinite(offset)) return null
  return Math.max(0, Math.min(offset, content.scrollHeight))
}

/**
 * Convert visual break positions into consecutive viewport-sized pages.
 *
 * The last legal line/block boundary that fits is preferred. If a single
 * unbreakable item is taller than a page (for example a very tall image in a
 * legacy WebView), a hard viewport boundary is used as a last resort; media is
 * separately constrained in eink CSS so images are fitted rather than cropped.
 */
export function paginateOffsets(breakOffsets: number[], pageHeight: number): PageSlice[] {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
    return [{ startOffset: 0, endOffset: 0 }]
  }

  const boundaries = sortedUniqueOffsets(breakOffsets)
  if (!boundaries.length) return [{ startOffset: 0, endOffset: 0 }]

  const totalEnd = boundaries[boundaries.length - 1]!
  const pages: PageSlice[] = []
  let start = 0
  let cursor = 0

  while (start < totalEnd) {
    const limit = start + pageHeight
    while (cursor < boundaries.length && boundaries[cursor]! <= limit + 0.5) {
      cursor += 1
    }

    let end = cursor > 0 ? boundaries[cursor - 1]! : 0
    if (end <= start + 0.5) {
      end = Math.min(start + pageHeight, totalEnd)
    }

    // Guard against malformed/duplicate offsets and guarantee forward progress.
    end = Math.min(Math.max(end, start + 0.5), totalEnd)
    pages.push({ startOffset: start, endOffset: end })
    start = end
  }

  return pages.length ? pages : [{ startOffset: 0, endOffset: totalEnd }]
}

export function findPageIndex(pages: PageSlice[], offset: number): number {
  if (!pages.length) return 0
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]!
    if (offset < page.endOffset || i === pages.length - 1) return i
  }
  return pages.length - 1
}

export function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  return Math.min(Math.max(index, 0), pageCount - 1)
}
