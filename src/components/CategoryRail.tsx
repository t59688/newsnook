import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CircleMinus, PencilLine } from 'lucide-react'

import { useLongPressAction } from '../hooks/useLongPressAction'
import type { Point } from '../lib/contextActions'
import {
  FAVORITES_CATEGORY_ID,
  isReservedCategoryLabel,
  RECOMMEND_CATEGORY_ID,
  type CategoryId,
  type NewsCategory,
} from '../sources/categories'
import { PromptDialog } from './ConfirmDialog'
import { ContextActionMenu, type ContextActionItem } from './ContextActionMenu'

interface Props {
  categories: NewsCategory[]
  activeId: CategoryId
  onChange: (id: CategoryId) => void
  dragX?: number
  containerWidth?: number
  transitionMs?: number
  reduced?: boolean
  onRemoveCategory?: (id: CategoryId) => void
  onRenameCategory?: (id: CategoryId, name: string) => void
  onMoveCategory?: (id: CategoryId, direction: -1 | 1) => void
}

const BASE_INDICATOR_WIDTH = 14 // 14px 对应原来的 w-3.5

/**
 * 墨砚分类轨道：支持跟手横滑实时联动、丝滑水墨拉伸与自动居中对齐。
 */
export function CategoryRail({
  categories,
  activeId,
  onChange,
  dragX = 0,
  containerWidth = 0,
  transitionMs = 0,
  reduced = false,
  onRemoveCategory,
  onRenameCategory,
  onMoveCategory,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<CategoryId, HTMLButtonElement>>(new Map())
  const lastActiveIdRef = useRef(activeId)
  const tabMetricsRef = useRef<Map<CategoryId, number>>(new Map())
  const scrollerMetricsRef = useRef<{ scrollWidth: number; clientWidth: number }>({
    scrollWidth: 0,
    clientWidth: 0,
  })
  const [, setTick] = useState(0)
  const [actionMenu, setActionMenu] = useState<{ categoryId: CategoryId; anchor: Point } | null>(
    null,
  )
  const [renameCategoryId, setRenameCategoryId] = useState<CategoryId | null>(null)
  const longPress = useLongPressAction<CategoryId>((categoryId, anchor) => {
    setActionMenu({ categoryId, anchor })
  })

  const isDragging = dragX !== 0
  const activeIndex = categories.findIndex((category) => category.id === activeId)
  const actionCategory = actionMenu
    ? categories.find((category) => category.id === actionMenu.categoryId)
    : undefined
  const renameCategory = renameCategoryId
    ? categories.find((category) => category.id === renameCategoryId)
    : undefined
  const isDynamicCategory = (id: CategoryId) =>
    id === FAVORITES_CATEGORY_ID || id === RECOMMEND_CATEGORY_ID
  const actionIndex = actionCategory ? categories.findIndex((category) => category.id === actionCategory.id) : -1
  const actionItems: ContextActionItem[] = actionCategory
    ? [
        ...(onMoveCategory && actionIndex > 0 ? [{
          id: 'move-left', label: '向前移动', icon: ArrowLeft,
          onSelect: () => onMoveCategory(actionCategory.id, -1),
        }] : []),
        ...(onMoveCategory && actionIndex >= 0 && actionIndex < categories.length - 1 ? [{
          id: 'move-right', label: '向后移动', icon: ArrowRight,
          onSelect: () => onMoveCategory(actionCategory.id, 1),
        }] : []),
        ...(!isDynamicCategory(actionCategory.id) && onRenameCategory
          ? [
              {
                id: 'rename',
                label: '重命名分类',
                icon: PencilLine,
                tone: 'accent' as const,
                onSelect: () => setRenameCategoryId(actionCategory.id),
              },
            ]
          : []),
        ...(!isDynamicCategory(actionCategory.id) && onRemoveCategory
          ? [
              {
                id: 'remove',
                label: '从当前预设移除',
                icon: CircleMinus,
                tone: 'danger' as const,
                onSelect: () => onRemoveCategory(actionCategory.id),
              },
            ]
          : []),
      ]
    : []

  // 尺寸或分类变化时统一测量各 Tab 几何位置并缓存，避免拖拽渲染时高频访问 DOM 引发布局回流
  const measureMetrics = () => {
    const scroller = scrollerRef.current
    if (scroller) {
      scrollerMetricsRef.current = {
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
      }
    }
    const map = new Map<CategoryId, number>()
    tabRefs.current.forEach((el, id) => {
      map.set(id, el.offsetLeft + el.offsetWidth / 2)
    })
    tabMetricsRef.current = map
  }

  useLayoutEffect(() => {
    measureMetrics()
    setTick((t) => t + 1)
  }, [categories])

  useEffect(() => {
    const handleResize = () => {
      measureMetrics()
      setTick((t) => t + 1)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // 获取某个 tab 的几何中心（优先读缓存，0 DOM Read）
  const getTabCenter = (id: CategoryId) => {
    const cached = tabMetricsRef.current.get(id)
    if (typeof cached === 'number' && cached > 0) return cached
    const el = tabRefs.current.get(id)
    if (!el) return 0
    const center = el.offsetLeft + el.offsetWidth / 2
    tabMetricsRef.current.set(id, center)
    return center
  }

  // 算出滑动进度与指示器位置
  const width =
    containerWidth > 0
      ? containerWidth
      : scrollerMetricsRef.current.clientWidth ||
        scrollerRef.current?.clientWidth ||
        (typeof window !== 'undefined' ? window.innerWidth : 360)

  const progress = width > 0 ? -dragX / width : 0

  let currentCenter = 0
  let stretch = 0
  let targetIndex = activeIndex
  let ratio = 0 // 0..1 目标进度

  if (activeIndex >= 0) {
    const baseCenter = getTabCenter(activeId)
    currentCenter = baseCenter

    if (progress > 0) {
      // 往左滑列表 -> 看下一个分类
      targetIndex = Math.min(activeIndex + 1, categories.length - 1)
      ratio = Math.min(1, Math.max(0, progress))
      if (targetIndex !== activeIndex) {
        const nextCenter = getTabCenter(categories[targetIndex].id)
        if (nextCenter > 0 && baseCenter > 0) {
          currentCenter = baseCenter + (nextCenter - baseCenter) * ratio
          stretch = Math.sin(ratio * Math.PI) * 5
        }
      } else if (baseCenter > 0) {
        // 右端橡皮筋阻尼轻推
        currentCenter = baseCenter - progress * 10
      }
    } else if (progress < 0) {
      // 往右滑列表 -> 看上一个分类
      targetIndex = Math.max(activeIndex - 1, 0)
      ratio = Math.min(1, Math.max(0, -progress))
      if (targetIndex !== activeIndex) {
        const prevCenter = getTabCenter(categories[targetIndex].id)
        if (prevCenter > 0 && baseCenter > 0) {
          currentCenter = baseCenter + (prevCenter - baseCenter) * ratio
          stretch = Math.sin(ratio * Math.PI) * 5
        }
      } else if (baseCenter > 0) {
        // 左端橡皮筋阻尼轻推
        currentCenter = baseCenter - progress * 10
      }
    }
  }

  const indicatorWidth = BASE_INDICATOR_WIDTH + stretch
  const indicatorLeft = currentCenter > 0 ? currentCenter - indicatorWidth / 2 : 0

  // 指示器过渡动画规则：
  // 1. 无障碍减弱动画：none
  // 2. 惯性/提交动画阶段 (transitionMs > 0)：与列表切换时长、曲线严格一致
  // 3. 手指拖拽中 (isDragging)：即时跟手，无延迟 (none)
  // 4. 用户直接点击 Tab：平滑平移过渡
  const indicatorTransition = reduced
    ? 'none'
    : transitionMs > 0
      ? `transform ${transitionMs}ms var(--ease-ink), width ${transitionMs}ms var(--ease-ink)`
      : isDragging
        ? 'none'
        : 'transform 260ms var(--ease-ink), width 260ms var(--ease-ink)'

  // 轨道滚动居中：滑动中同步跟手平移轨道，松手或点击时平滑对齐
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || currentCenter <= 0) return

    const { scrollWidth, clientWidth } = scrollerMetricsRef.current.clientWidth > 0
      ? scrollerMetricsRef.current
      : { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }

    const maxScroll = Math.max(0, scrollWidth - clientWidth)
    const targetScroll = Math.max(0, Math.min(maxScroll, currentCenter - clientWidth / 2))

    if (isDragging) {
      scroller.scrollLeft = targetScroll
    } else if (transitionMs > 0) {
      scroller.scrollTo({ left: targetScroll, behavior: 'smooth' })
    } else if (lastActiveIdRef.current !== activeId) {
      // 点击切换分类时平滑居中
      lastActiveIdRef.current = activeId
      scroller.scrollTo({ left: targetScroll, behavior: 'smooth' })
    }
  }, [activeId, currentCenter, isDragging, transitionMs])

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        className="horizontal-scroll-rail scroll-hidden mask-fade-x relative flex gap-0.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-10"
        role="tablist"
        aria-label="新闻分类"
      >
        {categories.map((category, index) => {
          const isActiveTab = category.id === activeId
          const canManage =
            (!isDynamicCategory(category.id) && Boolean(onRenameCategory)) ||
            (!isDynamicCategory(category.id) && Boolean(onRemoveCategory)) ||
            Boolean(onMoveCategory)
          // 计算字体的渐变权重 (0 ~ 1)
          let weight = 0
          if (isDragging || transitionMs > 0) {
            if (index === activeIndex) weight = 1 - ratio
            else if (index === targetIndex) weight = ratio
          } else if (isActiveTab) {
            weight = 1
          }

          const opacity = 0.68 + 0.32 * weight
          const fontTransition = reduced
            ? 'none'
            : isDragging
              ? 'none'
              : transitionMs > 0
                ? `opacity ${transitionMs}ms var(--ease-ink)`
                : 'opacity 260ms var(--ease-ink)'

          return (
            <button
              key={category.id}
              ref={(el) => {
                if (el) tabRefs.current.set(category.id, el)
                else tabRefs.current.delete(category.id)
              }}
              type="button"
              role="tab"
              aria-selected={weight >= 0.5}
              aria-haspopup={canManage ? 'menu' : undefined}
              aria-label={`${category.label}${canManage ? '，长按管理' : ''}`}
              onClick={() => {
                if (longPress.consumeClick(category.id)) return
                onChange(category.id)
              }}
              onPointerDown={canManage ? (event) => longPress.start(category.id, event) : undefined}
              onPointerMove={canManage ? longPress.move : undefined}
              onPointerUp={canManage ? longPress.cancel : undefined}
              onPointerCancel={canManage ? longPress.cancel : undefined}
              onPointerLeave={canManage ? longPress.cancel : undefined}
              onContextMenu={
                canManage
                  ? (event) => {
                      event.preventDefault()
                      setActionMenu({
                        categoryId: category.id,
                        anchor: { x: event.clientX, y: event.clientY },
                      })
                    }
                  : undefined
              }
              style={{
                opacity,
                transition: fontTransition,
                WebkitTouchCallout: 'none',
                touchAction: 'pan-x',
              }}
              className="custom-long-press-target relative shrink-0 px-3 py-1.5 text-paper hover:opacity-90"
            >
              <span className={`block whitespace-nowrap font-display text-[14.5px] leading-none tracking-wide ${weight >= 0.5 ? 'font-medium' : 'font-normal'}`}>
                {category.label}
              </span>
              {/* 占位间距，保持高度与垂直居中一致 */}
              <span className="mx-auto mt-1 block h-px w-3.5 opacity-0" aria-hidden />
            </button>
          )
        })}

        {/* 唯一动态浮动指示器 */}
        {currentCenter > 0 && (
          <span
            className="pointer-events-none absolute bottom-1 left-0 h-[2px] rounded-full bg-cinnabar shadow-[0_1px_4px_rgba(196,92,74,0.35)] will-change-transform"
            style={{
              width: `${indicatorWidth}px`,
              transform: `translate3d(${indicatorLeft}px, 0, 0)`,
              transition: indicatorTransition,
            }}
            aria-hidden
          />
        )}
      </div>

      <ContextActionMenu
        open={Boolean(actionCategory && actionMenu && actionItems.length)}
        anchor={actionMenu?.anchor ?? { x: 0, y: 0 }}
        title={actionCategory?.label ?? ''}
        caption={actionCategory?.isCustom ? '当前预设 · 自建分类' : '当前预设 · 分类管理'}
        actions={actionItems}
        onClose={() => setActionMenu(null)}
      />

      <PromptDialog
        open={Boolean(renameCategory && onRenameCategory)}
        title="重命名分类"
        message="名称会同步显示在首页分类栏；“收藏”和“推荐”为系统保留名称。"
        label="分类名称"
        defaultValue={renameCategory?.label ?? ''}
        confirmLabel="保存名称"
        onConfirm={(value) => {
          const name = value.trim()
          if (!renameCategory || !onRenameCategory || isReservedCategoryLabel(name)) return
          onRenameCategory(renameCategory.id, name)
          setRenameCategoryId(null)
        }}
        onCancel={() => setRenameCategoryId(null)}
      />
    </div>
  )
}

