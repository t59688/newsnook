import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

import {
  MAX_PULL_PX,
  PULL_THRESHOLD_PX,
  resistedPullDistance,
} from '../lib/pullToRefresh'
import { clearGestureCompositorStyles } from '../lib/gestureStyles'

export type PullPhase = 'idle' | 'pulling' | 'ready' | 'refreshing'

const DIRECTION_LOCK_PX = 6
const DIRECTION_BIAS = 1.08
const REFRESH_HOLD_PX = 72
const SETTLE_MS = 240
const HOLD_MS = 180
const PULL_EASING = 'cubic-bezier(0.25, 0.8, 0.25, 1)'

interface Options {
  onRefresh: () => Promise<void> | void
  disabled?: boolean
  reduced?: boolean
  /** 可选：监听既有滚动容器，而不是让 hook 自己持有 scroller ref。 */
  containerRef?: RefObject<HTMLDivElement | null>
  /** 可选：下拉时只位移内容层，滚动容器本身保持原位，便于外部指示器露出。 */
  surfaceRef?: RefObject<HTMLElement | null>
}

interface Gesture {
  startX: number
  startY: number
  startDistance: number
  lock: 'none' | 'vertical'
  scrollPath: Element[]
}

function currentTranslateY(element: HTMLElement): number {
  const transform = window.getComputedStyle(element).transform
  if (!transform || transform === 'none') return 0
  try {
    return new DOMMatrixReadOnly(transform).m42
  } catch {
    return 0
  }
}

/**
 * Pull-to-refresh keeps native list scrolling and only takes over a downward
 * gesture at scrollTop=0. Drag frames are painted directly on a compositor layer;
 * React only updates when the semantic phase changes.
 */
export function usePullToRefresh({
  onRefresh,
  disabled = false,
  reduced = false,
  containerRef: externalContainerRef,
  surfaceRef: externalSurfaceRef,
}: Options) {
  const ownedContainerRef = useRef<HTMLDivElement | null>(null)
  const containerRef = externalContainerRef ?? ownedContainerRef
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const onRefreshRef = useRef(onRefresh)
  const cancelRef = useRef<() => void>(() => undefined)
  const triggerRef = useRef<() => void>(() => undefined)
  const [phase, setPhase] = useState<PullPhase>('idle')
  const phaseRef = useRef<PullPhase>('idle')

  onRefreshRef.current = onRefresh

  const setPhaseSafe = useCallback((next: PullPhase) => {
    if (phaseRef.current === next) return
    phaseRef.current = next
    setPhase(next)
  }, [])

  const cancel = useCallback(() => cancelRef.current(), [])
  const trigger = useCallback(() => triggerRef.current(), [])

  useEffect(() => {
    const element = containerRef.current
    const surface = externalSurfaceRef?.current ?? element
    const indicator = indicatorRef.current
    if (!element || !surface || !indicator || disabled) return

    let gesture: Gesture | null = null
    let activePointer: number | null = null
    let distance = 0
    let pendingDistance = 0
    let frame = 0
    let settleTimer = 0
    let disposed = false

    const clearTimer = () => {
      if (settleTimer) window.clearTimeout(settleTimer)
      settleTimer = 0
    }

    const render = (value: number) => {
      distance = value
      const progress = Math.min(1, value / PULL_THRESHOLD_PX)
      const height = Math.max(value, phaseRef.current === 'refreshing' ? REFRESH_HOLD_PX : 0)

      surface.style.transform = value
        ? `translate3d(0, ${value}px, 0)`
        : 'translate3d(0, 0, 0)'
      indicator.style.setProperty('--pull-height', `${height}px`)
      indicator.style.setProperty('--pull-glow-opacity', String(progress * 0.9))
      indicator.style.setProperty('--pull-glow-scale', String((0.4 + progress * 0.6) * 1.6))
      indicator.style.setProperty('--pull-dot-scale', String(0.4 + progress * 0.6))
      indicator.style.setProperty('--pull-dot-opacity', String(0.35 + progress * 0.65))
    }

    const flushFrame = () => {
      frame = 0
      render(pendingDistance)
    }

    const scheduleRender = (value: number) => {
      pendingDistance = value
      distance = value
      if (!frame) frame = window.requestAnimationFrame(flushFrame)
    }

    const cancelFrame = () => {
      if (!frame) return
      window.cancelAnimationFrame(frame)
      frame = 0
    }

    const transitionTo = (value: number, duration: number) => {
      cancelFrame()
      clearTimer()
      render(distance)
      surface.style.transition = duration ? `transform ${duration}ms ${PULL_EASING}` : 'none'
      indicator.style.transition = duration ? `height ${duration}ms ${PULL_EASING}` : 'none'
      render(value)
    }

    const clearGesture = () => {
      gesture = null
      if (activePointer !== null && element.hasPointerCapture(activePointer)) {
        element.releasePointerCapture(activePointer)
      }
      activePointer = null
    }

    const clearVisual = () => {
      cancelFrame()
      clearTimer()
      distance = 0
      pendingDistance = 0
      clearGestureCompositorStyles(surface)
      indicator.style.transition = ''
      indicator.style.removeProperty('--pull-height')
      indicator.style.removeProperty('--pull-glow-opacity')
      indicator.style.removeProperty('--pull-glow-scale')
      indicator.style.removeProperty('--pull-dot-scale')
      indicator.style.removeProperty('--pull-dot-opacity')
    }

    const settle = (immediate = false) => {
      clearGesture()
      if (distance <= 0 || immediate || reduced) {
        clearVisual()
        setPhaseSafe('idle')
        return
      }
      transitionTo(0, SETTLE_MS)
      settleTimer = window.setTimeout(() => {
        clearVisual()
        setPhaseSafe('idle')
      }, SETTLE_MS + 30)
    }

    const runRefreshing = async () => {
      if (phaseRef.current === 'refreshing') return
      clearGesture()
      setPhaseSafe('refreshing')
      transitionTo(REFRESH_HOLD_PX, reduced ? 0 : HOLD_MS)
      try {
        await onRefreshRef.current()
      } finally {
        if (!disposed) settle()
      }
    }

    // A zero on the listener alone is insufficient: native scrolling can belong
    // to a descendant or a clipping ancestor. Keep the touched path, not unrelated rails.
    const isAtTop = (scrollPath: Element[]) => {
      if (scrollPath.some((node) => node.scrollTop > 0)) return false
      if (surface === element) return true
      const contentTop = surface.getBoundingClientRect().top - currentTranslateY(surface)
      const viewportTop = element.getBoundingClientRect().top + element.clientTop
      return contentTop >= viewportTop - 0.5
    }

    const finish = async () => {
      const eligible = gesture && isAtTop(gesture.scrollPath)
      clearGesture()
      if (!eligible) {
        settle(true)
        return
      }
      if (phaseRef.current !== 'ready') {
        settle()
        return
      }
      await runRefreshing()
    }

    const begin = (x: number, y: number, target: EventTarget | null) => {
      if (phaseRef.current === 'refreshing') return
      const scrollPath: Element[] = []
      for (let node: Element | null = target instanceof Element ? target : element; node; node = node.parentElement) {
        scrollPath.push(node)
      }
      if (!scrollPath.includes(element) || !isAtTop(scrollPath)) {
        settle(true)
        return
      }
      const visualDistance = Math.max(0, currentTranslateY(surface))
      clearTimer()
      // 零位时不要预先写 translate3d(0,0,0)：方向尚未确定，原生滚动
      // 可能马上接管；Android WebView 偶尔会因此留下失效的合成滚动层。
      if (visualDistance > 0) {
        surface.style.transition = 'none'
        indicator.style.transition = 'none'
        render(visualDistance)
      }
      gesture = {
        startX: x,
        startY: y,
        startDistance: visualDistance,
        scrollPath,
        lock: visualDistance > 0 ? 'vertical' : 'none',
      }
      if (visualDistance > 0) {
        surface.style.willChange = 'transform'
        setPhaseSafe(visualDistance >= PULL_THRESHOLD_PX ? 'ready' : 'pulling')
      }
    }

    const move = (x: number, y: number, prevent: () => void) => {
      if (!gesture || phaseRef.current === 'refreshing') return
      if (!isAtTop(gesture.scrollPath)) {
        // Drop the whole sequence, including a queued paint and a previous ready phase.
        settle(true)
        return
      }

      const dx = x - gesture.startX
      const dy = y - gesture.startY
      if (gesture.lock === 'none') {
        const absX = Math.abs(dx)
        const absY = Math.abs(dy)
        if (absX < DIRECTION_LOCK_PX && absY < DIRECTION_LOCK_PX) return
        if (dy <= 0 || absX >= absY * DIRECTION_BIAS) {
          if (distance > 0 || gesture.startDistance > 0) settle()
          else {
            clearGesture()
            clearGestureCompositorStyles(surface)
          }
          return
        }
        if (absY < absX * DIRECTION_BIAS) return

        gesture.lock = 'vertical'
        surface.style.willChange = 'transform'
        setPhaseSafe('pulling')
      }

      prevent()
      const nextDistance =
        dy >= 0
          ? Math.min(MAX_PULL_PX, gesture.startDistance + resistedPullDistance(dy))
          : Math.max(0, gesture.startDistance + dy)
      scheduleRender(nextDistance)
      setPhaseSafe(nextDistance >= PULL_THRESHOLD_PX ? 'ready' : 'pulling')
    }

    cancelRef.current = () => {
      if (phaseRef.current !== 'refreshing') settle()
    }

    triggerRef.current = () => {
      if (phaseRef.current === 'refreshing' || disposed) return
      element.scrollTop = 0
      void runRefreshing()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (gesture) settle(true)
        return
      }
      const touch = event.touches[0]
      begin(touch.clientX, touch.clientY, event.target)
    }
    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !event.cancelable) {
        // Once the browser owns scrolling we cannot take it back, even after a reversal.
        if (gesture) settle(true)
        return
      }
      const touch = event.touches[0]
      move(touch.clientX, touch.clientY, () => {
        if (event.cancelable) event.preventDefault()
      })
    }
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0 && gesture) void finish()
    }
    const onTouchCancel = () => settle()

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !event.isPrimary) return
      begin(event.clientX, event.clientY, event.target)
      if (gesture) activePointer = event.pointerId
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || activePointer !== event.pointerId) return
      move(event.clientX, event.clientY, () => {
        if (event.cancelable) event.preventDefault()
      })
    }
    const onPointerUp = (event: PointerEvent) => {
      if (activePointer !== event.pointerId) return
      if (gesture) void finish()
      else activePointer = null
    }
    const onPointerCancel = (event: PointerEvent) => {
      if (activePointer === event.pointerId) settle()
    }

    const resetInterruptedGesture = () => {
      if (phaseRef.current === 'refreshing') {
        clearGesture()
        return
      }
      settle(true)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetInterruptedGesture()
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchCancel)
    element.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', resetInterruptedGesture)
    window.addEventListener('pagehide', resetInterruptedGesture)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      disposed = true
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
      element.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', resetInterruptedGesture)
      window.removeEventListener('pagehide', resetInterruptedGesture)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      cancelRef.current = () => undefined
      triggerRef.current = () => undefined
      clearGesture()
      clearVisual()
    }
  }, [containerRef, disabled, externalSurfaceRef, reduced, setPhaseSafe])

  return { containerRef, indicatorRef, phase, cancel, trigger }
}
