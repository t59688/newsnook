import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type WheelEvent } from 'react'

interface Props {
  targetRef: RefObject<HTMLElement | null>
}

interface ScrollMetrics {
  visible: boolean
  thumbHeight: number
  thumbTop: number
  percent: number
}

const MIN_THUMB_HEIGHT = 34
const EMPTY_METRICS: ScrollMetrics = {
  visible: false,
  thumbHeight: MIN_THUMB_HEIGHT,
  thumbTop: 0,
  percent: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Thin visual progress indicator with a deliberately wider invisible hit target.
 * The native scrollbar stays hidden so the reader keeps its existing visual language,
 * while mouse/touch/pen users can still drag this thumb like a real scrollbar.
 */
export function ReaderScrollIndicator({ targetRef }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragOffsetRef = useRef(0)
  const draggingRef = useRef(false)
  const frameRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS)

  const measure = useCallback(() => {
    frameRef.current = 0
    const target = targetRef.current
    const track = trackRef.current
    if (!target || !track) {
      setMetrics(EMPTY_METRICS)
      return
    }

    const scrollRange = Math.max(target.scrollHeight - target.clientHeight, 0)
    const trackHeight = Math.max(track.clientHeight, 0)
    if (scrollRange < 2 || trackHeight <= 0 || target.scrollHeight <= 0) {
      setMetrics(EMPTY_METRICS)
      return
    }

    const thumbHeight = clamp(
      (target.clientHeight / target.scrollHeight) * trackHeight,
      Math.min(MIN_THUMB_HEIGHT, trackHeight),
      trackHeight,
    )
    const travel = Math.max(trackHeight - thumbHeight, 0)
    const percent = clamp(target.scrollTop / scrollRange, 0, 1)
    setMetrics({
      visible: travel > 0,
      thumbHeight,
      thumbTop: travel * percent,
      percent: percent * 100,
    })
  }, [targetRef])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current) return
    frameRef.current = window.requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    const target = targetRef.current
    if (!target) return

    scheduleMeasure()
    target.addEventListener('scroll', scheduleMeasure, { passive: true })
    target.addEventListener('load', scheduleMeasure, true)
    window.addEventListener('resize', scheduleMeasure)

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null
    resizeObserver?.observe(target)
    if (target.firstElementChild instanceof Element) resizeObserver?.observe(target.firstElementChild)

    const mutationObserver = new MutationObserver(scheduleMeasure)
    mutationObserver.observe(target, { childList: true, subtree: true, characterData: true })

    return () => {
      target.removeEventListener('scroll', scheduleMeasure)
      target.removeEventListener('load', scheduleMeasure, true)
      window.removeEventListener('resize', scheduleMeasure)
      resizeObserver?.disconnect()
      mutationObserver.disconnect()
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [scheduleMeasure, targetRef])

  const scrollFromClientY = useCallback(
    (clientY: number) => {
      const target = targetRef.current
      const track = trackRef.current
      if (!target || !track) return
      const rect = track.getBoundingClientRect()
      const travel = Math.max(rect.height - metrics.thumbHeight, 0)
      if (travel <= 0) return
      const thumbTop = clamp(clientY - rect.top - dragOffsetRef.current, 0, travel)
      const scrollRange = Math.max(target.scrollHeight - target.clientHeight, 0)
      target.scrollTop = (thumbTop / travel) * scrollRange
    },
    [metrics.thumbHeight, targetRef],
  )

  const stopDragging = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    setDragging(false)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onPointerMove = (event: globalThis.PointerEvent) => {
      if (!draggingRef.current) return
      event.preventDefault()
      scrollFromClientY(event.clientY)
    }
    const onPointerEnd = () => stopDragging()
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [dragging, scrollFromClientY, stopDragging])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = targetRef.current
    const track = trackRef.current
    if (!target || !track || !metrics.visible) return
    event.preventDefault()
    event.stopPropagation()

    const rect = track.getBoundingClientRect()
    const y = event.clientY - rect.top
    const withinThumb = y >= metrics.thumbTop && y <= metrics.thumbTop + metrics.thumbHeight
    dragOffsetRef.current = withinThumb ? y - metrics.thumbTop : metrics.thumbHeight / 2
    draggingRef.current = true
    setDragging(true)
    scrollFromClientY(event.clientY)
  }

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const target = targetRef.current
    if (!target || !metrics.visible) return
    event.preventDefault()
    event.stopPropagation()
    target.scrollTop += event.deltaY
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = targetRef.current
    if (!target) return
    let next: number | null = null
    if (event.key === 'ArrowUp') next = target.scrollTop - 64
    else if (event.key === 'ArrowDown') next = target.scrollTop + 64
    else if (event.key === 'PageUp') next = target.scrollTop - target.clientHeight * 0.9
    else if (event.key === 'PageDown') next = target.scrollTop + target.clientHeight * 0.9
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = target.scrollHeight
    if (next == null) return
    event.preventDefault()
    event.stopPropagation()
    target.scrollTop = next
  }

  return (
    <div
      ref={trackRef}
      data-reader-scroll-indicator
      role="scrollbar"
      aria-label="阅读进度"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(metrics.percent)}
      tabIndex={metrics.visible ? 0 : -1}
      onPointerDown={onPointerDown}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className={`group absolute inset-y-2 right-0 z-[15] w-4 select-none outline-none transition-opacity duration-200 ${
        metrics.visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      style={{ touchAction: 'none' }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-paper/10"
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-[width,background-color] duration-150 ${
          dragging ? 'bg-cinnabar-soft' : 'bg-paper-faint/70 group-hover:w-1 group-hover:bg-cinnabar-soft'
        }`}
        style={{
          height: `${metrics.thumbHeight}px`,
          transform: `translate(-50%, ${metrics.thumbTop}px)`,
        }}
      />
    </div>
  )
}
