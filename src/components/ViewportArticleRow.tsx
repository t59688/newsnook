import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { ArticleRow } from './ArticleItem'

/**
 * WebView 69 cannot skip offscreen article paint via content-visibility:auto.
 * Keep its exact original <ul> / <li> structure and CSS, but substitute
 * height-preserving <li> spacers for distant cards. A 1800px preload margin
 * preserves normal scrolling, rapid flings and image presentation.
 */
const LEGACY_WINDOWING = typeof window !== 'undefined'
  && typeof IntersectionObserver !== 'undefined'
  && typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && !CSS.supports('content-visibility', 'auto')
const PRELOAD_PX = 1800

type RowProps = ComponentProps<typeof ArticleRow>

type IntersectionStore = {
  observer: IntersectionObserver
  handlers: Map<Element, (visible: boolean) => void>
}
const intersectionStores = new WeakMap<Element, IntersectionStore>()
function observeNear(row: Element, scroller: Element, handler: (visible: boolean) => void) {
  let store = intersectionStores.get(scroller)
  if (!store) {
    const handlers = new Map<Element, (visible: boolean) => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) handlers.get(entry.target)?.(entry.isIntersecting)
    }, { root: scroller, rootMargin: `${PRELOAD_PX}px 0px`, threshold: 0 })
    store = { observer, handlers }
    intersectionStores.set(scroller, store)
  }
  store.handlers.set(row, handler)
  store.observer.observe(row)
  return () => {
    store!.observer.unobserve(row)
    store!.handlers.delete(row)
    if (!store!.handlers.size) {
      store!.observer.disconnect()
      intersectionStores.delete(scroller)
    }
  }
}

// Chrome 69 reports all distant rows in one observer batch. Defer their
// cleanup to idle; React automatically batches these updates into one commit
// rather than creating 100+ independent concurrent transitions.
const pendingParks = new Set<() => void>()
let idleParkId = 0
function queuePark(action: () => void) {
  pendingParks.add(action)
  if (!idleParkId) {
    const run = () => {
      idleParkId = 0
      const work = [...pendingParks]
      pendingParks.clear()
      work.forEach(fn => fn())
    }
    idleParkId = typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(run, { timeout: 750 })
      : window.setTimeout(run, 180)
  }
  return () => pendingParks.delete(action)
}

type SizeListener = (height: number) => void
const sizeListeners = new Map<Element, SizeListener>()
let sizeObserver: ResizeObserver | null = null
function watchSize(row: Element, listener: SizeListener) {
  if (typeof ResizeObserver !== 'function') return () => undefined
  if (!sizeObserver) sizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const handler = sizeListeners.get(entry.target)
      if (handler) handler((entry.target as HTMLElement).offsetHeight)
    }
  })
  sizeListeners.set(row, listener)
  sizeObserver.observe(row)
  return () => {
    sizeObserver?.unobserve(row)
    sizeListeners.delete(row)
    if (!sizeListeners.size) {
      sizeObserver?.disconnect()
      sizeObserver = null
    }
  }
}

function LegacyViewportArticleRow(props: RowProps) {
  const rowRef = useRef<HTMLLIElement>(null)
  const measuredHeight = useRef(0)
  const isMounted = useRef(true)
  const cancelParking = useRef<(() => void) | null>(null)
  const [mounted, setMounted] = useState(true)
  isMounted.current = mounted

  useLayoutEffect(() => {
    if (mounted && rowRef.current?.offsetHeight) measuredHeight.current = rowRef.current.offsetHeight
  }, [mounted, props.article.id])

  useEffect(() => {
    const row = rowRef.current
    const scroller = row?.closest('[data-scroll-surface]')
    if (!row || !scroller) return
    return observeNear(row, scroller, visible => {
      if (visible) {
        cancelParking.current?.()
        cancelParking.current = null
        if (!isMounted.current) {
          isMounted.current = true
          setMounted(true)
        }
      } else if (isMounted.current && !cancelParking.current) {
        const size = row.offsetHeight
        if (size > 0) measuredHeight.current = size
        if (!measuredHeight.current) return
        cancelParking.current = queuePark(() => {
          cancelParking.current = null
          if (!isMounted.current) return
          isMounted.current = false
          setMounted(false)
        })
      }
    })
  }, [mounted, props.article.id])

  useEffect(() => {
    if (!mounted || !rowRef.current) return
    return watchSize(rowRef.current, height => {
      if (height > 0) measuredHeight.current = height
    })
  }, [mounted, props.article.id])

  useEffect(() => () => cancelParking.current?.(), [])
  useEffect(() => {
    const onResize = () => {
      cancelParking.current?.()
      cancelParking.current = null
      if (!isMounted.current) {
        isMounted.current = true
        setMounted(true)
      }
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!mounted) {
    return <li ref={rowRef} className="editorial-article-item article-row-item relative"
      data-read={props.read ? 'true' : 'false'} data-variant={props.variant}
      data-windowed-spacer="" style={{height: `${measuredHeight.current}px`}} aria-hidden="true" />
  }
  return <ArticleRow {...props} rootRef={rowRef} />
}

/** Modern WebViews retain their native content-visibility optimization. */
export const ViewportArticleRow = LEGACY_WINDOWING
  ? memo(LegacyViewportArticleRow)
  : ArticleRow
