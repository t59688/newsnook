import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject, type PointerEvent } from 'react'
import { GripVertical, Maximize2, X } from 'lucide-react'
import { useWindowGesture } from './useWindowGesture'
import type { FloatingVideoBounds } from './nativeSurfaceCoordinator'
import type { WindowRect } from './types'

const CHROME_IDLE_MS = 2600

/** Video-first, app-scoped floating player. The slot always retains the same media node. */
export function FloatingVideoWindow({ title, active, hidden, domFullscreen, slotRef, onRestore, onClose, onBoundsChange, restoredRect }: {
  title: string
  active: boolean
  hidden: boolean
  domFullscreen: boolean
  slotRef: RefObject<HTMLDivElement | null>
  onRestore: () => void
  onClose: () => void
  onBoundsChange?: (bounds: FloatingVideoBounds) => void
  restoredRect?: WindowRect
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { rect, drag, resize, pinch, tip, dismissTip } = useWindowGesture(rootRef, slotRef, hidden, restoredRect)
  // A transformed browser owner may shift the fixed frame. Measure that owner
  // offset once, not a getBoundingClientRect layout read on every drag frame.
  const hostOffset = useRef({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!active || hidden || domFullscreen) return
    const bounds = rootRef.current?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0)
      hostOffset.current = { x: bounds.left - rect.x, y: bounds.top - rect.y }
    // A portal target change remounts this window and remeasures its owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hidden, domFullscreen])
  // Native browser is a second Android WebView above this DOM. Keep a rounded
  // touch-through cutout aligned to the player without resizing the webpage.
  useLayoutEffect(() => {
    if (!active || hidden || domFullscreen || !onBoundsChange) return
    onBoundsChange({
      left: rect.x + hostOffset.current.x, top: rect.y + hostOffset.current.y,
      width: rect.width, height: rect.height,
    })
  }, [active, hidden, domFullscreen, rect, onBoundsChange])
  const [chromeVisible, setChromeVisible] = useState(true)
  const chromeTimer = useRef<number | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const touchedWithTwoFingers = useRef(false)
  useEffect(() => {
    const clearTouches = () => {
      touches.current.clear()
      touchedWithTwoFingers.current = false
    }
    const forgetTouch = (event: globalThis.PointerEvent) => {
      touches.current.delete(event.pointerId)
      if (touches.current.size === 0) touchedWithTwoFingers.current = false
    }
    window.addEventListener('blur', clearTouches)
    window.addEventListener('pointerup', forgetTouch)
    window.addEventListener('pointercancel', forgetTouch)
    return () => {
      window.removeEventListener('blur', clearTouches)
      window.removeEventListener('pointerup', forgetTouch)
      window.removeEventListener('pointercancel', forgetTouch)
    }
  }, [])

  const cancelChromeTimer = useCallback(() => {
    if (chromeTimer.current != null) window.clearTimeout(chromeTimer.current)
    chromeTimer.current = null
  }, [])

  const revealChrome = useCallback(() => {
    if (hidden) return
    cancelChromeTimer()
    setChromeVisible(true)
    if (slotRef.current?.querySelector('video')?.paused === false) {
      chromeTimer.current = window.setTimeout(() => setChromeVisible(false), CHROME_IDLE_MS)
    }
  }, [cancelChromeTimer, hidden, slotRef])

  useEffect(() => {
    if (hidden) {
      cancelChromeTimer()
      touches.current.clear()
      touchedWithTwoFingers.current = false
      return
    }
    const video = slotRef.current?.querySelector('video')
    if (!video) return
    const syncPlayback = () => {
      if (video.paused || video.ended) {
        cancelChromeTimer()
        setChromeVisible(true)
      } else {
        revealChrome()
      }
    }
    video.addEventListener('play', syncPlayback)
    video.addEventListener('pause', syncPlayback)
    video.addEventListener('ended', syncPlayback)
    syncPlayback()
    return () => {
      video.removeEventListener('play', syncPlayback)
      video.removeEventListener('pause', syncPlayback)
      video.removeEventListener('ended', syncPlayback)
      cancelChromeTimer()
    }
  }, [cancelChromeTimer, hidden, revealChrome, slotRef])

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // First give the floating frame a chance to own a two-finger resize.
    pinch.onPointerDownCapture(event)
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touches.current.size > 1) touchedWithTwoFingers.current = true
    } else revealChrome()
  }
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const initial = touches.current.get(event.pointerId)
    const tapped = initial && !touchedWithTwoFingers.current && touches.current.size === 1
      && Math.hypot(event.clientX - initial.x, event.clientY - initial.y) <= 12
    pinch.onPointerUpCapture(event)
    touches.current.delete(event.pointerId)
    if (touches.current.size === 0) touchedWithTwoFingers.current = false
    // A swipe should only show its own seek/level HUD, never the window toolbar.
    if (tapped) revealChrome()
  }
  const handlePointerCancel = () => {
    touches.current.clear()
    touchedWithTwoFingers.current = false
    pinch.onPointerCancelCapture()
  }
  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (!pinch.onLostPointerCaptureCapture(event)) return
    touches.current.delete(event.pointerId)
    if (touches.current.size === 0) touchedWithTwoFingers.current = false
  }

  return <div
    data-floating-video-window={active ? '' : undefined}
    data-floating-chrome={chromeVisible ? 'shown' : 'hidden'}
    data-floating-narrow={rect.width < 260 ? '' : undefined}
    aria-hidden={(hidden && !domFullscreen) || undefined}
    data-theme="dark"
    className="floating-video-window"
    ref={rootRef}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, visibility: hidden ? 'hidden' : undefined }}
    onPointerDownCapture={handlePointerDown}
    onPointerMoveCapture={pinch.onPointerMoveCapture}
    onPointerUpCapture={handlePointerUp}
    onPointerCancelCapture={handlePointerCancel}
    onLostPointerCaptureCapture={handleLostPointerCapture}
    onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') revealChrome() }}
    onFocusCapture={revealChrome}
  >
    <div ref={slotRef} className="floating-video-slot" />
    <div className="floating-video-idle-grip" aria-hidden="true" />
    <header className="floating-video-chrome">
      <div role="button" tabIndex={0} aria-label="移动悬浮窗口" title="拖动移动悬浮窗口" className="floating-video-drag" {...drag}>
        <GripVertical size={14} strokeWidth={1.7} aria-hidden="true" />
        <span>{title}</span>
      </div>
      <div className="floating-video-actions">
        <button type="button" aria-label="恢复播放页" title="恢复播放页" onClick={onRestore}><Maximize2 size={17} strokeWidth={1.8} /></button>
        <button type="button" aria-label="关闭悬浮播放" title="关闭" onClick={onClose}><X size={18} strokeWidth={1.8} /></button>
      </div>
    </header>
    <div role="button" tabIndex={0} aria-label="调整悬浮窗口大小" title="拖动调整窗口大小" className="floating-video-resize" {...resize}>
      <span aria-hidden="true" />
    </div>
    {tip && <button className="floating-video-tip" type="button" onClick={dismissTip}>左上拖动 · 右下缩放</button>}
  </div>
}
