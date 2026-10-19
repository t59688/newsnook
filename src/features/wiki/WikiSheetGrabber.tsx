import { useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { haptics } from '../../lib/haptics'

const DRAG_SLOP_PX = 4
// 状态栏/挖孔区域不宜成为触顶判定的必经触摸区。
const FULL_SCREEN_THRESHOLD_PX = 48
const COLLAPSED_THRESHOLD_PX = 20

type DragState = {
  pointerId: number
  originY: number
  originHeight: number
  currentHeight: number
  minHeight: number
  maxHeight: number
  initialManualHeight: number | null
  moved: boolean
  sheet: HTMLElement
  frame: number | null
  timeoutFrame: boolean
  lastAppliedHeight: number
  snapFeedbackSent: boolean
}

interface WikiSheetGrabberProps {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** 搜索面板触顶后切换到完整浏览器；百科面板不传，原位全屏。 */
  onReachTop?: () => void
}

const viewportHeight = () => window.innerHeight || document.documentElement.clientHeight

function collapsedFallback(sheet: HTMLElement, height: number): number {
  return sheet.classList.contains('wiki-sheet-search')
    ? height * 0.6
    : Math.min(height * 0.42, 340)
}

function clearManualHeight(sheet: HTMLElement) {
  sheet.style.removeProperty('height')
  sheet.style.removeProperty('min-height')
  sheet.style.removeProperty('max-height')
  sheet.classList.remove('wiki-sheet-dragging', 'wiki-sheet-manual', 'wiki-sheet-handoff', 'wiki-sheet-near-top')
}

function cancelDragFrame(drag: DragState) {
  if (drag.frame === null) return
  if (drag.timeoutFrame) window.clearTimeout(drag.frame)
  else cancelAnimationFrame(drag.frame)
  drag.frame = null
}

function applyDragHeight(drag: DragState) {
  if (drag.lastAppliedHeight === drag.currentHeight) return
  drag.sheet.style.height = `${drag.currentHeight}px`
  drag.lastAppliedHeight = drag.currentHeight
  drag.sheet.classList.toggle('wiki-sheet-near-top', drag.maxHeight - drag.currentHeight <= FULL_SCREEN_THRESHOLD_PX)
}

/**
 * 百科与搜索面板共享的抓手：只从顶部触发，避免正文滚动和 WebView 手势冲突。
 * 拖动时直接调整 DOM 高度，不让整棵百科正文随每一帧重新渲染。
 */
export function WikiSheetGrabber({ expanded, onExpandedChange, onReachTop }: WikiSheetGrabberProps) {
  const dragRef = useRef<DragState | null>(null)
  const sheetRef = useRef<HTMLElement | null>(null)
  const collapsedRef = useRef<number | null>(null)
  const manualHeightRef = useRef<number | null>(null)
  const skipNextClickRef = useRef(false)
  const preserveOnNextExpandChangeRef = useRef(false)

  // 等 React 把 expanded 类名提交到 DOM 后再清理手动尺寸，避免在半屏/全屏之间闪回。
  useLayoutEffect(() => {
    if (preserveOnNextExpandChangeRef.current) {
      preserveOnNextExpandChangeRef.current = false
      return
    }
    const sheet = sheetRef.current
    if (sheet && !dragRef.current) clearManualHeight(sheet)
    manualHeightRef.current = null
  }, [expanded])

  useEffect(() => {
    const resetOnViewportChange = () => {
      if (dragRef.current) cancelDragFrame(dragRef.current)
      dragRef.current = null
      collapsedRef.current = null
      manualHeightRef.current = null
      if (sheetRef.current) clearManualHeight(sheetRef.current)
    }
    window.addEventListener('resize', resetOnViewportChange)
    return () => {
      window.removeEventListener('resize', resetOnViewportChange)
      if (dragRef.current) cancelDragFrame(dragRef.current)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || dragRef.current) return
    const sheet = event.currentTarget.closest<HTMLElement>('.wiki-sheet')
    if (!sheet) return
    sheetRef.current = sheet
    skipNextClickRef.current = false
    const maxHeight = viewportHeight()
    const measuredHeight = sheet.getBoundingClientRect().height || manualHeightRef.current || collapsedFallback(sheet, maxHeight)
    if (!expanded && manualHeightRef.current === null) collapsedRef.current = Math.min(maxHeight, measuredHeight)
    const minHeight = Math.min(maxHeight, collapsedRef.current ?? collapsedFallback(sheet, maxHeight))
    dragRef.current = {
      pointerId: event.pointerId,
      originY: event.clientY,
      originHeight: measuredHeight,
      currentHeight: measuredHeight,
      minHeight,
      maxHeight,
      initialManualHeight: manualHeightRef.current,
      moved: false,
      sheet,
      frame: null,
      timeoutFrame: false,
      lastAppliedHeight: measuredHeight,
      snapFeedbackSent: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = event.clientY - drag.originY
    if (!drag.moved && Math.abs(delta) < DRAG_SLOP_PX) return
    if (!drag.moved) {
      drag.moved = true
      skipNextClickRef.current = true
      drag.sheet.classList.add('wiki-sheet-dragging')
      // 半窗原本有 75/82dvh 的 CSS 最大高度。拖拽必须同时解除这层限制，
      // 否则 height 虽在变化，窗口却被 max-height 卡住，而触顶判断仍然会触发。
      // 只在手势开始时写一次约束；后续每帧只更新 height，避免重复重布局。
      drag.sheet.style.minHeight = '0px'
      drag.sheet.style.maxHeight = `${drag.maxHeight}px`
    }
    event.preventDefault()
    const nextHeight = Math.max(drag.minHeight, Math.min(drag.maxHeight, drag.originHeight - delta))
    drag.currentHeight = nextHeight
    // 进入全屏触发带时立即给一次卡扣触感。同一手势来回跨越阈值也不重复震动。
    if (!expanded && !drag.snapFeedbackSent && drag.maxHeight - nextHeight <= FULL_SCREEN_THRESHOLD_PX) {
      drag.snapFeedbackSent = true
      void haptics.snap()
    }
    // touchmove 可能高于屏幕刷新率；每帧只写一次高度，避免抢占布局和原生 WebView 的时间片。
    if (drag.frame === null) {
      drag.timeoutFrame = typeof requestAnimationFrame !== 'function'
      drag.frame = drag.timeoutFrame
        ? window.setTimeout(() => { drag.frame = null; applyDragHeight(drag) }, 16)
        : requestAnimationFrame(() => { drag.frame = null; applyDragHeight(drag) })
    }
  }

  const finish = (event: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    cancelDragFrame(drag)
    // 松手前把最后一个指针位置写入 DOM，避免 rAF 还没执行就用过期尺寸做吸顶判定。
    if (drag.moved) applyDragHeight(drag)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.sheet.classList.remove('wiki-sheet-dragging', 'wiki-sheet-near-top')
    if (!drag.moved) return

    if (cancelled) {
      manualHeightRef.current = drag.initialManualHeight
      if (drag.initialManualHeight === null) clearManualHeight(drag.sheet)
      else {
        drag.sheet.style.height = `${drag.initialManualHeight}px`
        drag.sheet.classList.add('wiki-sheet-manual')
      }
      return
    }

    if (drag.maxHeight - drag.currentHeight <= FULL_SCREEN_THRESHOLD_PX) {
      manualHeightRef.current = null
      if (onReachTop) {
        // 保持已拖到顶的画面，直到原生半窗会话释放并打开完整浏览器。
        drag.sheet.classList.add('wiki-sheet-handoff')
        drag.sheet.style.height = `${drag.maxHeight}px`
        onReachTop()
      } else {
        // 先切换状态，下一次 layout effect 再清除 inline height，衔接最后一帧的拖拽位置。
        onExpandedChange(true)
      }
      return
    }

    if (drag.currentHeight <= drag.minHeight + COLLAPSED_THRESHOLD_PX) {
      manualHeightRef.current = null
      if (expanded) onExpandedChange(false)
      else clearManualHeight(drag.sheet)
      return
    }

    // 未触顶就停留在松手的位置，后续可继续拖动或点击展开/收起。
    manualHeightRef.current = drag.currentHeight
    drag.sheet.classList.add('wiki-sheet-manual')
    if (expanded) {
      preserveOnNextExpandChangeRef.current = true
      onExpandedChange(false)
    }
  }

  const onClick = () => {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false
      return
    }
    // 点击时也不提前移除 inline 高度：等目标类名提交后再交给 CSS 完成平滑过渡。
    onExpandedChange(!expanded)
  }

  return (
    <button
      type="button"
      className="wiki-sheet-grabber"
      aria-label={expanded ? '拖动调整面板高度，点击收起' : '拖动调整面板高度，点击展开'}
      aria-expanded={expanded}
      title={expanded ? '拖动调整高度或点击收起' : '向上拖动扩大面板或点击展开'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={event => finish(event, false)}
      onPointerCancel={event => finish(event, true)}
      onClick={onClick}
    />
  )
}
