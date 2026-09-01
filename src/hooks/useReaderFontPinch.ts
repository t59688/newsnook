import { useEffect, useRef, useState, type RefObject } from 'react'

import {
  applyReaderFontSizeVar,
  formatFontScaleHud,
  pinchFontScale,
  shouldResetReaderPinchSequence,
} from '../lib/readerFontPinch'

const HUD_HOLD_MS = 1000

export interface UseReaderFontPinchOptions {
  targetRef: RefObject<HTMLElement | null>
  fontScale: number
  enabled: boolean
  onCommit: (next: number) => void
}

type Point = { x: number; y: number }

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function isExcludedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('[data-no-font-pinch], video'))
}

/**
 * Two-finger pinch on the reader scroll surface adjusts body font scale.
 * Preview updates CSS vars without writing prefs; commit runs on pinch end.
 */
export function useReaderFontPinch({
  targetRef,
  fontScale,
  enabled,
  onCommit,
}: UseReaderFontPinchOptions): { hudLabel: string | null; pinching: boolean } {
  const [hudLabel, setHudLabel] = useState<string | null>(null)
  const [pinching, setPinching] = useState(false)

  const fontScaleRef = useRef(fontScale)
  const onCommitRef = useRef(onCommit)
  const pointersRef = useRef(new Map<number, Point>())
  const startDistanceRef = useRef(0)
  const startScaleRef = useRef(fontScale)
  const previewRef = useRef<number | null>(null)
  const hudTimerRef = useRef(0)
  const pinchingRef = useRef(false)

  fontScaleRef.current = fontScale
  onCommitRef.current = onCommit

  useEffect(() => {
    const clearHudTimer = () => {
      if (!hudTimerRef.current) return
      window.clearTimeout(hudTimerRef.current)
      hudTimerRef.current = 0
    }

    /**
     * WebView may hand a touch sequence to native drag/media/system UI without
     * ever dispatching pointerup/pointercancel back to the reader. Clear every
     * piece of local gesture state together so one orphaned pointer cannot turn
     * all future single-finger scrolls into a fake two-finger pinch.
     */
    const resetInterruptedPinch = (updateUi = true) => {
      const hadPreview = previewRef.current != null
      pointersRef.current.clear()
      startDistanceRef.current = 0
      startScaleRef.current = fontScaleRef.current
      previewRef.current = null
      pinchingRef.current = false
      if (hadPreview) applyReaderFontSizeVar(fontScaleRef.current)
      clearHudTimer()
      if (updateUi) {
        setPinching(false)
        setHudLabel(null)
      }
    }

    if (!enabled) {
      resetInterruptedPinch()
      return
    }

    const element = targetRef.current
    if (!element) return

    const endPinch = () => {
      if (!pinchingRef.current) return
      pinchingRef.current = false
      setPinching(false)
      const preview = previewRef.current
      previewRef.current = null
      startDistanceRef.current = 0
      if (preview != null && Math.abs(preview - fontScaleRef.current) > 0.001) {
        onCommitRef.current(preview)
      }
      clearHudTimer()
      hudTimerRef.current = window.setTimeout(() => {
        setHudLabel(null)
        hudTimerRef.current = 0
      }, HUD_HOLD_MS)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (isExcludedTarget(event.target)) return

      // A new primary touch cannot belong to a still-active touch sequence.
      // Therefore any contacts left in the Map are stale terminal-event fallout.
      if (shouldResetReaderPinchSequence(pointersRef.current.size, event)) {
        resetInterruptedPinch()
      }

      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointersRef.current.size === 2) {
        clearHudTimer()
        const [a, b] = [...pointersRef.current.values()]
        startDistanceRef.current = distance(a, b)
        startScaleRef.current = fontScaleRef.current
        previewRef.current = fontScaleRef.current
        pinchingRef.current = true
        setPinching(true)
        setHudLabel(formatFontScaleHud(fontScaleRef.current))
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (!pinchingRef.current || pointersRef.current.size < 2) return
      if (event.cancelable) event.preventDefault()
      const [a, b] = [...pointersRef.current.values()]
      const next = pinchFontScale(
        startScaleRef.current,
        startDistanceRef.current,
        distance(a, b),
      )
      previewRef.current = next
      applyReaderFontSizeVar(next)
      setHudLabel(formatFontScaleHud(next))
    }

    const onPointerUp = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return
      pointersRef.current.delete(event.pointerId)
      if (pinchingRef.current && pointersRef.current.size < 2) {
        endPinch()
      }
    }

    const onGestureInterrupted = () => resetInterruptedPinch()
    const onPointerCancel = (event: PointerEvent) => {
      if (!pointersRef.current.has(event.pointerId)) return
      resetInterruptedPinch()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') onGestureInterrupted()
    }

    // Capture terminal events at window level so child controls stopping
    // propagation cannot strand an active reader pointer.
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointermove', onPointerMove, { passive: false })
    element.addEventListener('lostpointercapture', onPointerCancel)
    element.addEventListener('dragstart', onGestureInterrupted, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('blur', onGestureInterrupted)
    window.addEventListener('pagehide', onGestureInterrupted)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('lostpointercapture', onPointerCancel)
      element.removeEventListener('dragstart', onGestureInterrupted, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerCancel, true)
      window.removeEventListener('blur', onGestureInterrupted)
      window.removeEventListener('pagehide', onGestureInterrupted)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      resetInterruptedPinch(false)
    }
  }, [enabled, targetRef])

  return { hudLabel, pinching }
}
