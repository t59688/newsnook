import { useEffect, useRef } from 'react'

import {
  clampDragX,
  isSwipeBackStart,
  resolveLock,
  shouldCommit,
  velocityX,
  VELOCITY_WINDOW_MS,
  type GestureSample,
} from '../lib/edgeSwipeBack'
import { clearGestureCompositorStyles } from '../lib/gestureStyles'

const SETTLE_MS = 220
const COMMIT_MIN_MS = 120
const COMMIT_MAX_MS = 280
const SETTLE_EASING = 'cubic-bezier(0.25, 0.8, 0.25, 1)'
const COMMIT_EASING = 'cubic-bezier(0.32, 0.72, 0, 1)'

interface Options {
  containerRef: React.RefObject<HTMLElement | null>
  onBack: () => void
  disabled?: boolean
  reduced?: boolean
}

interface ActiveGesture {
  id: number
  source: 'touch' | 'pointer'
  startX: number
  startY: number
  lock: 'none' | 'horizontal'
  samples: GestureSample[]
}

function currentTranslateX(element: HTMLElement): number {
  const transform = window.getComputedStyle(element).transform
  if (!transform || transform === 'none') return 0
  try {
    return new DOMMatrixReadOnly(transform).m41
  } catch {
    return 0
  }
}

/**
 * Native-feeling left-edge back interaction.
 *
 * Touch events are used for fingers because Android WebView can cancel a pointer
 * stream as soon as its scroll recognizer wakes up. During the drag, transforms
 * are written once per animation frame directly to the compositor layer, so a
 * long article does not re-render for every movement.
 */
export function useEdgeSwipeBack({
  containerRef,
  onBack,
  disabled = false,
  reduced = false,
}: Options): void {
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack

  useEffect(() => {
    const element = containerRef.current
    if (!element || disabled) return

    const previousTouchAction = element.style.touchAction
    const previousOverscrollX = element.style.overscrollBehaviorX
    element.style.touchAction = 'pan-y pinch-zoom'
    element.style.overscrollBehaviorX = 'none'

    let active: ActiveGesture | null = null
    let dragX = 0
    let pendingX = 0
    let frame = 0
    let completionTimer = 0
    let transitionEnd: ((event: TransitionEvent) => void) | null = null
    let committing = false

    const width = () => element.clientWidth || window.innerWidth || 320

    const setActiveVisual = (value: boolean) => {
      if (value) {
        element.dataset.swipeBackActive = 'true'
        element.style.willChange = 'transform'
      } else {
        delete element.dataset.swipeBackActive
        element.style.willChange = ''
      }
    }

    const render = (value: number) => {
      dragX = value
      element.style.transform = value ? `translate3d(${value}px, 0, 0)` : 'translate3d(0, 0, 0)'
    }

    const flushFrame = () => {
      frame = 0
      render(pendingX)
    }

    const scheduleRender = (value: number) => {
      pendingX = value
      dragX = value
      if (!frame) frame = window.requestAnimationFrame(flushFrame)
    }

    const cancelFrame = () => {
      if (!frame) return
      window.cancelAnimationFrame(frame)
      frame = 0
    }

    const cancelCompletion = () => {
      if (completionTimer) window.clearTimeout(completionTimer)
      completionTimer = 0
      if (transitionEnd) element.removeEventListener('transitionend', transitionEnd)
      transitionEnd = null
    }

    const clearVisual = () => {
      cancelFrame()
      cancelCompletion()
      dragX = 0
      pendingX = 0
      clearGestureCompositorStyles(element)
      setActiveVisual(false)
    }

    const releaseCapture = (pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    }

    const resetPointer = () => {
      const pointerId = active?.source === 'pointer' ? active.id : undefined
      active = null
      if (pointerId !== undefined) releaseCapture(pointerId)
    }

    const animateTo = (
      target: number,
      duration: number,
      easing: string,
      complete: () => void,
    ) => {
      cancelFrame()
      cancelCompletion()
      render(dragX)
      element.style.transition = 'none'
      // One release-time layout read guarantees that the following transform transitions.
      void element.offsetWidth

      if (duration === 0) {
        render(target)
        complete()
        return
      }

      let completed = false
      const finish = () => {
        if (completed) return
        completed = true
        cancelCompletion()
        complete()
      }

      transitionEnd = (event) => {
        if (event.target === element && event.propertyName === 'transform') finish()
      }
      element.addEventListener('transitionend', transitionEnd)
      completionTimer = window.setTimeout(finish, duration + 50)
      element.style.transition = `transform ${duration}ms ${easing}`
      render(target)
    }

    const settle = () => {
      resetPointer()
      if (dragX <= 0 || reduced) {
        clearVisual()
        return
      }
      animateTo(0, SETTLE_MS, SETTLE_EASING, clearVisual)
    }

    const commit = (releaseVelocity: number) => {
      resetPointer()
      committing = true
      const panelWidth = width()
      const remaining = Math.max(0, panelWidth - dragX)
      const velocity = Math.max(0.9, releaseVelocity)
      const duration = reduced || remaining <= panelWidth * 0.02
        ? 0
        : Math.round(
            Math.min(
              COMMIT_MAX_MS,
              Math.max(COMMIT_MIN_MS, Math.min(remaining / velocity, (remaining / panelWidth) * 320)),
            ),
          )

      animateTo(panelWidth, duration, COMMIT_EASING, () => {
        committing = false
        // Keep the committed reader off-screen until React unmounts it. Clearing
        // the transform here briefly paints the article again before onBack's
        // state update is committed, which looks like a full-page flash.
        onBackRef.current()
      })
    }

    const addSample = (sample: GestureSample) => {
      if (!active) return
      active.samples.push(sample)
      const cutoff = sample.t - VELOCITY_WINDOW_MS
      while (active.samples.length > 2 && active.samples[1].t < cutoff) {
        active.samples.shift()
      }
    }

    const begin = (
      source: ActiveGesture['source'],
      id: number,
      clientX: number,
      clientY: number,
      timeStamp: number,
      target: EventTarget | null,
    ) => {
      // Ignore new touches until a settle/commit animation has fully finished.
      // In particular, a left swipe must never catch and reverse the reader.
      if (committing || active || completionTimer) return false
      if (
        target instanceof Element &&
        target.closest('pre, [data-reader-horizontal-scroll], [data-video-gestures]')
      ) {
        return false
      }
      const visualX = currentTranslateX(element)
      if (visualX > 0) return false
      const rect = element.getBoundingClientRect()
      const layoutLeft = rect.left - visualX
      if (
        visualX <= 0 &&
        !isSwipeBackStart(clientX, clientY, {
          left: layoutLeft,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        })
      ) {
        return false
      }

      cancelCompletion()
      element.style.transition = 'none'
      // 零位时不要建立临时 transform；若手势随后判定为纵滑，Android
      // WebView 可能把文章滚动层留在失效的合成状态。
      if (visualX > 0) render(visualX)
      active = {
        id,
        source,
        startX: clientX,
        startY: clientY,
        lock: 'none',
        samples: [{ x: clientX, t: timeStamp }],
      }
      return true
    }

    const move = (
      source: ActiveGesture['source'],
      id: number,
      clientX: number,
      clientY: number,
      samples: readonly GestureSample[],
      preventDefault: () => void,
    ) => {
      if (!active || active.source !== source || id !== active.id || committing) return

      const dx = clientX - active.startX
      const dy = clientY - active.startY
      if (active.lock === 'none') {
        const lock = resolveLock(dx, dy)
        if (lock === 'none') return
        if (lock === 'vertical' || dx <= 0) {
          resetPointer()
          clearVisual()
          return
        }
        active.lock = 'horizontal'
        setActiveVisual(true)
      }

      preventDefault()
      samples.forEach(addSample)
      scheduleRender(clampDragX(dx, width()))
    }

    const end = (
      source: ActiveGesture['source'],
      id: number,
      clientX: number,
      timeStamp: number,
    ) => {
      if (!active || active.source !== source || id !== active.id) return
      if (active.lock !== 'horizontal') {
        resetPointer()
        return
      }

      addSample({ x: clientX, t: timeStamp })
      cancelFrame()
      const offset = clampDragX(clientX - active.startX, width())
      render(offset)
      const releaseVelocity = velocityX(active.samples)
      if (shouldCommit(offset, releaseVelocity, width())) commit(releaseVelocity)
      else settle()
    }

    const findTouch = (touches: TouchList, identifier: number) => {
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index)
        if (touch?.identifier === identifier) return touch
      }
      return null
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (active?.source === 'touch') {
          resetPointer()
          clearVisual()
        }
        return
      }
      const touch = event.touches.item(0)
      if (!touch) return
      // 系统手势、弹窗或切后台可能吞掉上一条 touchend/touchcancel。
      // 新触点不属于旧序列时主动复位，避免旧 identifier 日后复用并全局拦截滚动。
      if (active?.source === 'touch') {
        resetPointer()
        clearVisual()
      }
      begin(
        'touch',
        touch.identifier,
        touch.clientX,
        touch.clientY,
        event.timeStamp,
        event.target,
      )
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!active || active.source !== 'touch') return
      const touch = findTouch(event.touches, active.id)
      if (!touch) {
        settle()
        return
      }
      move(
        'touch',
        touch.identifier,
        touch.clientX,
        touch.clientY,
        [{ x: touch.clientX, t: event.timeStamp }],
        () => {
          if (event.cancelable) event.preventDefault()
        },
      )
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (!active || active.source !== 'touch') return
      const touch = findTouch(event.changedTouches, active.id)
      if (touch) end('touch', touch.identifier, touch.clientX, event.timeStamp)
      else if (!findTouch(event.touches, active.id)) settle()
    }

    const onTouchCancel = () => {
      if (!active || active.source !== 'touch') return
      settle()
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.pointerType !== 'pen') return
      if (
        begin(
          'pointer',
          event.pointerId,
          event.clientX,
          event.clientY,
          event.timeStamp,
          event.target,
        )
      ) {
        element.setPointerCapture(event.pointerId)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const coalesced = event.getCoalescedEvents?.() ?? []
      const points = coalesced.length > 0 ? coalesced : [event]
      move(
        'pointer',
        event.pointerId,
        event.clientX,
        event.clientY,
        points.map((point) => ({ x: point.clientX, t: point.timeStamp })),
        () => {
          if (event.cancelable) event.preventDefault()
        },
      )
    }

    const onPointerUp = (event: PointerEvent) => {
      end('pointer', event.pointerId, event.clientX, event.timeStamp)
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (active?.source === 'pointer' && event.pointerId === active.id) settle()
    }

    const resetInterruptedGesture = () => {
      // 切后台/系统弹窗时不要等待动画完成：相关定时器可能被冻结，必须立刻
      // 释放 active/committing，避免恢复后继续使用旧触点序列。
      committing = false
      resetPointer()
      clearVisual()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') resetInterruptedGesture()
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    // Touch events retain their start target even when the finger leaves the
    // reader. A window-level move listener can intercept unrelated surfaces
    // when a lost terminal event is followed by a reused touch identifier.
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', onTouchCancel)
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', resetInterruptedGesture)
    window.addEventListener('pagehide', resetInterruptedGesture)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchCancel)
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', resetInterruptedGesture)
      window.removeEventListener('pagehide', resetInterruptedGesture)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      active = null
      committing = false
      clearVisual()
      element.style.touchAction = previousTouchAction
      element.style.overscrollBehaviorX = previousOverscrollX
    }
  }, [containerRef, disabled, reduced])
}
