import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { Download, Share2, X } from 'lucide-react'

import { saveImageToGallery, shareImage } from '../lib/imageActions'
import { lockBodyScroll } from '../lib/bodyScrollLock'
import { recoverAppScrollSurfaces } from '../lib/gestureStyles'

interface Props {
  src: string
  alt?: string
  onClose: () => void
  /** 系统返回：先关菜单，再关灯箱 */
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_ZOOM = 2.5
const LONG_PRESS_MS = 460

type Point = { x: number; y: number }
type BusyAction = 'save' | 'share' | null

/**
 * 全屏看图：双指捏合、单指平移、双击缩放、下滑关闭；长按保存/分享。
 */
export function ImageLightbox({ src, alt = '', onClose, overlayCloserRef }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const transformRef = useRef({ scale: 1, x: 0, y: 0 })
  const pointersRef = useRef(new Map<number, Point>())
  const pinchStartRef = useRef<{
    distance: number
    scale: number
    mid: Point
    x: number
    y: number
  } | null>(null)
  const panStartRef = useRef<{ point: Point; x: number; y: number } | null>(null)
  const lastTapRef = useRef<{ time: number; point: Point } | null>(null)
  const movedRef = useRef(false)
  const closingSwipeRef = useRef({ active: false, startY: 0, dy: 0 })
  const longPressTimerRef = useRef<number | null>(null)
  const longPressPointRef = useRef<Point | null>(null)

  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [status, setStatus] = useState<string | null>(null)

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressPointRef.current = null
  }, [])

  const applyTransform = useCallback((animate = false) => {
    const img = imgRef.current
    if (!img) return
    const { scale, x, y } = transformRef.current
    img.style.transition = animate ? 'transform 220ms var(--ease-ink)' : 'none'
    img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
  }, [])

  const clampTranslation = useCallback(() => {
    const stage = stageRef.current
    const img = imgRef.current
    const t = transformRef.current
    if (!stage || !img || t.scale <= MIN_SCALE) {
      t.x = 0
      t.y = 0
      return
    }

    const rect = stage.getBoundingClientRect()
    const naturalW = img.naturalWidth || img.clientWidth
    const naturalH = img.naturalHeight || img.clientHeight
    if (!naturalW || !naturalH) return

    const fit = Math.min(rect.width / naturalW, rect.height / naturalH)
    const displayW = naturalW * fit * t.scale
    const displayH = naturalH * fit * t.scale
    const maxX = Math.max(0, (displayW - rect.width) / 2)
    const maxY = Math.max(0, (displayH - rect.height) / 2)
    t.x = Math.min(maxX, Math.max(-maxX, t.x))
    t.y = Math.min(maxY, Math.max(-maxY, t.y))
  }, [])

  const resetTransform = useCallback(
    (animate = true) => {
      transformRef.current = { scale: 1, x: 0, y: 0 }
      applyTransform(animate)
    },
    [applyTransform],
  )

  const zoomTo = useCallback(
    (nextScale: number, around: Point, animate = true) => {
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const t = transformRef.current
      const cx = around.x - rect.left - rect.width / 2
      const cy = around.y - rect.top - rect.height / 2
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
      const ratio = clamped / t.scale
      t.x = cx - (cx - t.x) * ratio
      t.y = cy - (cy - t.y) * ratio
      t.scale = clamped
      if (t.scale <= MIN_SCALE) {
        t.x = 0
        t.y = 0
      } else {
        clampTranslation()
      }
      applyTransform(animate)
    },
    [applyTransform, clampTranslation],
  )

  const releaseStageCaptures = useCallback(() => {
    const stage = stageRef.current
    if (!stage) return
    pointersRef.current.forEach((_, pointerId) => {
      if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId)
    })
    pointersRef.current.clear()
    pinchStartRef.current = null
    panStartRef.current = null
    closingSwipeRef.current.active = false
  }, [])

  useEffect(() => {
    const unlock = lockBodyScroll()
    return () => {
      clearLongPress()
      releaseStageCaptures()
      unlock()
      recoverAppScrollSurfaces()
    }
  }, [clearLongPress, releaseStageCaptures])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (menuOpen) {
        setMenuOpen(false)
        setStatus(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen, onClose])

  useEffect(() => {
    if (!overlayCloserRef) return
    overlayCloserRef.current = () => {
      if (menuOpen) {
        setMenuOpen(false)
        setStatus(null)
        return true
      }
      onClose()
      return true
    }
    return () => {
      overlayCloserRef.current = null
    }
  }, [menuOpen, onClose, overlayCloserRef])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const midpoint = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })

  const openMenu = () => {
    clearLongPress()
    movedRef.current = true
    panStartRef.current = null
    closingSwipeRef.current.active = false
    lastTapRef.current = null
    setStatus(null)
    setMenuOpen(true)
    if (navigator.vibrate) navigator.vibrate(12)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (menuOpen || busy) return
    const stage = stageRef.current
    if (!stage) return
    stage.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    movedRef.current = false

    if (pointersRef.current.size === 2) {
      clearLongPress()
      const [a, b] = [...pointersRef.current.values()]
      const t = transformRef.current
      pinchStartRef.current = {
        distance: distance(a, b),
        scale: t.scale,
        mid: midpoint(a, b),
        x: t.x,
        y: t.y,
      }
      panStartRef.current = null
      closingSwipeRef.current.active = false
      return
    }

    if (pointersRef.current.size === 1) {
      const point = { x: event.clientX, y: event.clientY }
      longPressPointRef.current = point
      longPressTimerRef.current = window.setTimeout(openMenu, LONG_PRESS_MS)

      if (transformRef.current.scale > MIN_SCALE + 0.01) {
        panStartRef.current = {
          point,
          x: transformRef.current.x,
          y: transformRef.current.y,
        }
        closingSwipeRef.current.active = false
      } else {
        panStartRef.current = null
        closingSwipeRef.current = { active: true, startY: point.y, dy: 0 }
      }
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (longPressPointRef.current) {
      const drift = distance(longPressPointRef.current, {
        x: event.clientX,
        y: event.clientY,
      })
      if (drift > 10) clearLongPress()
    }

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      clearLongPress()
      const [a, b] = [...pointersRef.current.values()]
      const start = pinchStartRef.current
      const nextDistance = distance(a, b)
      if (start.distance < 1) return
      const mid = midpoint(a, b)
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, start.scale * (nextDistance / start.distance)),
      )
      transformRef.current.scale = start.scale
      transformRef.current.x = start.x
      transformRef.current.y = start.y
      zoomTo(nextScale, mid, false)
      movedRef.current = true
      return
    }

    if (pointersRef.current.size === 1) {
      const point = { x: event.clientX, y: event.clientY }
      if (panStartRef.current) {
        const start = panStartRef.current
        const dx = point.x - start.point.x
        const dy = point.y - start.point.y
        if (Math.hypot(dx, dy) > 4) {
          movedRef.current = true
          clearLongPress()
        }
        transformRef.current.x = start.x + dx
        transformRef.current.y = start.y + dy
        clampTranslation()
        applyTransform(false)
        return
      }

      if (closingSwipeRef.current.active) {
        const dy = point.y - closingSwipeRef.current.startY
        closingSwipeRef.current.dy = dy
        if (Math.abs(dy) > 6) {
          movedRef.current = true
          clearLongPress()
        }
        const img = imgRef.current
        const backdrop = stageRef.current
        if (img && backdrop) {
          const pull = Math.max(0, dy)
          img.style.transition = 'none'
          img.style.transform = `translate3d(0, ${pull}px, 0) scale(1)`
          backdrop.style.backgroundColor = `rgb(14 15 18 / ${Math.max(0.35, 0.92 - pull / 480)})`
        }
      }
    }
  }

  const finishPointers = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearLongPress()
    if (stageRef.current?.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId)
    }
    pointersRef.current.delete(event.pointerId)

    if (pointersRef.current.size < 2) pinchStartRef.current = null
    if (pointersRef.current.size === 0) {
      panStartRef.current = null

      if (closingSwipeRef.current.active) {
        const dy = closingSwipeRef.current.dy
        closingSwipeRef.current.active = false
        if (dy > 96 && !menuOpen) {
          onClose()
          return
        }
        const backdrop = stageRef.current
        if (backdrop) backdrop.style.backgroundColor = ''
        resetTransform(true)
      }

      if (transformRef.current.scale <= MIN_SCALE + 0.02) {
        resetTransform(true)
      } else {
        clampTranslation()
        applyTransform(true)
      }
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasSingle = pointersRef.current.size === 1 && !pinchStartRef.current
    const point = { x: event.clientX, y: event.clientY }
    const didMove = movedRef.current
    finishPointers(event)

    if (menuOpen || !wasSingle || didMove) return

    const now = performance.now()
    const last = lastTapRef.current
    if (last && now - last.time < DOUBLE_TAP_MS && distance(last.point, point) < 36) {
      lastTapRef.current = null
      if (transformRef.current.scale > MIN_SCALE + 0.05) resetTransform(true)
      else zoomTo(DOUBLE_TAP_ZOOM, point, true)
      return
    }
    lastTapRef.current = { time: now, point }
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (menuOpen) return
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    zoomTo(transformRef.current.scale * factor, { x: event.clientX, y: event.clientY }, false)
  }

  const runAction = async (action: 'save' | 'share') => {
    if (busy) return
    setBusy(action)
    setStatus(null)
    try {
      if (action === 'save') {
        await saveImageToGallery(src)
        setStatus('已保存到相册 有所闻')
      } else {
        await shareImage(src, alt || '分享图片')
        setMenuOpen(false)
        setStatus(null)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败'
      // 用户取消分享不提示为错误
      if (/cancel|abort|dismiss/i.test(message)) {
        setStatus(null)
      } else {
        setStatus(message)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="查看图片"
      // 看图始终用深底衬托画面，不跟随浅色主题
      data-theme="dark"
      className="fixed inset-0 z-[80] flex flex-col bg-ink/95"
      style={{ touchAction: 'none' }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end"
        style={{ paddingTop: 'var(--sat)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="pointer-events-auto m-3 rounded-full border border-haze bg-ink-raised/80 p-2.5 text-paper backdrop-blur-md"
        >
          <X size={18} strokeWidth={1.7} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={finishPointers}
        onWheel={onWheel}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenu()
        }}
        onClick={(event) => {
          if (menuOpen) return
          if (event.target === event.currentTarget && transformRef.current.scale <= MIN_SCALE + 0.02) {
            onClose()
          }
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          draggable={false}
          referrerPolicy="no-referrer"
          className="max-h-full max-w-full select-none object-contain"
          style={{ transformOrigin: 'center center', willChange: 'transform' }}
        />
      </div>

      <p
        className="pointer-events-none text-center font-mono text-[10px] tracking-[0.14em] text-paper-faint safe-pb-12"
      >
        长按保存或分享 · 双指缩放 · 下滑关闭
      </p>

      {menuOpen && (
        <div className="absolute inset-0 z-20 flex flex-col justify-end bg-ink/55">
          <button
            type="button"
            aria-label="关闭菜单"
            className="min-h-0 flex-1"
            onClick={() => {
              if (busy) return
              setMenuOpen(false)
              setStatus(null)
            }}
          />
          <div
            className="border-t border-haze bg-ink-raised px-4 pt-3 safe-pb-16"
          >
            <p className="mb-3 font-mono text-[10px] tracking-[0.16em] text-paper-faint">图片操作</p>
            <div className="grid gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction('save')}
                className="flex items-center gap-3 rounded-xl border border-haze bg-ink/50 px-4 py-3.5 text-left text-[14px] text-paper disabled:opacity-50"
              >
                <Download size={18} strokeWidth={1.6} className="text-cinnabar-soft" />
                <span className="flex-1">{busy === 'save' ? '正在保存…' : '保存到相册'}</span>
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void runAction('share')}
                className="flex items-center gap-3 rounded-xl border border-haze bg-ink/50 px-4 py-3.5 text-left text-[14px] text-paper disabled:opacity-50"
              >
                <Share2 size={18} strokeWidth={1.6} className="text-cinnabar-soft" />
                <span className="flex-1">{busy === 'share' ? '正在准备…' : '分享'}</span>
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  setMenuOpen(false)
                  setStatus(null)
                }}
                className="mt-1 rounded-xl px-4 py-3 text-[13px] text-paper-muted"
              >
                取消
              </button>
            </div>
            {status && (
              <p className="mt-3 font-mono text-[11px] leading-relaxed text-paper-muted">{status}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
