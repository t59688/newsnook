import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

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
  type PageSlice,
  type ReaderLayoutAnchor,
} from '../lib/readerPagination'
import {
  readingPositionOf,
  rememberReadingPosition,
  resolveScrollTop,
} from '../lib/readingPosition'

const PLACEHOLDER_PAGES: PageSlice[] = [{ startOffset: 0, endOffset: 0 }]

function isPlaceholderPages(pages: PageSlice[]): boolean {
  return pages.length === 1 && pages[0]!.startOffset === 0 && pages[0]!.endOffset === 0
}

function samePageSlices(left: PageSlice[], right: PageSlice[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (page, index) =>
        page.startOffset === right[index]!.startOffset &&
        page.endOffset === right[index]!.endOffset,
    )
  )
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
  goPrev: () => void
  goNext: () => void
  setPageIndex: (index: number) => void
  handleTap: (clientX: number, width: number) => 'prev' | 'next' | 'toggleChrome'
  pageOffset: number
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
  const [pages, setPages] = useState<PageSlice[]>(PLACEHOLDER_PAGES)
  const [pageIndex, setPageIndexState] = useState(0)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const pageIndexRef = useRef(pageIndex)
  pageIndexRef.current = pageIndex
  const pageHeightRef = useRef(0)
  const layoutAnchorRef = useRef<ReaderLayoutAnchor | null>(null)
  const articleIdRef = useRef(articleId)

  /**
   * 页码与滚动位置共用一张跨会话的表：保存当前页的内容偏移及当时
   * 可滚动范围。视口或字号变化后按比例恢复，再映射到新的视觉页。
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

  const readStoredPosition = useCallback(
    () => readingPositionOf(articleId),
    [articleId],
  )

  const remeasure = useCallback(
    (opts?: { scrollAnchor?: number }) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      if (!viewport || !content) return

      const height = Math.max(viewport.clientHeight, 1)
      pageHeightRef.current = height
      viewport.style.setProperty('--reader-page-height', `${height}px`)

      const nextPages = paginateOffsets(collectVisualBreakOffsets(content), height)
      const previousPages = pagesRef.current
      const previousIndex = clampPageIndex(pageIndexRef.current, previousPages.length)

      let anchorOffset: number | null =
        typeof opts?.scrollAnchor === 'number'
          ? Math.max(0, opts.scrollAnchor)
          : resolveReaderLayoutAnchor(content, layoutAnchorRef.current)
      const stored = anchorOffset === null ? readStoredPosition() : null

      if (anchorOffset === null && stored) {
        const contentEnd = nextPages[nextPages.length - 1]?.endOffset ?? 0
        const currentRange = Math.max(contentEnd - height, 0)
        anchorOffset = resolveScrollTop(stored, currentRange)
      }

      if (anchorOffset === null && !isPlaceholderPages(previousPages)) {
        anchorOffset = previousPages[previousIndex]?.startOffset ?? 0
      }

      const nextIndex =
        anchorOffset !== null
          ? findPageIndex(nextPages, anchorOffset)
          : stored?.pageIndex !== undefined
            ? clampPageIndex(stored.pageIndex, nextPages.length)
            : clampPageIndex(previousIndex, nextPages.length)

      if (!samePageSlices(previousPages, nextPages)) {
        pagesRef.current = nextPages
        setPages(nextPages)
      }

      if (nextIndex !== pageIndexRef.current) {
        pageIndexRef.current = nextIndex
        setPageIndexState(nextIndex)
      }
      writeStoredPage(nextIndex, nextPages)
    },
    [contentRef, readStoredPosition, viewportRef, writeStoredPage],
  )

  // Do not carry a previous article's page index or DOM anchor into the next one.
  useLayoutEffect(() => {
    if (articleIdRef.current === articleId) return
    articleIdRef.current = articleId
    pagesRef.current = PLACEHOLDER_PAGES
    pageIndexRef.current = 0
    layoutAnchorRef.current = null
    setPages(PLACEHOLDER_PAGES)
    setPageIndexState(0)
  }, [articleId])

  useLayoutEffect(() => {
    if (!enabled || !ready) return
    remeasure()
  }, [enabled, ready, measureKey, remeasure])

  // Content height can change after the first layout (images, embeds, late fonts,
  // translation and provider-rendered DOM). Coalesce all signals into one frame.
  useEffect(() => {
    if (!enabled || !ready) return
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return

    let disposed = false
    let frame: number | null = null
    const scheduleRemeasure = () => {
      if (disposed || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (!disposed) remeasure()
      })
    }

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleRemeasure)
    resizeObserver?.observe(viewport)
    resizeObserver?.observe(content)

    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? null
        : new MutationObserver(scheduleRemeasure)
    mutationObserver?.observe(content, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src', 'srcset', 'width', 'height', 'hidden', 'open'],
    })

    const rootMutationObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(scheduleRemeasure)
    rootMutationObserver?.observe(content.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme', 'data-scheme'],
    })

    content.addEventListener('load', scheduleRemeasure, true)
    content.addEventListener('error', scheduleRemeasure, true)
    window.addEventListener('resize', scheduleRemeasure)
    window.addEventListener('orientationchange', scheduleRemeasure)

    const visualViewport = window.visualViewport
    visualViewport?.addEventListener('resize', scheduleRemeasure)

    const fonts = content.ownerDocument.fonts
    fonts?.addEventListener('loadingdone', scheduleRemeasure)
    void fonts?.ready.then(scheduleRemeasure).catch(() => undefined)

    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      rootMutationObserver?.disconnect()
      content.removeEventListener('load', scheduleRemeasure, true)
      content.removeEventListener('error', scheduleRemeasure, true)
      window.removeEventListener('resize', scheduleRemeasure)
      window.removeEventListener('orientationchange', scheduleRemeasure)
      visualViewport?.removeEventListener('resize', scheduleRemeasure)
      fonts?.removeEventListener('loadingdone', scheduleRemeasure)
    }
  }, [enabled, ready, remeasure, viewportRef, contentRef, measureKey])

  useEffect(() => {
    if (!enabled) {
      layoutAnchorRef.current = null
      return
    }

    const currentPages = pagesRef.current
    const index = clampPageIndex(pageIndex, currentPages.length)
    const pageOffset = currentPages[index]?.startOffset ?? 0
    writeStoredPage(index, currentPages)

    const content = contentRef.current
    if (content) {
      layoutAnchorRef.current = captureReaderLayoutAnchor(content, pageOffset)
    }
  }, [enabled, pageIndex, pages, writeStoredPage, contentRef])

  const goPrev = useCallback(() => {
    const next = clampPageIndex(pageIndexRef.current - 1, pagesRef.current.length)
    pageIndexRef.current = next
    setPageIndexState(next)
    writeStoredPage(next)
  }, [writeStoredPage])

  const goNext = useCallback(() => {
    const next = clampPageIndex(pageIndexRef.current + 1, pagesRef.current.length)
    pageIndexRef.current = next
    setPageIndexState(next)
    writeStoredPage(next)
  }, [writeStoredPage])

  const setPageIndex = useCallback(
    (index: number) => {
      const next = clampPageIndex(index, pagesRef.current.length)
      pageIndexRef.current = next
      setPageIndexState(next)
      writeStoredPage(next)
    },
    [writeStoredPage],
  )

  const handleTap = useCallback((clientX: number, width: number) => {
    return resolvePageTapZone(clientX, width)
  }, [])

  const syncFromScrollTop = useCallback(
    (scrollTop: number) => {
      const viewport = viewportRef.current
      const content = contentRef.current
      const currentPages = pagesRef.current
      const currentIndex = clampPageIndex(pageIndexRef.current, currentPages.length)
      const translatedOffset = currentPages[currentIndex]?.startOffset ?? 0
      const anchor =
        viewport && content
          ? contentOffsetAtViewportTop(
              viewport.getBoundingClientRect().top,
              content.getBoundingClientRect().top,
              translatedOffset,
            )
          : scrollTop
      remeasure({ scrollAnchor: anchor })
    },
    [contentRef, remeasure, viewportRef],
  )

  const safeIndex = clampPageIndex(pageIndex, pages.length)
  const page = pages[safeIndex] ?? { startOffset: 0, endOffset: 0 }
  const pageOffset = page.startOffset

  const currentStartOffset = useCallback(() => {
    const list = pagesRef.current
    const index = clampPageIndex(pageIndexRef.current, list.length)
    const pageOffset = list[index]?.startOffset ?? 0
    const viewport = viewportRef.current
    const content = contentRef.current
    if (!viewport || !content) return pageOffset

    return scrollTopForPagedOffset(
      pageOffset,
      viewport.getBoundingClientRect().top,
      content.getBoundingClientRect().top,
    )
  }, [contentRef, viewportRef])

  return {
    pages,
    pageIndex: safeIndex,
    goPrev,
    goNext,
    setPageIndex,
    handleTap,
    pageOffset,
    syncFromScrollTop,
    currentStartOffset,
  }
}
