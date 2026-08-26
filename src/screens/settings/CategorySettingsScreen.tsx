import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, GripVertical, Plus, RotateCcw } from 'lucide-react'

import { SettingsHint, SettingsShell } from '../../components/SettingsShell'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { revealItems } from '../../lib/motion'
import type { CategoryId, NewsCategory } from '../../sources/categories'
import {
  FOLLOWS_ENABLED_SOURCES,
  describeSources,
  hasSourceOverride,
  isCategoryVisible,
  settingsCategories,
  type Preferences,
} from '../../sources/preferences'

interface Props {
  prefs: Preferences
  enabledCount: number
  /** 当前激活预设名，显示在顶栏说明 */
  presetLabel?: string
  /** 正在编辑内置预设时，「恢复默认」= 恢复该内置出厂 */
  restoreFactory?: boolean
  onReorder: (order: CategoryId[]) => void
  onToggleVisible: (categoryId: CategoryId) => void
  onToggleAutoRefresh?: (enabled: boolean) => void
  onEditSources: (categoryId: CategoryId) => void
  onEditCategory: (categoryId: CategoryId) => void
  onNewCategory: () => void
  onOpenChannels: () => void
  onResetLayout: (options?: { removeCustom?: boolean }) => void
  onBack: () => void
}

/** 静止持按多久进入拖拽；滚动与长按互斥，移动超过阈值则取消 */
const LONG_PRESS_MS = 380
/** 允许的手指抖动；超过则视为滚动意图，取消长按 */
const CANCEL_MOVE_PX = 16

interface DragState {
  id: CategoryId
  order: CategoryId[]
  originX: number
  originY: number
  currentX: number
  currentY: number
  moved: boolean
  pointerId: number
  source: HTMLElement
  sourceOpacity: string
  overlay: HTMLElement
  overlayFrame: number
  autoScrollFrame: number
  autoScrollSpeed: number
}

const REORDER_MS = 190
const REORDER_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

function captureCardRects(root: HTMLElement | null): Map<CategoryId, DOMRect> {
  const rects = new Map<CategoryId, DOMRect>()
  root?.querySelectorAll<HTMLElement>('[data-category-id]').forEach((card) => {
    const id = card.dataset.categoryId as CategoryId | undefined
    if (id) rects.set(id, card.getBoundingClientRect())
  })
  return rects
}

function reorderLocal(order: CategoryId[], fromId: CategoryId, toId: CategoryId): CategoryId[] {
  if (fromId === toId) return order
  const from = order.indexOf(fromId)
  const to = order.indexOf(toId)
  if (from < 0 || to < 0) return order
  const next = [...order]
  next.splice(from, 1)
  next.splice(to, 0, fromId)
  return next
}

export function CategorySettingsScreen({
  prefs,
  enabledCount,
  presetLabel,
  restoreFactory,
  onReorder,
  onToggleVisible,
  onToggleAutoRefresh,
  onEditSources,
  onEditCategory,
  onNewCategory,
  onOpenChannels,
  onResetLayout,
  onBack,
}: Props) {
  const reduced = useReducedMotion()
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLElement | null>(null)
  const pressTimer = useRef<number | null>(null)
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const pressCategoryId = useRef<CategoryId | null>(null)
  const lastPointerY = useRef(0)
  const manualScroll = useRef(false)
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)
  const baseOrderRef = useRef<CategoryId[]>([])
  const visibleIdsRef = useRef(new Set<CategoryId>())
  const pendingLayoutRects = useRef<Map<CategoryId, DOMRect> | null>(null)
  const layoutAnimations = useRef(new Map<CategoryId, Animation>())
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const onReorderRef = useRef(onReorder)
  onReorderRef.current = onReorder

  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [removeCustomOnReset, setRemoveCustomOnReset] = useState(false)

  const categories = settingsCategories(prefs)
  baseOrderRef.current = categories.map((category) => category.id)
  visibleIdsRef.current = new Set(
    categories
      .filter((category) => isCategoryVisible(category.id, prefs))
      .map((category) => category.id),
  )

  const [draftOrder, setDraftOrder] = useState<CategoryId[] | null>(null)
  const [draggingId, setDraggingId] = useState<CategoryId | null>(null)
  const [overId, setOverId] = useState<CategoryId | null>(null)
  const [holdingId, setHoldingId] = useState<CategoryId | null>(null)

  const displayIds = draftOrder ?? baseOrderRef.current
  const byId = new Map(categories.map((category) => [category.id, category]))
  const visibleCount = categories.filter((category) => isCategoryVisible(category.id, prefs)).length
  const gestureActive = Boolean(holdingId || draggingId)
  const layoutSignature = displayIds.join('|')

  useEffect(() => {
    revealItems(gridRef.current, reduced, '[data-reveal]')
  }, [reduced])

  useLayoutEffect(() => {
    const before = pendingLayoutRects.current
    pendingLayoutRects.current = null
    if (!before) return

    layoutAnimations.current.forEach((animation) => animation.cancel())
    layoutAnimations.current.clear()
    if (reduced) return

    gridRef.current
      ?.querySelectorAll<HTMLElement>('[data-category-id]')
      .forEach((card) => {
        const id = card.dataset.categoryId as CategoryId | undefined
        if (!id || id === draggingId) return
        const first = before.get(id)
        if (!first) return
        const last = card.getBoundingClientRect()
        const dx = first.left - last.left
        const dy = first.top - last.top
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return

        const animation = card.animate(
          [
            { transform: `translate3d(${dx}px, ${dy}px, 0)` },
            { transform: 'translate3d(0, 0, 0)' },
          ],
          { duration: REORDER_MS, easing: REORDER_EASING },
        )
        layoutAnimations.current.set(id, animation)
        animation.onfinish = () => layoutAnimations.current.delete(id)
        animation.oncancel = () => layoutAnimations.current.delete(id)
      })
  }, [draggingId, layoutSignature, reduced])

  useEffect(() => {
    const activeAnimations = layoutAnimations.current
    const restoreScroller = () => {
      if (scrollerRef.current) scrollerRef.current.style.overflowY = ''
    }

    const clearPressTimers = () => {
      if (pressTimer.current) {
        window.clearTimeout(pressTimer.current)
        pressTimer.current = null
      }
      pressOrigin.current = null
      pressCategoryId.current = null
      // 未进入拖拽时也要恢复滚动；否则 HOLD 后松手会永久锁死 overflow
      if (!dragRef.current) restoreScroller()
      setHoldingId(null)
    }

    const releaseOverlay = (drag: DragState, animateDrop: boolean) => {
      if (drag.overlayFrame) window.cancelAnimationFrame(drag.overlayFrame)
      if (drag.autoScrollFrame) window.cancelAnimationFrame(drag.autoScrollFrame)
      drag.overlayFrame = 0
      drag.autoScrollFrame = 0
      drag.autoScrollSpeed = 0

      const cleanup = () => {
        drag.overlay.remove()
        if (drag.source.isConnected) drag.source.style.opacity = drag.sourceOpacity
      }

      if (!animateDrop || reducedRef.current || !drag.source.isConnected) {
        cleanup()
        return
      }

      window.requestAnimationFrame(() => {
        if (!drag.source.isConnected || !drag.overlay.isConnected) {
          cleanup()
          return
        }

        const from = drag.overlay.getBoundingClientRect()
        const to = drag.source.getBoundingClientRect()
        drag.overlay.style.left = `${from.left}px`
        drag.overlay.style.top = `${from.top}px`
        drag.overlay.style.transform = 'translate3d(0, 0, 0)'
        drag.source.style.opacity = drag.sourceOpacity
        drag.source.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 150,
          easing: REORDER_EASING,
        })

        const animation = drag.overlay.animate(
          [
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
            {
              transform: `translate3d(${to.left - from.left}px, ${to.top - from.top}px, 0)`,
              opacity: 0.82,
            },
          ],
          { duration: 170, easing: REORDER_EASING, fill: 'forwards' },
        )
        animation.onfinish = cleanup
        animation.oncancel = cleanup
      })
    }

    const endGesture = (commit: boolean) => {
      const drag = dragRef.current
      dragRef.current = null
      const wasManual = manualScroll.current
      manualScroll.current = false
      clearPressTimers()
      restoreScroller()
      setDraggingId(null)
      setOverId(null)

      if (!drag) {
        setDraftOrder(null)
        if (wasManual) {
          suppressClick.current = true
          window.setTimeout(() => {
            suppressClick.current = false
          }, 120)
        }
        return
      }

      releaseOverlay(drag, commit)

      if (commit && drag.moved) {
        const targetOrder = drag.order
        setDraftOrder(null)
        suppressClick.current = true
        window.setTimeout(() => {
          suppressClick.current = false
        }, 180)
        onReorderRef.current(targetOrder)
      } else {
        setDraftOrder(null)
        suppressClick.current = true
        window.setTimeout(() => {
          suppressClick.current = false
        }, 120)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) {
        if (pressOrigin.current) {
          const dy = Math.abs(event.clientY - pressOrigin.current.y)
          const dx = Math.abs(event.clientX - pressOrigin.current.x)
          if (dy > CANCEL_MOVE_PX || dx > CANCEL_MOVE_PX) {
            clearPressTimers()
            manualScroll.current = true
          }
        }
        return
      }

      if (event.pointerId !== drag.pointerId) return
      event.preventDefault()

      drag.currentX = event.clientX
      drag.currentY = event.clientY
      lastPointerY.current = event.clientY

      const dx = drag.currentX - drag.originX
      const dy = drag.currentY - drag.originY
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true
      }

      const overlay = drag.overlay
      overlay.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.04)`

      const scroller = scrollerRef.current
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        const topEdge = rect.top + 50
        const bottomEdge = rect.bottom - 50

        if (event.clientY < topEdge) {
          const ratio = Math.min(1, (topEdge - event.clientY) / 50)
          drag.autoScrollSpeed = -Math.round(ratio * 12)
        } else if (event.clientY > bottomEdge) {
          const ratio = Math.min(1, (event.clientY - bottomEdge) / 50)
          drag.autoScrollSpeed = Math.round(ratio * 12)
        } else {
          drag.autoScrollSpeed = 0
        }
      }

      const elements = document.elementsFromPoint(event.clientX, event.clientY)
      let targetId: CategoryId | null = null
      for (const el of elements) {
        const card = el.closest<HTMLElement>('[data-category-id]')
        if (card && card.dataset.categoryId) {
          targetId = card.dataset.categoryId as CategoryId
          break
        }
      }

      if (targetId && targetId !== drag.id) {
        setOverId(targetId)
        const nextOrder = reorderLocal(drag.order, drag.id, targetId)
        if (nextOrder.join('|') !== drag.order.join('|')) {
          pendingLayoutRects.current = captureCardRects(gridRef.current)
          drag.order = nextOrder
          setDraftOrder(nextOrder)
        }
      } else {
        setOverId(null)
      }
    }

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
        endGesture(true)
      } else {
        clearPressTimers()
      }
    }

    const onPointerCancel = (event: PointerEvent) => {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
        endGesture(false)
      } else {
        clearPressTimers()
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      clearPressTimers()
      restoreScroller()
      activeAnimations.forEach((animation) => animation.cancel())
      activeAnimations.clear()
    }
  }, [reduced])

  const armLongPress = (
    event: React.PointerEvent<HTMLElement>,
    categoryId: CategoryId,
    immediate = false,
  ) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest('input, button[role="switch"]')) return

    const sourceEl = (event.currentTarget.closest('[data-category-id]') ??
      event.currentTarget) as HTMLElement | null
    if (!sourceEl) return

    const pointerId = event.pointerId
    const startX = event.clientX
    const startY = event.clientY
    lastPointerY.current = startY
    manualScroll.current = false

    const scroller = sourceEl.closest<HTMLElement>('[data-settings-scroll]')
    scrollerRef.current = scroller

    pressOrigin.current = { x: startX, y: startY }
    pressCategoryId.current = categoryId
    setHoldingId(categoryId)

    const startDrag = () => {
      pressTimer.current = null
      if (pressCategoryId.current !== categoryId) return

      // 仅在真正进入拖拽时锁定滚动，避免与页面滚动抢手势
      if (scroller) scroller.style.overflowY = 'hidden'

      const rect = sourceEl.getBoundingClientRect()
      const overlay = sourceEl.cloneNode(true) as HTMLElement
      overlay.removeAttribute('data-category-id')
      overlay.style.position = 'fixed'
      overlay.style.left = `${rect.left}px`
      overlay.style.top = `${rect.top}px`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
      overlay.style.zIndex = '9999'
      overlay.style.pointerEvents = 'none'
      overlay.style.margin = '0'
      overlay.style.boxShadow = 'var(--shadow-lift)'
      overlay.style.borderColor = 'var(--cinnabar)'
      overlay.style.willChange = 'transform'
      overlay.style.transition = 'none'
      overlay.style.transform = 'translate3d(0, 0, 0) scale(1.04)'
      document.body.appendChild(overlay)

      const prevOpacity = sourceEl.style.opacity
      sourceEl.style.opacity = '0.2'

      const dragState: DragState = {
        id: categoryId,
        order: [...(draftOrder ?? baseOrderRef.current)],
        originX: startX,
        originY: startY,
        currentX: startX,
        currentY: startY,
        moved: immediate,
        pointerId,
        source: sourceEl,
        sourceOpacity: prevOpacity,
        overlay,
        overlayFrame: 0,
        autoScrollFrame: 0,
        autoScrollSpeed: 0,
      }
      dragRef.current = dragState

      const runAutoScroll = () => {
        if (!dragRef.current || dragRef.current !== dragState) return
        if (dragState.autoScrollSpeed !== 0 && scrollerRef.current) {
          scrollerRef.current.scrollTop += dragState.autoScrollSpeed
        }
        dragState.autoScrollFrame = window.requestAnimationFrame(runAutoScroll)
      }
      dragState.autoScrollFrame = window.requestAnimationFrame(runAutoScroll)

      setDraggingId(categoryId)
      setHoldingId(null)

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(20)
        } catch {
          // ignore
        }
      }
    }

    if (immediate) {
      startDrag()
      return
    }

    pressTimer.current = window.setTimeout(startDrag, LONG_PRESS_MS)
  }

  const onCardActivate = (category: NewsCategory) => {
    if (suppressClick.current || dragRef.current || draggingId || holdingId) return
    if (category.isCustom) {
      onEditCategory(category.id)
      return
    }
    if (category.id === FOLLOWS_ENABLED_SOURCES) {
      onOpenChannels()
      return
    }
    onEditSources(category.id)
  }

  const toggleVisible = (categoryId: CategoryId) => {
    pendingLayoutRects.current = captureCardRects(gridRef.current)
    onToggleVisible(categoryId)
  }

  return (
    <SettingsShell
      title="分类与信源"
      caption={
        presetLabel
          ? `编辑「${presetLabel}」· ${visibleCount}/${categories.length}`
          : `${visibleCount}/${categories.length} 个分类显示中`
      }
      onBack={onBack}
      action={
        <button
          type="button"
          onClick={() => {
            setRemoveCustomOnReset(false)
            setShowResetConfirm(true)
          }}
          className="shrink-0 rounded-full border border-haze px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] text-paper-muted transition-colors hover:text-paper"
        >
          恢复默认
        </button>
      }
    >
      <div className="page-x pt-4">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-haze bg-ink-raised p-4 shadow-[var(--shadow-lift)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-display text-[15px] font-medium text-paper">切换分类时自动刷新</span>
              <span className="rounded-full bg-paper/5 px-2 py-0.5 font-mono text-[10px] text-paper-muted border border-haze/60">
                {prefs.autoRefreshOnCategorySwitch !== false ? '已开启' : '已关闭'}
              </span>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-paper-muted">
              关闭后只保留阅读位置，不自动联网。
            </p>
          </div>
          <ToggleSwitch
            checked={prefs.autoRefreshOnCategorySwitch !== false}
            label="切换分类时自动刷新"
            onChange={() =>
              onToggleAutoRefresh?.(prefs.autoRefreshOnCategorySwitch === false)
            }
          />
        </div>
      </div>

      <div
        ref={gridRef}
        className={`page-x grid grid-cols-2 gap-2.5 pt-4 sm:grid-cols-3 lg:grid-cols-4 ${
          gestureActive ? 'select-none' : ''
        }`}
      >
        {/* 新建分类快捷入口卡片 */}
        <button
          type="button"
          onClick={onNewCategory}
          className="group flex min-h-[108px] flex-col items-center justify-center rounded-2xl border border-dashed border-haze/90 bg-ink-raised/30 px-3 py-3 text-center transition-all duration-200 hover:border-cinnabar/60 hover:bg-cinnabar/5"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-haze/80 bg-paper/5 text-paper-muted transition-colors group-hover:border-cinnabar/60 group-hover:bg-cinnabar/20 group-hover:text-cinnabar-soft">
            <Plus size={16} strokeWidth={2.2} />
          </div>
          <span className="mt-2 font-display text-[15px] font-medium text-paper group-hover:text-cinnabar-soft">
            新建分类
          </span>
          <span className="mt-0.5 font-mono text-[9.5px] text-paper-faint">
            自选信源组合
          </span>
        </button>

        {displayIds.map((id, index) => {
          const category = byId.get(id)
          if (!category) return null

          const visible = isCategoryVisible(category.id, prefs)
          const followsChannels = category.id === FOLLOWS_ENABLED_SOURCES
          const summary = followsChannels
            ? `跟随频道 · ${enabledCount} 源`
            : describeSources(category.sourceIds ?? [], prefs.customSources)
          const customized = hasSourceOverride(category.id, prefs)
          const isDragging = draggingId === category.id
          const isHolding = holdingId === category.id
          const isOver = overId === category.id && draggingId !== category.id

          return (
            <article
              key={category.id}
              data-reveal
              data-category-id={category.id}
              onPointerDown={(event) => armLongPress(event, category.id)}
              onClick={() => onCardActivate(category)}
              className={`relative flex min-h-[108px] flex-col rounded-2xl border px-3 py-3 transition-[transform,box-shadow,border-color,filter] duration-200 ${
                isDragging
                  ? 'z-10 scale-[1.03] border-cinnabar/70 bg-ink-raised shadow-[var(--shadow-lift)]'
                  : isHolding
                    ? 'border-cinnabar/40 bg-ink-raised'
                    : isOver
                      ? 'border-cinnabar/45 bg-cinnabar/10'
                      : 'border-haze bg-ink-raised/55'
              } ${visible ? '' : '[filter:var(--dim-hidden)]'} ${draggingId && !isDragging ? 'opacity-80' : ''}`}
              style={{
                // pan-y：卡片区域可正常纵向滚动；长按静止才进入拖拽
                touchAction: isDragging ? 'none' : 'pan-y',
                WebkitUserSelect: 'none',
                userSelect: 'none',
                WebkitTouchCallout: 'none',
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  aria-label={`拖动排序 ${category.label}`}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    armLongPress(event, category.id, true)
                  }}
                  onClick={(event) => event.preventDefault()}
                  className="-ml-1 flex min-h-8 min-w-8 items-center gap-1 rounded-md px-1 py-0.5 font-mono text-[10px] tracking-[0.14em] text-paper-faint"
                  style={{ touchAction: 'none' }}
                >
                  <GripVertical size={12} strokeWidth={1.6} className="text-paper-faint/70" />
                  {String(index + 1).padStart(2, '0')}
                </button>

                <span
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ToggleSwitch
                    checked={visible}
                    label={`${visible ? '隐藏' : '显示'} ${category.label}`}
                    onChange={() => toggleVisible(category.id)}
                  />
                </span>
              </div>

              <div className={`mt-2.5 min-w-0 flex-1 ${visible ? '' : 'opacity-60'}`}>
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate font-display text-[17px] leading-none text-paper">
                    {category.label}
                  </h2>
                  {category.isCustom ? (
                    <span className="shrink-0 rounded-full bg-cinnabar/25 px-1.5 py-px font-mono text-[9px] font-medium text-cinnabar-soft">
                      自建
                    </span>
                  ) : customized ? (
                    <span className="shrink-0 rounded-full bg-cinnabar/20 px-1.5 py-px font-mono text-[9px] text-cinnabar-soft">
                      自定义
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 line-clamp-2 font-mono text-[10px] leading-relaxed text-paper-faint">
                  {summary}
                </p>
              </div>

              {category.isCustom ? (
                <span className="mt-2 inline-flex items-center gap-0.5 self-end font-mono text-[9px] tracking-[0.12em] text-cinnabar-soft">
                  编辑
                  <ChevronRight size={11} strokeWidth={1.6} />
                </span>
              ) : !followsChannels ? (
                <span className="mt-2 inline-flex items-center gap-0.5 self-end font-mono text-[9px] tracking-[0.12em] text-paper-faint">
                  信源
                  <ChevronRight size={11} strokeWidth={1.6} />
                </span>
              ) : (
                <span className="mt-2 inline-flex items-center gap-0.5 self-end font-mono text-[9px] tracking-[0.12em] text-paper-faint">
                  频道启用
                  <ChevronRight size={11} strokeWidth={1.6} />
                </span>
              )}
            </article>
          )
        })}
      </div>

      <SettingsHint>
        长按排序，开关控制显隐。「综合」跟频道启用，其它分类单独选源。
      </SettingsHint>

      {/* 恢复默认确认弹窗 */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-haze bg-ink-raised p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-cinnabar-soft">
              <RotateCcw size={18} strokeWidth={2} />
              <h3 className="font-display text-[17px] font-medium text-paper">
                {restoreFactory ? '恢复出厂配置？' : '恢复分类默认配置？'}
              </h3>
            </div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-paper-muted">
              {restoreFactory
                ? `将「${presetLabel ?? '当前预设'}」恢复为内置出厂的分类顺序、显隐与信源。当前改动会丢掉。`
                : '将重置所有分类的排列顺序、显隐状态以及内置推荐信源为出厂预设。'}
            </p>

            {!restoreFactory && Boolean(prefs.customCategories?.length) && (
              <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-xl border border-haze/80 bg-ink/60 p-2.5">
                <input
                  type="checkbox"
                  checked={removeCustomOnReset}
                  onChange={(e) => setRemoveCustomOnReset(e.target.checked)}
                  className="h-4 w-4 rounded accent-cinnabar"
                />
                <span className="text-[12px] text-paper-muted">
                  同时清空我新建的 {prefs.customCategories?.length} 个自定义分类
                </span>
              </label>
            )}

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="rounded-full border border-haze bg-transparent px-4 py-1.5 font-mono text-[11px] text-paper-muted transition-colors hover:text-paper"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowResetConfirm(false)
                  onResetLayout({ removeCustom: removeCustomOnReset })
                }}
                className="rounded-full border border-cinnabar/70 bg-cinnabar/15 px-4 py-1.5 font-mono text-[11px] font-medium text-cinnabar-soft transition-colors hover:bg-cinnabar/25"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </SettingsShell>
  )
}
