import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import {
  clampPageIndex,
  findPageIndex,
  paginateOffsets,
  resolvePageTapZone,
  type PageSlice,
} from '../lib/readerPagination'
import { readingPositionOf, rememberReadingPosition } from '../lib/readingPosition'

function isPlaceholderPages(pages: PageSlice[]): boolean {
  return pages.length === 1 && pages[0]!.startOffset === 0 && pages[0]!.endOffset === 0
}

interface Options {
  enabled: boolean
  articleId: string
  viewportRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  measureKey: string
  ready: boolean
}

export interface PagedReaderApi {
  pages: PageSlice[]
  pageIndex: number
  pageHeight: number
  goPrev: () => void
  goNext: () => void
  setPageIndex: (index: number) => void
  handleTap: (clientX: number, width: number) => 'prev' | 'next' | 'toggleChrome'
  pageOffset: number
  pageSliceHeight: number
  /** 按滚动偏移重新测量并落到对应页（阅读中开启 eink 用） */
  syncFromScrollTop: (scrollTop: number) => void
  currentStartOffset: () => number
}

export function usePagedReader({
  enabled,
  articleId,
  viewportRef,
  contentRef,
  measureKey,
  ready,
}: Options): PagedReaderApi {
  const [pages, setPages] = useState<PageSlice[]>([{ startOffset: 0, endOffset: 0 }])
  const [pageIndex, setPageIndexState] = useState(0)
  const [pageHeight, setPageHeight] = useState(0)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const pageHeightRef = useRef(pageHeight)
  pageHeightRef.current = pageHeight

  /**
   * 页码与滚动位置共用一张跨会话的表：这里同时写下该页的内容偏移，
   * 关掉墨水屏改回滚动阅读时才能落在同一段文字上。
   */
  const writeStoredPage = useCallback(
    (index: number, nextPages: PageSlice[] = pagesRef.current) => {
      const clamped = clampPageIndex(index, nextPages.length)
      const startOffset = nextPages[clamped]?.startOffset ?? 0
      const contentEnd = nextPages[nextPages.length - 1]?.endOffset ?? 0
      const scrollRange = Math.max(contentEnd - pageHeightRef.current, 0)
      rememberReadingPosition(articleId, {
        scrollTop: startOffset,
        ...(scrollRange > 0 ? { scrollRange } : {}),
        pageIndex: clamped,
      })
    },
    [articleId],
  )

  const readStoredPage = useCallback(
    () => readingPositionOf(articleId)?.pageIndex ?? null,
    [articleId],
  )

  const collectBlockEnds = useCallback((content: HTMLElement, height: number): number[] => {
    const rootBox = content.getBoundingClientRect()
    const blockEnds: number[] = []

    const pushEnd = (el: Element) => {
      const box = el.getBoundingClientRect()
      const end = box.bottom - rootBox.top
      if (end > 0) blockEnds.push(end)
    }

    const prose = content.querySelector('.reader-prose')
    for (const child of Array.from(content.children)) {
      if (prose && child.contains(prose)) {
        for (const before of Array.from(child.children)) {
          if (before === prose || before.contains(prose)) break
          pushEnd(before)
        }
        const proseBlocks = Array.from(prose.children)
        if (proseBlocks.length) {
          for (const block of proseBlocks) pushEnd(block)
        } else {
          pushEnd(prose)
        }
        let after = false
        for (const node of Array.from(child.children)) {
          if (node === prose || node.contains(prose)) {
            after = true
            continue
          }
          if (after) pushEnd(node)
        }
      } else {
        pushEnd(child)
      }
    }

    if (!blockEnds.length) {
      blockEnds.push(Math.max(content.scrollHeight, height))
    }

    for (let i = 1; i < blockEnds.length; i++) {
      if (blockEnds[i]! < blockEnds[i - 1]!) blockEnds[i] = blockEnds[i - 1]!
    }
    return blockEnds
  }, [])

  const remeasure = useCallback(
    (opts?: { scrollAnchor?: number }) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content) return

      const height = Math.max(viewport.clientHeight, 1)
      pageHeightRef.current = height
      setPageHeight(height)

      const blockEnds = collectBlockEnds(content, height)
      const nextPages = paginateOffsets(blockEnds, height)
      setPages(nextPages)

      setPageIndexState((prev) => {
        if (typeof opts?.scrollAnchor === 'number') {
          const idx = findPageIndex(nextPages, opts.scrollAnchor)
          writeStoredPage(idx, nextPages)
          return idx
        }

        const prevPages = pagesRef.current
        if (!isPlaceholderPages(prevPages)) {
          const anchor = prevPages[clampPageIndex(prev, prevPages.length)]?.startOffset
          if (typeof anchor === 'number') {
            const idx = findPageIndex(nextPages, anchor)
            writeStoredPage(idx, nextPages)
            return idx
          }
        }

        const stored = readStoredPage()
        if (stored != null) return clampPageIndex(stored, nextPages.length)
        return clampPageIndex(prev, nextPages.length)
      })
    },
    [collectBlockEnds, contentRef, readStoredPage, viewportRef, writeStoredPage],
  )

  useLayoutEffect(() => {
    if (!enabled || !ready) return
    remeasure()
  }, [enabled, ready, measureKey, remeasure])

  useEffect(() => {
    if (!enabled || !ready) return
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === 'undefined') return
    const obs = new ResizeObserver(() => remeasure())
    obs.observe(viewport)
    const content = contentRef.current
    if (content) obs.observe(content)
    return () => obs.disconnect()
  }, [enabled, ready, remeasure, viewportRef, contentRef, measureKey])

  useEffect(() => {
    if (!enabled) return
    writeStoredPage(pageIndex)
  }, [enabled, pageIndex, writeStoredPage])

  const goPrev = useCallback(() => {
    setPageIndexState((prev) => {
      const next = clampPageIndex(prev - 1, pagesRef.current.length)
      writeStoredPage(next)
      return next
    })
  }, [writeStoredPage])

  const goNext = useCallback(() => {
    setPageIndexState((prev) => {
      const next = clampPageIndex(prev + 1, pagesRef.current.length)
      writeStoredPage(next)
      return next
    })
  }, [writeStoredPage])

  const setPageIndex = useCallback(
    (index: number) => {
      setPageIndexState(() => {
        const next = clampPageIndex(index, pagesRef.current.length)
        writeStoredPage(next)
        return next
      })
    },
    [writeStoredPage],
  )

  const handleTap = useCallback((clientX: number, width: number) => {
    return resolvePageTapZone(clientX, width)
  }, [])

  const syncFromScrollTop = useCallback(
    (scrollTop: number) => {
      remeasure({ scrollAnchor: scrollTop })
    },
    [remeasure],
  )

  const safeIndex = clampPageIndex(pageIndex, pages.length)
  const page = pages[safeIndex] ?? { startOffset: 0, endOffset: 0 }
  const pageOffset = page.startOffset
  const pageSliceHeight = Math.max(page.endOffset - page.startOffset, 0)

  const currentStartOffset = useCallback(() => {
    const list = pagesRef.current
    const idx = clampPageIndex(pageIndex, list.length)
    return list[idx]?.startOffset ?? 0
  }, [pageIndex])

  return {
    pages,
    pageIndex: safeIndex,
    pageHeight,
    goPrev,
    goNext,
    setPageIndex,
    handleTap,
    pageOffset,
    pageSliceHeight,
    syncFromScrollTop,
    currentStartOffset,
  }
}
