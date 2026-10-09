import { useEffect, useRef, useState } from 'react'

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
  onHorizontalLock?: () => void
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
  onHorizontalLock,
  disabled = false,
  reduced = false,
}: Options) {
  const [dragX, setDragX] = useState(0)
  const [transitionMs, setTransitionMs] = useState(0)
  const [containerWidth, setContainerWidth] = useState(0)
  const dragXRef = useRef(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const lastRef = useRef<{ x: number; t: number } | null>(null)
  const lockRef = useRef<'none' | 'horizontal' | 'vertical'>('none')
  const widthRef = useRef(0)
  const busyRef = useRef(false)

  const canGoRef = useRef(canGo)
  canGoRef.current = canGo
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onLockRef = useRef(onHorizontalLock)
  onLockRef.current = onHorizontalLock

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

    const flushDrag = () => {
      moveRafId = 0
      if (pendingDragX !== null) {
        setDragX(pendingDragX)
        pendingDragX = null
      }
    }

    const cancelDragRaf = () => {
      if (moveRafId) {
        window.cancelAnimationFrame(moveRafId)
        moveRafId = 0
      }
      pendingDragX = null
    }

    const apply = (value: number, ms: number) => {
      dragXRef.current = value
      setTransitionMs(ms)
      if (ms > 0 || value === 0) {
        cancelDragRaf()
        setDragX(value)
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
          setTransitionMs(0)
        }, SETTLE_MS)
      }
    }

    const commit = (direction: SwipeDirection) => {
      clearTimers()
      resetTouch()

      const width = widthRef.current || measureWidth()
      const out = direction === 'next' ? -width : width

      const finish = () => {
        // 先换分类再归零：与 React 同帧提交，配合 FeedScreen 跳过入场透明，减少闪一下
        onCommitRef.current(direction)
        apply(0, 0)
        busyRef.current = false
      }

      if (reduced) {
        busyRef.current = true
        finish()
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
      widthRef.current = measureWidth()
      activeTouchId = touch.identifier
      startRef.current = { x: touch.clientX, y: touch.clientY }
      lastRef.current = { x: touch.clientX, t: event.timeStamp }
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

      if (event.cancelable) event.preventDefault()
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
      const elapsed = last ? Math.max(1, event.timeStamp - last.t) : 1
      const velocity = last ? Math.abs(last.x - start.x) / Math.max(1, elapsed + 16) : 0
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
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    element.addEventListener('touchend', onTouchEnd)
    element.addEventListener('touchcancel', onTouchCancel)
    window.addEventListener('blur', abortInteraction)
    window.addEventListener('pagehide', abortInteraction)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      abortInteraction()
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
