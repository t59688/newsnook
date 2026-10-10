import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import { constrainWindow, initialWindow } from './geometry'
import type { WindowBounds, WindowRect } from './types'

export function readWindowBounds(): WindowBounds {
  const viewport = window.visualViewport
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:var(--sat,0px) var(--sar,0px) var(--sab,0px) var(--sal,0px)'
  document.body.appendChild(probe)
  const css = window.getComputedStyle(probe)
  const px = (value: string) => Number.parseFloat(value) || 0
  const left = px(css.paddingLeft) + 8
  const top = px(css.paddingTop) + 8
  const right = px(css.paddingRight) + 8
  const bottom = px(css.paddingBottom) + 8
  probe.remove()
  return { x: (viewport?.offsetLeft || 0) + left, y: (viewport?.offsetTop || 0) + top,
    width: Math.max(1, (viewport?.width || window.innerWidth) - left - right),
    height: Math.max(45, (viewport?.height || window.innerHeight) - top - bottom) }
}

export function useWindowGesture(rootRef: RefObject<HTMLDivElement | null>, slotRef: RefObject<HTMLDivElement | null>, hidden: boolean) {
  const [initialBounds] = useState(readWindowBounds)
  const [rect, setRect] = useState(() => initialWindow(initialBounds, 16 / 9))
  const rectRef = useRef(rect)
  // Viewport constraints affect presentation, not the user's preferred placement.
  // In particular, rotating into fullscreen must not overwrite the floating rect.
  const preferredRect = useRef(rect)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden
  const ratioRef = useRef(16 / 9)
  const boundsRef = useRef(initialBounds)
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const interaction = useRef<{ id: number; x: number; y: number; rect: WindowRect; resize: boolean } | null>(null)
  const pinchStart = useRef<{ distance: number; x: number; y: number; rect: WindowRect } | null>(null)
  const captures = useRef(new Map<number, HTMLElement>())
  const [tip, setTip] = useState(false)
  const shownTip = useRef(false)
  const apply = useCallback((next: Pick<WindowRect, 'x' | 'y' | 'width'>, remember = true) => {
    if (remember) preferredRect.current = constrainWindow(next, boundsRef.current, ratioRef.current)
    rectRef.current = constrainWindow(next, boundsRef.current, ratioRef.current)
    if (frame.current == null) frame.current = requestAnimationFrame(() => {
      frame.current = null
      setRect(rectRef.current)
    })
  }, [])
  const cancel = useCallback(() => {
    interaction.current = null
    pinchStart.current = null
    pointers.current.clear()
    const held = [...captures.current]
    captures.current.clear()
    for (const [id, target] of held) if (target.hasPointerCapture?.(id)) target.releasePointerCapture(id)
  }, [])
  useEffect(() => {
    if (hidden) { cancel(); return }
    const video = slotRef.current?.querySelector('video')
    if (video?.videoWidth && video.videoHeight) ratioRef.current = video.videoWidth / video.videoHeight
    boundsRef.current = readWindowBounds()
    apply(preferredRect.current, false)
    if (shownTip.current) return
    shownTip.current = true
    let seen = false
    try {
      seen = window.localStorage.getItem('newsnook:floating-guide-seen') === '1'
      if (!seen) window.localStorage.setItem('newsnook:floating-guide-seen', '1')
    } catch {
      // Private browsing / disabled storage must not block playback.
    }
    if (seen) return
    setTip(true)
  }, [apply, cancel, hidden, slotRef])
  useEffect(() => {
    if (hidden) { setTip(false); return }
    if (!tip) return
    const timer = window.setTimeout(() => setTip(false), 6000)
    return () => window.clearTimeout(timer)
  }, [hidden, tip])
  useEffect(() => {
    const sync = () => {
      boundsRef.current = readWindowBounds()
      const video = slotRef.current?.querySelector('video')
      if (video?.videoWidth && video.videoHeight) ratioRef.current = video.videoWidth / video.videoHeight
      if (!hiddenRef.current) apply(preferredRect.current, false)
    }
    sync()
    const observer = new ResizeObserver(sync)
    if (slotRef.current) observer.observe(slotRef.current)
    const root = rootRef.current
    root?.addEventListener('loadedmetadata', sync, true)
    window.addEventListener('resize', sync)
    window.addEventListener('blur', cancel)
    const viewport = window.visualViewport
    viewport?.addEventListener('resize', sync)
    viewport?.addEventListener('scroll', sync)
    return () => {
      observer.disconnect()
      root?.removeEventListener('loadedmetadata', sync, true)
      window.removeEventListener('resize', sync)
      window.removeEventListener('blur', cancel)
      viewport?.removeEventListener('resize', sync)
      viewport?.removeEventListener('scroll', sync)
      if (frame.current != null) cancelAnimationFrame(frame.current)
      frame.current = null
      cancel()
    }
  }, [apply, cancel, rootRef, slotRef])

  const gesture = (resizing: boolean) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || hidden || pointers.current.size > 1) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      captures.current.set(event.pointerId, event.currentTarget)
      interaction.current = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: rectRef.current, resize: resizing }
      setTip(false)
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = interaction.current
      if (!start || start.id !== event.pointerId || pointers.current.size > 1) return
      event.preventDefault()
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      apply(start.resize ? { ...start.rect, width: start.rect.width + Math.max(dx, dy * ratioRef.current) }
        : { ...start.rect, x: start.rect.x + dx, y: start.rect.y + dy })
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      if (interaction.current?.id !== event.pointerId) return
      interaction.current = null
      captures.current.delete(event.pointerId)
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel: cancel,
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      if (interaction.current?.id === event.pointerId && pointers.current.size < 2) cancel()
    },
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      const delta = (event.shiftKey ? 32 : 8) * (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1)
      const current = rectRef.current
      if (resizing) apply({ ...current, width: current.width + delta })
      else apply({ ...current, x: current.x + (event.key === 'ArrowLeft' || event.key === 'ArrowRight' ? delta : 0),
        y: current.y + (event.key === 'ArrowUp' || event.key === 'ArrowDown' ? delta : 0) })
      setTip(false)
    },
  })
  const pair = () => {
    const [a, b] = [...pointers.current.values()]
    return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null
  }
  return { rect, tip, dismissTip: () => setTip(false), drag: gesture(false), resize: gesture(true), pinch: {
    onPointerDownCapture(event: PointerEvent<HTMLDivElement>) {
      if (hidden || event.pointerType !== 'touch') return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size === 2) {
        interaction.current = null
        const current = pair()!
        pinchStart.current = { ...current, rect: rectRef.current }
        for (const id of pointers.current.keys()) {
          event.currentTarget.setPointerCapture?.(id)
          captures.current.set(id, event.currentTarget)
        }
        event.preventDefault()
        setTip(false)
      }
    },
    onPointerMoveCapture(event: PointerEvent<HTMLDivElement>) {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const start = pinchStart.current
      const current = pair()
      if (!start || !current || !start.distance) return
      event.preventDefault()
      event.stopPropagation()
      const factor = current.distance / start.distance
      apply({ x: current.x - (start.x - start.rect.x) * factor,
        y: current.y - (start.y - start.rect.y) * factor, width: start.rect.width * factor })
    },
    onPointerUpCapture(event: PointerEvent<HTMLDivElement>) {
      pointers.current.delete(event.pointerId)
      captures.current.delete(event.pointerId)
      pinchStart.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancelCapture: cancel,
  } }
}
