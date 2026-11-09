/** Local-first article annotations. Offsets are UTF-16 code units, as in DOM Range. */
export type AnnotationKind = 'highlight' | 'underline' | 'circle' | 'strike' | 'note' | 'insert' | 'replace' | 'transpose' | 'ink'
export interface TextAnchor {
  exact: string
  prefix: string
  suffix: string
  start: number
  end: number
}
export interface InkPoint { x: number; y: number; pressure: number; tiltX?: number; tiltY?: number }
export interface InkStroke {
  points: InkPoint[]
  color: string
  width: number
}
export interface ArticleAnnotation {
  id: string
  articleId: string
  kind: AnnotationKind
  anchor: TextAnchor
  note: string
  color: string
  strokes?: InkStroke[]
  createdAt: number
  updatedAt: number
  schema: 1
}

export function createAnchor(text: string, start: number, end: number): TextAnchor {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) {
    throw new RangeError('Invalid annotation range')
  }
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - 40), start),
    suffix: text.slice(end, end + 40),
    start,
    end,
  }
}
export function resolveAnchor(text: string, anchor: TextAnchor): { start: number; end: number } | null {
  if (anchor.start >= 0 && anchor.end <= text.length && text.slice(anchor.start, anchor.end) === anchor.exact) {
    return { start: anchor.start, end: anchor.end }
  }
  if (!anchor.exact) return null
  const candidates: number[] = []
  let at = -1
  while ((at = text.indexOf(anchor.exact, at + 1)) !== -1) {
    candidates.push(at)
    if (candidates.length > 2000) break
  }
  if (!candidates.length) return null
  const score = (offset: number) => {
    const preceding = text.slice(Math.max(0, offset - anchor.prefix.length), offset)
    const following = text.slice(offset + anchor.exact.length, offset + anchor.exact.length + anchor.suffix.length)
    let prefix = 0
    for (let i = 1; i <= Math.min(preceding.length, anchor.prefix.length); i++) {
      if (preceding.slice(-i) !== anchor.prefix.slice(-i)) break
      prefix = i
    }
    let suffix = 0
    for (let i = 1; i <= Math.min(following.length, anchor.suffix.length); i++) {
      if (following.slice(0, i) !== anchor.suffix.slice(0, i)) break
      suffix = i
    }
    return (prefix + suffix) * 100 - Math.min(Math.abs(offset - anchor.start), 100000) / 100000
  }
  candidates.sort((a, b) => score(b) - score(a))
  // Duplicate uncontextualized quotes are ambiguous: never attach an annotation to a random passage.
  if (candidates.length > 1 && score(candidates[0]!) === score(candidates[1]!)) return null
  return { start: candidates[0]!, end: candidates[0]! + anchor.exact.length }
}

/** Build a deterministic text map while ignoring UI-owned overlays. */
export function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || parent.closest('script,style,svg,[data-annotation-ui]')) return NodeFilter.FILTER_REJECT
      return node.textContent ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const result: Text[] = []
  while (walker.nextNode()) result.push(walker.currentNode as Text)
  return result
}
export function documentText(root: HTMLElement): string { return textNodes(root).map(n => n.data).join('') }
export function offsetsFromRange(root: HTMLElement, range: Range): { start: number; end: number } | null {
  if (!root.contains(range.commonAncestorContainer)) return null
  // Native touch selection can have element-boundary endpoints. Count only article text,
  // never UI-owned annotation nodes injected between paragraphs.
  const offsetAt = (container: Node, offset: number) => {
    const boundary = document.createRange()
    boundary.setStart(container, offset)
    boundary.collapse(true)
    let total = 0
    for (const node of textNodes(root)) {
      if (node === container) return total + offset
      const nodeEnd = document.createRange()
      nodeEnd.setStart(node, node.length)
      nodeEnd.collapse(true)
      if (nodeEnd.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0) total += node.data.length
      else break
    }
    return total
  }
  const start = offsetAt(range.startContainer, range.startOffset)
  const end = offsetAt(range.endContainer, range.endOffset)
  if (end <= start || end > documentText(root).length) return null
  return { start, end }
}
export function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const nodes = textNodes(root)
  const range = document.createRange()
  let position = 0
  let started = false
  for (const node of nodes) {
    const next = position + node.data.length
    if (!started && start >= position && start <= next) {
      range.setStart(node, start - position)
      started = true
    }
    if (started && end >= position && end <= next) {
      range.setEnd(node, end - position)
      return range
    }
    position = next
  }
  return null
}
