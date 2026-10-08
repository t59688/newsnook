import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { EyeOff, MoreHorizontal, RefreshCw, UserMinus } from 'lucide-react'

import { ContextActionMenu, type ContextActionItem } from '../../../components/ContextActionMenu'
import { PullIndicator } from '../../../components/PullIndicator'
import { useLongPressAction } from '../../../hooks/useLongPressAction'
import { usePullToRefresh } from '../../../hooks/usePullToRefresh'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useSwipeCategory, type SwipeDirection } from '../../../hooks/useSwipeCategory'
import type { Point } from '../../../lib/contextActions'
import type { ZhihuApiError } from '../api/errors'
import type { ZhihuFeedPreviewState } from '../feed/useZhihuFeed'
import type { ZhihuContentSummary, ZhihuFeedMode } from '../types'
import {
  ZhihuContentRow,
  ZhihuEmptyState,
  ZhihuErrorBanner,
  ZhihuLoadingState,
} from './ZhihuUi'
import { formatZhihuHotMetric } from './ZhihuUiUtils'

interface Props {
  mode: ZhihuFeedMode
  items: ZhihuContentSummary[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  error: ZhihuApiError | null
  previews: Partial<Record<ZhihuFeedMode, ZhihuFeedPreviewState>>
  authenticated: boolean
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  onModeChange: (mode: ZhihuFeedMode) => void
  onPrefetchMode: (mode: ZhihuFeedMode) => void
  onRefresh: () => Promise<void> | void
  onLoadMore: () => void
  onOpen: (item: ZhihuContentSummary) => void
  onImpression: (item: ZhihuContentSummary) => void
  onRecommendationFeedback: (
    item: ZhihuContentSummary,
    action: 'not-interested' | 'less-author',
  ) => void
  homeRefreshRef?: MutableRefObject<(() => void) | null>
}

function errorMessage(error: ZhihuApiError): string {
  switch (error.code) {
    case 'verification-required': return '知乎要求进行安全验证，请稍后再试或在知乎完成验证。'
    case 'rate-limited': return '请求过于频繁，知乎暂时限流。'
    case 'unsupported': return error.message
    case 'invalid-response': return '知乎返回的数据结构发生了变化，当前内容未被错误地当成空列表。'
    default: return `读取失败：${error.message}`
  }
}

function ZhihuFeedPeek({
  items,
  loading,
  mode,
}: {
  items: ZhihuContentSummary[]
  loading: boolean
  mode: ZhihuFeedMode
}) {
  if (items.length === 0) {
    return (
      <div className="space-y-2.5 px-3 sm:px-5" aria-hidden>
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-2xl border border-haze/45 bg-ink-raised/30 p-3.5 sm:p-4"
          >
            <div className="flex gap-3.5">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="h-5 w-[86%] rounded-md bg-haze/50" />
                <div className="h-3.5 w-full rounded bg-haze/35" />
                <div className="h-3.5 w-[74%] rounded bg-haze/30" />
                <div className="h-3 w-16 rounded bg-haze/25" />
              </div>
              {index % 2 === 0 && <div className="aspect-[4/3] w-[28%] max-w-24 shrink-0 rounded-xl bg-haze/40 sm:max-w-32" />}
            </div>
          </div>
        ))}
        {loading && (
          <div className="py-2 text-center font-mono text-[9.5px] tracking-[0.08em] text-paper-faint/55">
            {mode === 'following' ? '正在准备关注动态' : '正在准备内容'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2.5 px-3 sm:px-5" aria-hidden>
      {items.slice(0, 60).map((item, index) => (
        <ZhihuContentRow
          key={`${mode}:${item.ref.kind}:${item.ref.id}`}
          item={item}
          onOpen={() => undefined}
          compact
          hotRank={mode === 'hot' ? index + 1 : undefined}
          hotMetric={mode === 'hot' ? formatZhihuHotMetric(item.recommendationReason, item.voteupCount) ?? undefined : undefined}
          showReason={false}
        />
      ))}
    </div>
  )
}

export function ZhihuFeedScreen({
  mode,
  items,
  loading,
  loadingMore,
  hasMore,
  error,
  previews,
  authenticated,
  scrollContainerRef,
  onModeChange,
  onPrefetchMode,
  onRefresh,
  onLoadMore,
  onOpen,
  onImpression,
  onRecommendationFeedback,
  homeRefreshRef,
}: Props) {
  const pullSurfaceRef = useRef<HTMLDivElement>(null)
  const swipeTrackRef = useRef<HTMLDivElement>(null)
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null)
  const loadRequestKeyRef = useRef('')
  const impressionTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const impressedKeysRef = useRef(new Set<string>())
  const [actionMenu, setActionMenu] = useState<{ key: string; anchor: Point } | null>(null)
  const reduced = useReducedMotion()
  const longPress = useLongPressAction<string>((key, anchor) => {
    if (mode === 'recommended') setActionMenu({ key, anchor })
  })
  const actionItem = actionMenu
    ? items.find((item) => `${item.ref.kind}:${item.ref.id}` === actionMenu.key)
    : undefined
  const applyRecommendationFeedback = (
    item: ZhihuContentSummary,
    action: 'not-interested' | 'less-author',
  ) => {
    onRecommendationFeedback(item, action)
  }
  const actionItems: ContextActionItem[] = actionItem
    ? [
        {
          id: 'not-interested',
          label: '不感兴趣',
          icon: EyeOff,
          tone: 'accent',
          onSelect: () => applyRecommendationFeedback(actionItem, 'not-interested'),
        },
        ...((actionItem.author?.token || actionItem.author?.id)
          ? [{
              id: 'less-author',
              label: '少推荐此作者',
              icon: UserMinus,
              onSelect: () => applyRecommendationFeedback(actionItem, 'less-author'),
            } satisfies ContextActionItem]
          : []),
      ]
    : []
  const { indicatorRef, phase, cancel: cancelPull, trigger: triggerPullRefresh } = usePullToRefresh({
    onRefresh,
    containerRef: scrollContainerRef,
    surfaceRef: pullSurfaceRef,
  })

  useEffect(() => {
    if (!homeRefreshRef) return
    homeRefreshRef.current = triggerPullRefresh
    return () => {
      if (homeRefreshRef.current === triggerPullRefresh) homeRefreshRef.current = null
    }
  }, [homeRefreshRef, triggerPullRefresh])

  useEffect(() => {
    loadRequestKeyRef.current = ''
    impressedKeysRef.current.clear()
  }, [mode])

  // 与新闻首页保持一致：sentinel 一进入底部预取区就续载。
  useEffect(() => {
    const root = scrollContainerRef.current
    const target = loadMoreSentinelRef.current
    if (!root || !target || !hasMore || loading) return

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || loadingMore) return
      const last = items.at(-1)
      const requestKey = `${mode}:${last?.ref.kind ?? 'none'}:${last?.ref.id ?? 'none'}`
      if (loadRequestKeyRef.current === requestKey) return
      loadRequestKeyRef.current = requestKey
      onLoadMore()
    }, { root, rootMargin: '240px 0px', threshold: 0.01 })

    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, items, loading, loadingMore, mode, onLoadMore, scrollContainerRef])

  // 只有卡片在真实滚动容器中至少 60% 可见并持续 850ms 才记一次曝光。
  // 左右滑动的邻页预览没有 data 标记，因此不会污染推荐画像。
  useEffect(() => {
    const root = scrollContainerRef.current
    const surface = pullSurfaceRef.current
    if (!root || !surface || items.length === 0) return

    const byKey = new Map(items.map((item) => [`${item.ref.kind}:${item.ref.id}`, item]))
    const timers = impressionTimersRef.current
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement
        const key = element.dataset.zhihuFeedKey
        if (!key) continue
        const timer = timers.get(key)

        if (!entry.isIntersecting || entry.intersectionRatio < 0.6) {
          if (timer) {
            clearTimeout(timer)
            timers.delete(key)
          }
          continue
        }

        if (impressedKeysRef.current.has(key) || timer) continue
        const item = byKey.get(key)
        if (!item) continue
        const nextTimer = setTimeout(() => {
          timers.delete(key)
          if (impressedKeysRef.current.has(key)) return
          impressedKeysRef.current.add(key)
          onImpression(item)
        }, 850)
        timers.set(key, nextTimer)
      }
    }, { root, threshold: [0, 0.6, 1] })

    const nodes = surface.querySelectorAll<HTMLElement>('[data-zhihu-feed-key]')
    nodes.forEach((node) => observer.observe(node))
    return () => {
      observer.disconnect()
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [items, mode, onImpression, scrollContainerRef])

  const modes = useMemo<Array<{ id: ZhihuFeedMode; label: string; enabled: boolean; hint?: string }>>(() => [
    { id: 'recommended', label: '推荐', enabled: true },
    { id: 'hot', label: '热榜', enabled: true },
    { id: 'following', label: '关注', enabled: authenticated, hint: authenticated ? undefined : '登录知乎后可读关注动态' },
  ], [authenticated])

  const activeIndex = Math.max(0, modes.findIndex((item) => item.id === mode))
  const enabledModes = modes.filter((item) => item.enabled)
  const activeEnabledIndex = Math.max(0, enabledModes.findIndex((item) => item.id === mode))
  const prevMode = enabledModes[activeEnabledIndex - 1]
  const nextMode = enabledModes[activeEnabledIndex + 1]

  const neighbourOf = (direction: SwipeDirection) => direction === 'next' ? nextMode : prevMode

  // 当前页稳定后后台预热左右相邻页。公开流优先命中 localStorage，
  // 关注流只保存在当前账号的内存快照里，避免跨账号泄漏。
  useEffect(() => {
    if (loading) return
    const targets = [prevMode?.id, nextMode?.id].filter((value): value is ZhihuFeedMode => Boolean(value))
    if (targets.length === 0) return

    const timer = window.setTimeout(() => {
      targets.forEach(onPrefetchMode)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [loading, mode, nextMode?.id, onPrefetchMode, prevMode?.id])

  const { dragX, transitionMs, containerWidth } = useSwipeCategory({
    containerRef: swipeTrackRef,
    disabled: enabledModes.length < 2,
    reduced,
    canGo: (direction) => Boolean(neighbourOf(direction)),
    onCommit: (direction) => {
      const target = neighbourOf(direction)
      if (target) onModeChange(target.id)
    },
    onHorizontalLock: cancelPull,
  })

  const swipeTransition = transitionMs > 0 ? `transform ${transitionMs}ms var(--ease-ink)` : 'none'
  const indicatorDragPct = containerWidth > 0 ? (-dragX / containerWidth) * 100 : 0
  const dragProgress = containerWidth > 0 ? Math.min(1, Math.abs(dragX) / containerWidth) : 0

  const prevPreview = prevMode ? previews[prevMode.id] : undefined
  const nextPreview = nextMode ? previews[nextMode.id] : undefined

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      <PullIndicator indicatorRef={indicatorRef} phase={phase} />

      <div className="sticky top-0 z-30 border-b border-paper/[0.06] bg-ink/90 px-3 backdrop-blur-2xl sm:px-5">
        <div className="flex items-center gap-2">
          <div className="relative grid min-w-0 flex-1 grid-cols-3">
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 flex h-[3px] w-1/3 justify-center"
              style={{
                transform: `translate3d(calc(${activeIndex * 100}% + ${indicatorDragPct}%), 0, 0)`,
                transition: swipeTransition,
              }}
            >
              <span className="h-[3px] w-6 rounded-full bg-[#0066FF] shadow-[0_2px_8px_rgba(0,102,255,0.45)]" />
            </span>
            {modes.map((item) => {
              const active = mode === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.enabled}
                  title={item.hint}
                  aria-pressed={active}
                  onClick={() => item.enabled && onModeChange(item.id)}
                  className={`relative z-10 flex min-h-12 items-center justify-center gap-1.5 px-2 transition-all duration-150 active:scale-95 ${
                    active
                      ? 'font-bold text-paper text-[15.5px]'
                      : item.enabled
                        ? 'font-medium text-paper-muted/75 text-[14px] hover:text-paper'
                        : 'cursor-not-allowed text-paper-faint/30 text-[13.5px]'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.id === 'hot' && (
                    <span className="size-1.5 rounded-full bg-[#FF3838] ring-2 ring-[#FF3838]/25 shadow-[0_0_6px_rgba(255,56,56,0.6)]" title="实时热榜" aria-hidden />
                  )}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="刷新信息流"
            title="刷新"
            className="hidden size-9 shrink-0 items-center justify-center rounded-xl text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper active:scale-90 disabled:opacity-35 sm:flex"
          >
            <RefreshCw size={15} strokeWidth={1.8} className={loading ? 'animate-spin text-[#0066FF]' : ''} />
          </button>
        </div>
      </div>

      <div ref={pullSurfaceRef} className="pb-28 pt-3">
        <div ref={swipeTrackRef} className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
          {dragX > 0 && prevMode && (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px - 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
                opacity: 0.86 + dragProgress * 0.14,
              }}
              aria-hidden
            >
              <ZhihuFeedPeek
                items={prevPreview?.items ?? []}
                loading={prevPreview?.loading ?? true}
                mode={prevMode.id}
              />
            </div>
          )}

          <div
            className="relative z-10"
            style={{
              transform: dragX === 0 && transitionMs === 0 ? undefined : `translate3d(${dragX}px, 0, 0)`,
              transition: swipeTransition,
              backfaceVisibility: dragX === 0 && transitionMs === 0 ? undefined : 'hidden',
              boxShadow: dragX === 0 ? undefined : '0 0 32px rgb(0 0 0 / 0.08)',
            }}
          >
            {error && <div className="mb-3 px-4 sm:px-6"><ZhihuErrorBanner>{errorMessage(error)}</ZhihuErrorBanner></div>}

            {loading && items.length === 0 ? (
              <div className="px-4 sm:px-6"><ZhihuLoadingState label="正在读取知乎…" /></div>
            ) : items.length === 0 && !error ? (
              <div className="px-4 sm:px-6">
                <ZhihuEmptyState
                  title="没有可显示的内容"
                  description={mode === 'following' ? '关注动态需要登录知乎后读取。' : '稍后下拉刷新再试。'}
                />
              </div>
            ) : (
              <div className="space-y-2.5 px-3 sm:px-5">
                {items.map((item, index) => {
                  const key = `${item.ref.kind}:${item.ref.id}`
                  const feedbackEnabled = mode === 'recommended'
                  const hotRank = mode === 'hot' ? index + 1 : undefined
                  const hotMetric = mode === 'hot'
                    ? formatZhihuHotMetric(item.recommendationReason, item.voteupCount) ?? undefined
                    : undefined
                  return (
                    <div
                      key={key}
                      data-zhihu-feed-key={key}
                      className="group/zhihu-card relative"
                      onPointerDown={feedbackEnabled ? (event) => longPress.start(key, event) : undefined}
                      onPointerMove={feedbackEnabled ? longPress.move : undefined}
                      onPointerUp={feedbackEnabled ? longPress.cancel : undefined}
                      onPointerCancel={feedbackEnabled ? longPress.cancel : undefined}
                      onContextMenu={feedbackEnabled ? (event) => {
                        event.preventDefault()
                        setActionMenu({ key, anchor: { x: event.clientX, y: event.clientY } })
                      } : undefined}
                    >
                      <ZhihuContentRow
                        item={item}
                        onOpen={(next) => {
                          if (feedbackEnabled && longPress.consumeClick(key)) return
                          onOpen(next)
                        }}
                        compact
                        hotRank={hotRank}
                        hotMetric={hotMetric}
                        showReason={false}
                      />
                      {feedbackEnabled && (
                        <button
                          type="button"
                          aria-label="调整推荐"
                          title="调整推荐"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            const rect = event.currentTarget.getBoundingClientRect()
                            const x = event.clientX || rect.left + rect.width / 2
                            const y = event.clientY || rect.top + rect.height / 2
                            setActionMenu({ key, anchor: { x, y } })
                          }}
                          className="absolute bottom-2.5 right-2.5 z-10 hidden size-7 items-center justify-center rounded-full border border-haze/65 bg-ink/82 text-paper-faint opacity-0 shadow-sm backdrop-blur-sm transition-[opacity,color,background-color] hover:bg-ink-raised hover:text-paper focus-visible:opacity-100 group-hover/zhihu-card:opacity-100 sm:flex"
                        >
                          <MoreHorizontal size={14} strokeWidth={1.7} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {items.length > 0 && hasMore && (
              <div ref={loadMoreSentinelRef} className="flex min-h-14 items-center justify-center gap-2 font-mono text-[10px] tracking-[0.06em] text-paper-faint">
                {loadingMore ? (
                  <>
                    <RefreshCw size={12} className="animate-spin text-cinnabar-soft" />
                    <span>正在加载更多</span>
                  </>
                ) : (
                  <span>继续上滑加载</span>
                )}
              </div>
            )}
            {items.length > 0 && !hasMore && !loading && (
              <div className="py-5 text-center font-mono text-[10px] tracking-[0.08em] text-paper-faint">已经到底了</div>
            )}
          </div>

          {dragX < 0 && nextMode && (
            <div
              className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-ink"
              style={{
                transform: `translate3d(calc(${dragX}px + 100%), 0, 0)`,
                transition: swipeTransition,
                backfaceVisibility: 'hidden',
                opacity: 0.86 + dragProgress * 0.14,
              }}
              aria-hidden
            >
              <ZhihuFeedPeek
                items={nextPreview?.items ?? []}
                loading={nextPreview?.loading ?? true}
                mode={nextMode.id}
              />
            </div>
          )}
        </div>
      </div>

      <ContextActionMenu
        open={Boolean(actionMenu && actionItem)}
        anchor={actionMenu?.anchor ?? { x: 0, y: 0 }}
        title={actionItem?.title ?? '调整推荐'}
        caption={actionItem?.author?.name ? `作者 · ${actionItem.author.name}` : '仅影响你的本地智能推荐'}
        actions={actionItems}
        onClose={() => setActionMenu(null)}
      />
    </div>
  )
}
