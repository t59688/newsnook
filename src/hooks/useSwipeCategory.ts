import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type SwipeDirection = 'next' | 'prev'

/** 判定方向前允许的自由抖动 */
const DIRECTION_LOCK_PX = 12
/** 横向优势倍数：明显偏横才锁横向，避免抢走竖滑 */
const HORIZONTAL_BIAS = 1.2
/** 位移超过容器宽度这个比例即切换 */
const COMMIT_RATIO = 0.22
/** 甩动速度（px/ms）达到这个值也切换 */
const COMMIT_VELOCITY = 0.45
/** 到头时的橡皮筋阻尼 */
const EDGE_DAMPING = 0.3
const COMMIT_MS = 260
const SETTLE_MS = 240

interface Options {
  /** 手势与位移作用在同一条轨道上（外层 track） */
  containerRef: React.RefObject<HTMLElement | null>
  canGo: (direction: SwipeDirection) => boolean
  onCommit: (direction: SwipeDirection) => void
  /** Current category/mode key: defer visual reset until the next page has committed. */
  activeKey?: string
  onHorizontalLock?: () => void
  /** Per-frame compositor progress; when supplied, React only mounts/unmounts neighbours. */
  onDragFrame?: (offset: number, width: number, transitionMs: number) => void
  disabled?: boolean
  reduced?: boolean
}

/**
 * 列表横滑切换分类：轨道跟手平移，邻页并排露出来；
 * 松手后滑满一屏再换分类并瞬间归零，避免中间露出空白底。
 */
export function useSwipeCategory({
  containerRef,
  canGo,
  onCommit,
  activeKey,
  onHorizontalLock,
  onDragFrame,
  disabled = false,
  reduced = false,
}: Options) {
  const [dragX, setDragX] = useState(0)
  const [transitionMs, setTransitionMs] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const dragXRef = useRef(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const lastRef = useRef<{ x: number; t: number } | null>(null)
  const recentVelocityRef = useRef(0)
  const lockRef = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const widthRef = useRef(0)
  const busyRef = useRef(false)
  const previousActiveKey = useRef(activeKey)
  const hasActiveKeyRef = useRef(activeKey !== undefined)
  hasActiveKeyRef.current = activeKey !== undefined
  const completeCommitRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    if (previousActiveKey.current === activeKey) return
    previousActiveKey.current = activeKey
    // Called after React has replaced the article list but before the browser
    // paints it; only now is it safe to remove the outgoing full-page offset.
    completeCommitRef.current?.()
  }, [activeKey])

  const canGoRef = useRef(canGo)
  canGoRef.current = canGo
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onLockRef = useRef(onHorizontalLock)
  onLockRef.current = onHorizontalLock
  const onDragFrameRef = useRef(onDragFrame)
  onDragFrameRef.current = onDragFrame

  useEffect(() => {
    const element = containerRef.current
    if (!element || disabled) return

    const measureWidth = () => {
      const w =
        element.parentElement?.clientWidth || element.clientWidth || window.innerWidth || 320
      widthRef.current = w
      setContainerWidth(w)
      return w
    }

    measureWidth()
    window.addEventListener('resize', measureWidth)

    let moveRafId = 0
    let pendingDragX: number | null = null
    let lastReactDragUpdate = 0
    let renderedDragX = 0
    let activeTouchId: number | null = null
    let settleTimer = 0
    let commitTimer = 0
    let finishFrame = 0

    const clearTimers = () => {
      if (settleTimer) window.clearTimeout(settleTimer)
      if (commitTimer) window.clearTimeout(commitTimer)
      if (finishFrame) window.cancelAnimationFrame(finishFrame)
      settleTimer = 0
      commitTimer = 0
      finishFrame = 0
    }

    const positionLayers = (value: number, animated: boolean) => {
      // CSS variables on a parent are inherited by every article and invalidate
      // its style tree on old Android WebViews. Move only the 1-3 composited
      // surfaces instead; never touch the long list's inherited styles.
      for (const child of element.children) {
        if (!(child instanceof HTMLElement)) continue
        const role = child.dataset.swipeLayer
        if (!role) continue
        if (!animated) child.style.transition = 'none'
        if (child.hasAttribute('data-swipe-fade')) {
          child.style.opacity = String(0.86 + Math.min(1, Math.abs(value) / Math.max(1, widthRef.current)) * 0.14)
        }
        if (role === 'current') {
          if (child.hasAttribute('data-swipe-shadow')) {
            child.style.boxShadow = value !== 0 || animated ? '0 0 32px rgb(0 0 0 / 0.08)' : ''
          }
          if (value === 0 && !animated) {
            child.style.removeProperty('transform')
            child.style.removeProperty('will-change')
          } else {
            child.style.transform = `translate3d(${value}px, 0, 0)`
            child.style.willChange = 'transform'
          }
        } else if (role === 'prev' || role === 'next') {
          const shown = role === 'prev' ? value > 0 : value < 0
          const keepUntilSettle = animated && child.style.visibility === 'visible'
          child.style.visibility = shown || keepUntilSettle ? 'visible' : 'hidden'
          child.style.transform = role === 'prev'
            ? `translate3d(calc(${value}px - 100%), 0, 0)`
            : `translate3d(calc(${value}px + 100%), 0, 0)`
          if (shown || keepUntilSettle) child.style.willChange = 'transform'
          else child.style.removeProperty('will-change')
        }
      }
    }

    const flushDrag = () => {
      moveRafId = 0
      if (pendingDragX === null) return
      const value = pendingDragX
      pendingDragX = null
      positionLayers(value, false)
      onDragFrameRef.current?.(value, widthRef.current, 0)
      // Prepared neighbour layers and the header indicator can follow the
      // finger without React: reconciling the full article list on each drag
      // start was the measured cause of 50+ ms frames on Android WebView 69.
      if (!onDragFrameRef.current) {
        const now = performance.now()
        if (Math.sign(value) !== Math.sign(renderedDragX) || now - lastReactDragUpdate >= 48) {
          renderedDragX = value
          lastReactDragUpdate = now
          setDragX(value)
        }
      }
    }

    const cancelDragRaf = () => {
      if (moveRafId) {
        window.cancelAnimationFrame(moveRafId)
        moveRafId = 0
      }
      pendingDragX = null
    }

    const apply = (value: number, ms: number, notifyIndicator = true) => {
      dragXRef.current = value
      if (!onDragFrameRef.current) setTransitionMs(ms)
      if (ms > 0 || value === 0) {
        cancelDragRaf()
        if (ms > 0) {
          for (const child of element.children) {
            if (child instanceof HTMLElement && child.dataset.swipeLayer) {
              child.style.transition = `transform ${ms}ms var(--ease-ink)${child.hasAttribute('data-swipe-fade') ? `, opacity ${ms}ms var(--ease-ink)` : ''}`
            }
          }
        }
        // The previous painted drag transform is already the transition origin;
        // forcing getBoundingClientRect() here caused synchronous layout at release.
        positionLayers(value, ms > 0)
        if (notifyIndicator) onDragFrameRef.current?.(value, widthRef.current, ms)
        renderedDragX = value
        if (!onDragFrameRef.current) setDragX(value)
      } else {
        pendingDragX = value
        if (!moveRafId) {
          moveRafId = window.requestAnimationFrame(flushDrag)
        }
      }
    }

    const resetTouch = () => {
      startRef.current = null
      lastRef.current = null
      recentVelocityRef.current = 0
      lockRef.current = 'none'
      activeTouchId = null
    }

    const settle = () => {
      clearTimers()
      cancelDragRaf()
      const needsTransition = dragXRef.current !== 0
      apply(0, needsTransition ? SETTLE_MS : 0)
      resetTouch()
      if (needsTransition) {
        settleTimer = window.setTimeout(() => {
          settleTimer = 0
          positionLayers(0, false)
          if (!onDragFrameRef.current) setTransitionMs(0)
        }, SETTLE_MS)
      }
    }

    const completeCommit = () => {
      if (!busyRef.current) return
      clearTimers()
      apply(0, 0, false)
      busyRef.current = false
    }
    completeCommitRef.current = completeCommit

    const commit = (direction: SwipeDirection) => {
      clearTimers()
      resetTouch()

      const width = widthRef.current || measureWidth()
      const out = direction === 'next' ? -width : width

      const finish = () => {
        // With an active key, keep the destination preview fully covering the
        // viewport until React commits the new page. Clearing it now exposed the
        // old article list for one frame when React was busy.
        onCommitRef.current(direction)
        if (!busyRef.current) return
        if (hasActiveKeyRef.current && onDragFrameRef.current) {
          // Defensive recovery if the parent rejects/drops the category change.
          commitTimer = window.setTimeout(() => {
            commitTimer = 0
            completeCommit()
          }, 800)
        } else {
          completeCommit()
        }
      }

      if (reduced) {
        busyRef.current = true
        apply(out, 0)
        finishFrame = window.requestAnimationFrame(() => {
          finishFrame = 0
          finish()
        })
        return
      }

      busyRef.current = true
      const remaining = Math.abs(out - dragXRef.current)
      // 已经几乎滑满时不再拖很长收尾，直接对接换页
      if (remaining < width * 0.04) {
        apply(out, 0)
        finishFrame = window.requestAnimationFrame(() => {
          finishFrame = 0
          finish()
        })
        return
      }

      const ms = Math.round(
        Math.min(COMMIT_MS, Math.max(90, (remaining / width) * COMMIT_MS)),
      )
      apply(out, ms)
      commitTimer = window.setTimeout(() => {
        commitTimer = 0
        finish()
      }, ms)
    }

    const abortInteraction = () => {
      clearTimers()
      cancelDragRaf()
      busyRef.current = false
      resetTouch()
      apply(0, 0)
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
        if (startRef.current) abortInteraction()
        return
      }
      if (busyRef.current) return
      if (startRef.current) abortInteraction()
      const touch = event.touches[0]
      // The width was measured at mount and is refreshed on resize. Re-reading
      // clientWidth at every touchstart can force layout before a scroll gesture.
      if (widthRef.current <= 0) measureWidth()
      activeTouchId = touch.identifier
      startRef.current = { x: touch.clientX, y: touch.clientY }
      lastRef.current = { x: touch.clientX, t: event.timeStamp }
      recentVelocityRef.current = 0
      lockRef.current = 'none'
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = startRef.current
      if (!start || busyRef.current || activeTouchId === null) return

      const touch = findTouch(event.touches, activeTouchId)
      if (!touch) {
        abortInteraction()
        return
      }
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y

      if (lockRef.current === 'none') {
        if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
        if (Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS) {
          lockRef.current = 'horizontal'
          onLockRef.current?.()
        } else {
          lockRef.current = 'vertical'
          resetTouch()
          return
        }
      }

      if (lockRef.current !== 'horizontal') return

      // The track declares touch-action: pan-y. Horizontal movement belongs to
      // this gesture; vertical scrolling stays with the WebView compositor.
      // Never block its input thread with a non-passive touchmove listener.
      const last = lastRef.current
      const elapsed = last ? event.timeStamp - last.t : 0
      // Velocity must be sampled from successive positions, not the entire
      // drag distance divided by only the final release-to-move interval.
      if (last && elapsed > 0 && elapsed < 150) {
        recentVelocityRef.current = (touch.clientX - last.x) / elapsed
      }
      lastRef.current = { x: touch.clientX, t: event.timeStamp }

      const direction: SwipeDirection = dx < 0 ? 'next' : 'prev'
      const offset = canGoRef.current(direction) ? dx : dx * EDGE_DAMPING
      apply(offset, 0)
    }

    const onTouchEnd = (event: TouchEvent) => {
      if (activeTouchId === null) return
      const endedTouch = findTouch(event.changedTouches, activeTouchId)
      if (!endedTouch) {
        if (!findTouch(event.touches, activeTouchId)) abortInteraction()
        return
      }
      cancelDragRaf()
      const start = startRef.current
      if (!start || lockRef.current !== 'horizontal') {
        resetTouch()
        return
      }

      const offset = dragXRef.current
      const direction: SwipeDirection = offset < 0 ? 'next' : 'prev'
      const last = lastRef.current
      const releaseLag = last ? event.timeStamp - last.t : Infinity
      const velocity = releaseLag >= 0 && releaseLag <= 75 ? Math.abs(recentVelocityRef.current) : 0
      const width = widthRef.current || measureWidth()

      const passed =
        Math.abs(offset) > width * COMMIT_RATIO || velocity > COMMIT_VELOCITY

      if (passed && canGoRef.current(direction)) commit(direction)
      else settle()
    }

    const onTouchCancel = () => abortInteraction()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') abortInteraction()
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: true })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchCancel)
    window.addEventListener('blur', abortInteraction)
    window.addEventListener('pagehide', abortInteraction)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      abortInteraction()
      completeCommitRef.current = null
      window.removeEventListener('resize', measureWidth)
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
      element.removeEventListener('touchcancel', onTouchCancel)
      window.removeEventListener('blur', abortInteraction)
      window.removeEventListener('pagehide', abortInteraction)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [containerRef, disabled, reduced])

  return { dragX, transitionMs, containerWidth }
}
