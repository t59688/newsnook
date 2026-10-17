import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { ChevronLeft, ChevronRight, Download, FlipHorizontal2, FlipVertical2, Loader2, MoreHorizontal, RotateCcw, RotateCw, RefreshCcw, Share2, SlidersHorizontal, X } from 'lucide-react'

import { saveImageToGallery, shareImage } from '../lib/imageActions'
import { lockBodyScroll } from '../lib/bodyScrollLock'
import { acquireNativeChromeTheme } from '../lib/nativeChrome'
import { recoverAppScrollSurfaces } from '../lib/gestureStyles'
import { shouldResetReaderPinchSequence } from '../lib/readerFontPinch'
import type { GalleryImage } from '../lib/imageGallery'

interface Props {
  src: string
  /** 保存 / 分享时优先使用的原始地址；显示可继续使用 blob/fallback URL。 */
  actionSrc?: string
  alt?: string
  onClose: () => void
  onPrevious?: () => void
  onNext?: () => void
  index?: number
  total?: number
  items?: readonly GalleryImage[]
  onSelect?: (index: number) => void
  /** Browser images retain their native request context through this optional adapter. */
  onAction?: (action: 'save' | 'share') => Promise<'saved' | 'shared' | 'cancelled' | void>
  /** Confirmation precedes the busy label and every export side effect. */
  onBeforeAction?: (action: 'save' | 'share') => Promise<boolean>
  browserMode?: boolean
  contextLabel?: string
  onRetry?: () => void
  loadError?: string | null
  renderThumbnail?: (item: GalleryImage, index: number) => ReactNode
  /** 系统返回：先关菜单，再关灯箱 */
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_ZOOM = 2.5
const LONG_PRESS_MS = 460
const SLIDE_DURATION_MS = 240

type Point = { x: number; y: number }
type BusyAction = 'save' | 'share' | null

function GallerySlide({ src, alt = '', current, imgRef, stageRef, onLoad, onError, browserMode }: {
  src: string
  alt?: string
  current: boolean
  browserMode?: boolean
  imgRef: MutableRefObject<HTMLImageElement | null>
  stageRef: MutableRefObject<HTMLDivElement | null>
  onLoad: () => void
  onError: () => void
}) {
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'error'>('loading')
  const localRef = useRef<HTMLImageElement>(null)
  const fitPreview = useCallback(() => {
    const img = localRef.current
    const stage = stageRef.current
    if (!img?.naturalWidth || !img.naturalHeight || !stage) return
    const { width, height } = stage.getBoundingClientRect()
    const fit = Math.min(width / img.naturalWidth, height / img.naturalHeight)
    img.style.width = `${img.naturalWidth * fit}px`
    img.style.height = `${img.naturalHeight * fit}px`
  }, [stageRef])
  useLayoutEffect(() => {
    const img = localRef.current
    if (!current && img) {
      fitPreview()
      img.style.transform = 'translate3d(0px, 0px, 0) scale(1, 1) rotate(0deg)'
      img.style.transition = 'none'
    }
  }, [current, fitPreview])
  useEffect(() => {
    if (current) return
    const stage = stageRef.current
    if (!stage) return
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', fitPreview)
      return () => window.removeEventListener('resize', fitPreview)
    }
    const observer = new ResizeObserver(fitPreview)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [current, fitPreview, stageRef])
  return <>
    {!current && phase === 'loading' ? <Loader2 size={24} className="absolute animate-spin text-paper-faint" /> : null}
    {!current && phase === 'error' ? <span className={'absolute ' + (browserMode ? 'text-[13px] text-paper-muted' : 'text-[12px] text-paper-faint')}>图片暂时无法加载</span> : null}
    <img ref={(img) => { localRef.current = img; if (current) imgRef.current = img }}
      src={src || undefined} alt={current ? alt : ''} draggable={false} referrerPolicy="no-referrer"
      onLoad={() => { if (!current) fitPreview(); setPhase('loaded'); if (current) onLoad() }}
      onError={() => { setPhase('error'); if (current) onError() }}
      className="pointer-events-auto shrink-0 select-none object-contain"
      style={{ transformOrigin: 'center center', willChange: 'transform', opacity: phase === 'loaded' ? 1 : 0 }} />
  </>
}

/**
 * 全屏看图：双指捏合、单指平移、双击缩放、下滑关闭；长按保存/分享。
 */
export function ImageLightbox({ src, actionSrc, alt = '', onClose, onPrevious, onNext, index = 0, total = 1, items, onSelect, overlayCloserRef, onAction, onBeforeAction, browserMode = false, contextLabel, onRetry, loadError, renderThumbnail }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const trackIndexRef = useRef(index)
  const slideTimerRef = useRef<number | null>(null)
  const pendingSlideRef = useRef<(() => void) | null>(null)
  const thumbnailsRef = useRef<HTMLDivElement>(null)
  const thumbnailDragRef = useRef<{ startX: number; left: number } | null>(null)
  const suppressThumbnailClickRef = useRef(false)
  const transformRef = useRef({ scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false })
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
  const closingSwipeRef = useRef({ active: false, startX: 0, startY: 0, dx: 0, dy: 0, axis: null as 'x' | 'y' | null })
  const longPressTimerRef = useRef<number | null>(null)
  const longPressPointRef = useRef<Point | null>(null)
  const actionPendingRef = useRef(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [busy, setBusy] = useState<BusyAction>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [imageState, setImageState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [reload, setReload] = useState<{ src: string; index: number; attempt: number } | null>(null)
  const canAdjust = imageState === 'loaded' && !loadError

  useLayoutEffect(() => {
    if (browserMode) return acquireNativeChromeTheme('dark')
  }, [browserMode])

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressPointRef.current = null
  }, [])

  const resetTrack = useCallback(() => {
    if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current)
    slideTimerRef.current = null
    pendingSlideRef.current = null
    const track = trackRef.current
    if (track) {
      track.style.transition = 'none'
      track.style.transform = `translate3d(${-trackIndexRef.current * 100}%, 0, 0)`
    }
  }, [])

  const finishSlide = useCallback(() => {
    const commit = pendingSlideRef.current
    if (!commit) return
    pendingSlideRef.current = null
    if (slideTimerRef.current !== null) window.clearTimeout(slideTimerRef.current)
    slideTimerRef.current = null
    commit()
  }, [])

  const settleTrack = useCallback((offset: number, commit?: () => void) => {
    const track = trackRef.current
    if (!track) { commit?.(); return }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    track.style.transition = reduced ? 'none' : `transform ${SLIDE_DURATION_MS}ms var(--ease-ink)`
    const targetIndex = trackIndexRef.current + (commit ? (offset < 0 ? 1 : -1) : 0)
    track.style.transform = `translate3d(${-targetIndex * 100}%, 0, 0)`
    if (!commit) return
    pendingSlideRef.current = commit
    if (reduced) finishSlide()
    else slideTimerRef.current = window.setTimeout(finishSlide, SLIDE_DURATION_MS + 80)
  }, [finishSlide])

  const applyTransform = useCallback((animate = false) => {
    const img = imgRef.current
    if (!img) return
    const { scale, x, y, rotation, flipX, flipY } = transformRef.current
    img.style.transition = animate ? 'transform 220ms var(--ease-ink)' : 'none'
    img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${flipX ? -scale : scale}, ${flipY ? -scale : scale}) rotate(${rotation}deg)`
  }, [])

  const fitImage = useCallback(() => {
    const stage = stageRef.current
    const img = imgRef.current
    if (!stage || !img || !img.naturalWidth || !img.naturalHeight) return null
    const rotated = transformRef.current.rotation % 180 !== 0
    const width = rotated ? img.naturalHeight : img.naturalWidth
    const height = rotated ? img.naturalWidth : img.naturalHeight
    const rect = stage.getBoundingClientRect()
    const fit = Math.min(rect.width / width, rect.height / height)
    img.style.width = `${img.naturalWidth * fit}px`
    img.style.height = `${img.naturalHeight * fit}px`
    return { width: width * fit, height: height * fit }
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
    const rotated = t.rotation % 180 !== 0
    const fit = Math.min(
      rect.width / (rotated ? img.naturalHeight : img.naturalWidth),
      rect.height / (rotated ? img.naturalWidth : img.naturalHeight),
    )
    const displayW = (rotated ? img.naturalHeight : img.naturalWidth) * fit * t.scale
    const displayH = (rotated ? img.naturalWidth : img.naturalHeight) * fit * t.scale
    const maxX = Math.max(0, (displayW - rect.width) / 2)
    const maxY = Math.max(0, (displayH - rect.height) / 2)
    t.x = Math.min(maxX, Math.max(-maxX, t.x))
    t.y = Math.min(maxY, Math.max(-maxY, t.y))
  }, [])

  const resetTransform = useCallback(
    (animate = true) => {
      const t = transformRef.current
      t.scale = 1
      t.x = 0
      t.y = 0
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

  const releaseStageCaptures = useCallback((stage = stageRef.current) => {
    const pointerIds = [...pointersRef.current.keys()]
    // Clear state before releasing captures: lostpointercapture may fire during release.
    pointersRef.current.clear()
    pinchStartRef.current = null
    panStartRef.current = null
    closingSwipeRef.current.active = false
    for (const pointerId of pointerIds) {
      if (stage?.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId)
    }
  }, [])

  const cancelGesture = useCallback(() => {
    clearLongPress()
    releaseStageCaptures()
    resetTrack()
    movedRef.current = true
    lastTapRef.current = null
    const stage = stageRef.current
    if (stage) stage.style.backgroundColor = ''
    clampTranslation()
    applyTransform(false)
  }, [applyTransform, clampTranslation, clearLongPress, releaseStageCaptures, resetTrack])

  const adjustImage = useCallback((action: 'left' | 'right' | 'horizontal' | 'vertical' | 'reset') => {
    cancelGesture()
    const t = transformRef.current
    if (action === 'reset') {
      t.rotation = 0
      t.flipX = false
      t.flipY = false
    } else if (action === 'left' || action === 'right') {
      t.rotation = (t.rotation + (action === 'right' ? 90 : 270)) % 360
    } else if (action === 'horizontal') {
      t.flipX = !t.flipX
    } else {
      t.flipY = !t.flipY
    }
    t.scale = 1
    t.x = 0
    t.y = 0
    fitImage()
    applyTransform(true)
  }, [applyTransform, cancelGesture, fitImage])

  useEffect(() => {
    // React clears refs before passive unmount cleanup; retain the capture owner.
    const stage = stageRef.current
    const unlock = lockBodyScroll()
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') cancelGesture()
    }
    window.addEventListener('blur', cancelGesture)
    window.addEventListener('pagehide', cancelGesture)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancelGesture)
      window.removeEventListener('pagehide', cancelGesture)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearLongPress()
      releaseStageCaptures(stage)
      resetTrack()
      unlock()
      recoverAppScrollSurfaces()
    }
  }, [cancelGesture, clearLongPress, releaseStageCaptures, resetTrack])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!menuOpen && !adjustOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        if (event.key === 'ArrowLeft') onPrevious?.()
        else onNext?.()
        return
      }
      if (event.key !== 'Escape') return
      if (menuOpen) {
        setMenuOpen(false)
        setStatus(null)
        return
      }
      if (adjustOpen) {
        setAdjustOpen(false)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adjustOpen, menuOpen, onClose, onPrevious, onNext])

  useEffect(() => {
    if (!overlayCloserRef) return
    overlayCloserRef.current = () => {
      if (menuOpen) {
        setMenuOpen(false)
        setStatus(null)
        return true
      }
      if (adjustOpen) {
        setAdjustOpen(false)
        return true
      }
      onClose()
      return true
    }
    return () => {
      overlayCloserRef.current = null
    }
  }, [adjustOpen, menuOpen, onClose, overlayCloserRef])

  useEffect(() => () => clearLongPress(), [clearLongPress])

  useLayoutEffect(() => {
    trackIndexRef.current = index
    cancelGesture()
    setImageState('loading')
    setAdjustOpen(false)
    setMenuOpen(false)
    setStatus(null)
    transformRef.current = { scale: 1, x: 0, y: 0, rotation: 0, flipX: false, flipY: false }
    const img = imgRef.current
    applyTransform(false)
    if (src && img?.complete) {
      if (img.naturalWidth > 0) {
        fitImage()
        setImageState('loaded')
      } else setImageState('error')
    }
  }, [src, index, applyTransform, cancelGesture, fitImage])

  useEffect(() => {
    const rail = thumbnailsRef.current
    const selected = rail?.querySelector<HTMLButtonElement>('[aria-current="true"]')
    if (!rail || !selected) return
    const left = selected.offsetLeft - (rail.clientWidth - selected.offsetWidth) / 2
    rail.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }, [index])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const refit = () => {
      fitImage()
      clampTranslation()
      applyTransform(false)
    }
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', refit)
      return () => window.removeEventListener('resize', refit)
    }
    const observer = new ResizeObserver(refit)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [applyTransform, clampTranslation, fitImage])

  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
  const midpoint = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })

  const openMenu = () => {
    cancelGesture()
    setStatus(null)
    setAdjustOpen(false)
    setMenuOpen(true)
    if (navigator.vibrate) navigator.vibrate(12)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (menuOpen || busy || pendingSlideRef.current) return
    const stage = stageRef.current
    if (!stage) return
    if (shouldResetReaderPinchSequence(pointersRef.current.size, event)) cancelGesture()
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
      resetTrack()
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
        closingSwipeRef.current = { active: true, startX: point.x, startY: point.y, dx: 0, dy: 0, axis: null }
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
        const dx = point.x - closingSwipeRef.current.startX
        const dy = point.y - closingSwipeRef.current.startY
        closingSwipeRef.current.dx = dx
        closingSwipeRef.current.dy = dy
        if (Math.hypot(dx, dy) > 6) {
          movedRef.current = true
          clearLongPress()
        }
        const img = imgRef.current
        const backdrop = stageRef.current
        if (!closingSwipeRef.current.axis && Math.hypot(dx, dy) > 8) {
          if (Math.abs(dx) > Math.abs(dy) * 1.2) closingSwipeRef.current.axis = 'x'
          else if (Math.abs(dy) > Math.abs(dx) * 1.2) closingSwipeRef.current.axis = 'y'
        }
        if (img && backdrop) {
          img.style.transition = 'none'
          if (closingSwipeRef.current.axis === 'x' && (onPrevious || onNext)) {
            const canMove = dx < 0 ? Boolean(onNext) : Boolean(onPrevious)
            const offset = canMove ? Math.max(-backdrop.getBoundingClientRect().width, Math.min(backdrop.getBoundingClientRect().width, dx)) : dx * 0.22
            if (trackRef.current) {
              trackRef.current.style.transition = 'none'
              trackRef.current.style.transform = `translate3d(calc(${-trackIndexRef.current * 100}% + ${offset}px), 0, 0)`
            }
          } else if (closingSwipeRef.current.axis === 'y') {
            const pull = Math.max(0, dy)
            const t = transformRef.current
            img.style.transform = `translate3d(0, ${pull}px, 0) scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1}) rotate(${t.rotation}deg)`
            backdrop.style.backgroundColor = `rgb(14 15 18 / ${Math.max(0.35, 0.92 - pull / 480)})`
          }
        }
      }
    }
  }

  const finishPointers = (event: ReactPointerEvent<HTMLDivElement>) => {
    clearLongPress()
    pointersRef.current.delete(event.pointerId)
    if (stageRef.current?.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId)
    }

    if (pointersRef.current.size < 2) pinchStartRef.current = null
    if (pointersRef.current.size === 0) {
      panStartRef.current = null

      if (closingSwipeRef.current.active) {
        const { dx, dy, axis } = closingSwipeRef.current
        closingSwipeRef.current.active = false
        if (axis === 'x' && !menuOpen) {
          const width = stageRef.current?.getBoundingClientRect().width ?? 0
          const commit = dx < 0 ? onNext : onPrevious
          if (width > 0 && Math.abs(dx) > Math.min(72, width * 0.2) && commit) {
            settleTrack(dx < 0 ? -width : width, commit)
          } else settleTrack(0)
          return
        }
        if (axis === 'y' && dy > 96 && !menuOpen) {
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
    if (menuOpen || pendingSlideRef.current) return
    event.preventDefault()
    const factor = event.deltaY > 0 ? 0.9 : 1.1
    zoomTo(transformRef.current.scale * factor, { x: event.clientX, y: event.clientY }, false)
  }

  const runAction = async (action: 'save' | 'share') => {
    if (busy || actionPendingRef.current) return
    actionPendingRef.current = true
    setStatus(null)
    try {
      if (onBeforeAction && !await onBeforeAction(action)) return
      setBusy(action)
      const source = actionSrc || src
      const result = onAction ? await onAction(action) : undefined
      if (result === 'cancelled') { setStatus(null); return }
      if (action === 'save') {
        if (!onAction) await saveImageToGallery(source)
        setStatus('已保存到相册 有所闻')
      } else {
        if (!onAction) await shareImage(source, alt || '分享图片')
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
      actionPendingRef.current = false
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
      data-browser-image-viewer={browserMode ? '' : undefined}
      className={'fixed inset-0 z-[80] flex select-none flex-col ' + (browserMode ? 'bg-ink' : 'bg-ink/98')}
      style={browserMode ? { fontFamily: 'var(--font-sans)' } : undefined}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between"
        style={{ paddingTop: 'var(--sat)' }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className={'pointer-events-auto m-3 rounded-full border border-haze bg-ink-raised/80 text-paper backdrop-blur-md ' + (browserMode ? 'grid h-11 w-11 place-items-center' : 'p-2.5')}
        >
          <X size={18} strokeWidth={1.7} />
        </button>
        {total > 1 || contextLabel ? <div className={'pointer-events-auto rounded-full border border-haze bg-ink-raised/75 px-3 py-1.5 text-paper-muted backdrop-blur-md ' + (browserMode ? 'text-[13px] tabular-nums' : 'font-mono text-[11px]')}>
          {contextLabel ? <span>{contextLabel}{total > 1 ? ' · ' : ''}</span> : null}{total > 1 ? <span>{index + 1} / {total}</span> : null}
        </div> : <span />}
        <button type="button" aria-label="图片操作" onClick={openMenu} className="pointer-events-auto m-3 grid h-11 w-11 place-items-center rounded-full border border-haze bg-ink-raised/80 text-paper backdrop-blur-md"><MoreHorizontal size={20} strokeWidth={1.7} /></button>
      </div>

      <div
        ref={stageRef}
        data-image-stage
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        style={{ marginTop: 'calc(var(--sat, 0px) + 64px)' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelGesture}
        onLostPointerCapture={(event) => {
          if (pointersRef.current.has(event.pointerId)) cancelGesture()
        }}
        onWheel={onWheel}
        onContextMenu={(event) => {
          event.preventDefault()
          openMenu()
        }}
        onClick={(event) => {
          if (menuOpen || adjustOpen || movedRef.current) return
          if (event.target === event.currentTarget && transformRef.current.scale <= MIN_SCALE + 0.02) {
            onClose()
          }
        }}
      >
        {imageState === 'loading' && !loadError ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-live="polite">
            <div className="flex flex-col items-center gap-3 text-paper-faint">
              <Loader2 size={24} className="animate-spin" />
              <span className={browserMode ? 'text-[13px] text-paper-muted' : 'font-mono text-[10px] tracking-[0.12em]'}>图片加载中</span>
            </div>
          </div>
        ) : null}
        {imageState === 'error' || loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
            {loadError ? <p role="status" className={'max-w-sm text-center leading-relaxed text-paper-muted ' + (browserMode ? 'text-[13px]' : 'text-[12px]')}>{loadError}</p> : null}
            <button
              type="button"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                cancelGesture()
                onRetry?.()
                setImageState('loading')
                setReload((value) => ({ src, index, attempt: value?.src === src && value.index === index ? value.attempt + 1 : 1 }))
              }}
              className={'flex items-center gap-2 rounded-full border border-haze bg-ink-raised/85 px-4 py-2.5 text-paper-muted backdrop-blur-md ' + (browserMode ? 'min-h-11 text-[13px]' : 'text-[12px]')}
            >
              <RefreshCcw size={15} />重新加载图片
            </button>
          </div>
        ) : null}
        {total > 1 ? (
          <>
            <button type="button" disabled={!onPrevious} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPrevious?.() }} aria-label="上一张" className="absolute left-4 z-10 hidden h-11 w-11 place-items-center rounded-full border border-haze bg-ink-raised/65 text-paper backdrop-blur-md transition-colors hover:bg-ink-raised disabled:opacity-20 sm:grid"><ChevronLeft size={22} /></button>
            <button type="button" disabled={!onNext} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onNext?.() }} aria-label="下一张" className="absolute right-4 z-10 hidden h-11 w-11 place-items-center rounded-full border border-haze bg-ink-raised/65 text-paper backdrop-blur-md transition-colors hover:bg-ink-raised disabled:opacity-20 sm:grid"><ChevronRight size={22} /></button>
          </>
        ) : null}
        <div ref={trackRef} data-image-track
          className="pointer-events-none absolute inset-0"
          style={{ transform: `translate3d(${-index * 100}%, 0, 0)`, willChange: 'transform' }}
          onTransitionEnd={(event) => {
            if (event.target === event.currentTarget && event.propertyName === 'transform') finishSlide()
          }}>
          {[index - 1, index, index + 1].map((position) => {
            const current = position === index
            const item = current ? { src, alt } : items?.[position]
            return <div key={`${position}:${item?.src ?? ''}`} aria-hidden={current ? undefined : true}
              className="absolute top-0 flex h-full w-full items-center justify-center overflow-hidden"
              style={{ left: `${position * 100}%` }}>
              {item ? <GallerySlide key={reload?.src === item.src && reload.index === position ? reload.attempt : 0} {...item} current={current} imgRef={imgRef} stageRef={stageRef} browserMode={browserMode}
                onLoad={() => { fitImage(); applyTransform(false); setImageState('loaded') }}
                onError={() => setImageState('error')} /> : null}
            </div>
          })}
        </div>
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[960px] shrink-0 flex-col items-center gap-3 px-4 pt-3 safe-pb-12">
        {adjustOpen ? (
          <div className="w-full max-w-[440px] rounded-[22px] border border-haze bg-ink-raised/95 p-2 shadow-xl backdrop-blur-xl">
            <div className="flex items-center justify-between px-2 pb-1.5">
              <span className={'font-medium text-paper ' + (browserMode ? 'text-[14px]' : 'text-[12px]')}>调整图片</span>
              <button type="button" aria-label="收起图片调整" onClick={() => setAdjustOpen(false)} className={'grid place-items-center rounded-full text-paper-muted active:bg-haze/40 ' + (browserMode ? 'h-11 w-11' : 'h-9 w-9')}><X size={17} /></button>
            </div>
            <div role="toolbar" aria-label="图片调整" className="grid grid-cols-5 gap-1">
              {([
                ['left', RotateCcw, '左转90°', '左转'],
                ['right', RotateCw, '右转90°', '右转'],
                ['horizontal', FlipHorizontal2, '水平镜像', '水平'],
                ['vertical', FlipVertical2, '垂直镜像', '垂直'],
                ['reset', RefreshCcw, '还原', '还原'],
              ] as const).map(([action, Icon, label, shortLabel]) => (
                <button key={action} type="button" aria-label={label} title={label} disabled={!canAdjust} onClick={() => adjustImage(action)} className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-paper transition-colors active:bg-haze/50 disabled:opacity-30">
                  <Icon size={20} strokeWidth={1.6} />
                  <span className={'whitespace-nowrap ' + (browserMode ? 'text-[13px]' : 'text-[11px]')}>{shortLabel}</span>
                </button>
              ))}
            </div>
            <p className={'pt-2 text-center ' + (browserMode ? 'text-[13px] text-paper-muted' : 'text-[10px] text-paper-faint')}>仅更改显示方向 · 保存与分享仍是原图</p>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between gap-3">
            <button type="button" aria-label="调整图片" aria-expanded={false} disabled={!canAdjust} onClick={() => setAdjustOpen(true)} className={'flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-haze bg-ink-raised/85 px-4 text-paper backdrop-blur-lg active:bg-haze/30 disabled:opacity-30 ' + (browserMode ? 'text-[13px]' : 'text-[12px]')}>
              <SlidersHorizontal size={16} strokeWidth={1.7} />调整图片
            </button>
            <p className={'text-right leading-relaxed ' + (browserMode ? 'text-[13px] text-paper-muted' : 'text-[10px] text-paper-faint')}>{total > 1 ? '左右滑动切换' : '双指缩放查看'}<span className="hidden sm:inline"> · 长按保存或分享</span></p>
          </div>
        )}
        {items && items.length > 1 && onSelect ? (
          <div className="w-full overflow-hidden rounded-2xl border border-paper/8 bg-ink-raised/50 p-1.5">
            <div ref={thumbnailsRef} aria-label="图片缩略图"
              className="relative flex touch-pan-x items-center gap-1.5 overflow-x-auto overscroll-x-contain scroll-hidden py-1"
              onPointerDown={(event) => {
                suppressThumbnailClickRef.current = false
                if (event.pointerType !== 'mouse' || event.button !== 0) return
                thumbnailDragRef.current = { startX: event.clientX, left: event.currentTarget.scrollLeft }
              }}
              onPointerMove={(event) => {
                const drag = thumbnailDragRef.current
                if (!drag) return
                const dx = event.clientX - drag.startX
                if (Math.abs(dx) > 5) {
                  suppressThumbnailClickRef.current = true
                  event.currentTarget.setPointerCapture(event.pointerId)
                  event.currentTarget.scrollLeft = drag.left - dx
                }
              }}
              onPointerUp={(event) => {
                thumbnailDragRef.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => { thumbnailDragRef.current = null }}
              onLostPointerCapture={() => { thumbnailDragRef.current = null }}
              onClickCapture={(event) => {
                if (suppressThumbnailClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressThumbnailClickRef.current = false }
              }}>
              {items.map((item, position) => (
                <button key={`${item.src}:${position}`} type="button" aria-label={`查看第 ${position + 1} 张图片`}
                  aria-current={position === index ? 'true' : undefined} onClick={() => onSelect(position)}
                  style={browserMode ? { minHeight: 44, minWidth: 44 } : undefined}
                  className={`relative grid h-[60px] w-[60px] shrink-0 place-items-center overflow-hidden rounded-lg border-2 transition-[border-color,opacity] [@media(max-height:500px)]:h-10 [@media(max-height:500px)]:w-12 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper ${position === index ? 'border-cinnabar-soft opacity-100' : 'border-transparent opacity-50 hover:opacity-90'}`}>
                  {renderThumbnail ? renderThumbnail(item, position) : <img src={item.src || undefined} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" className="h-full w-full object-cover" />}
                  <span className={'absolute bottom-0.5 right-0.5 rounded px-1 ' + (browserMode ? 'bg-ink-raised/90 text-[13px] leading-5 text-paper tabular-nums' : 'bg-black/60 font-mono text-[8px] leading-3 text-white')}>{position + 1}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

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
            <p className={'mb-3 ' + (browserMode ? 'text-[13px] text-paper-muted' : 'font-mono text-[10px] tracking-[0.16em] text-paper-faint')}>图片操作</p>
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
              <p className={'mt-3 leading-relaxed text-paper-muted ' + (browserMode ? 'text-[13px]' : 'font-mono text-[11px]')}>{status}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
