import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, MutableRefObject, ReactNode } from 'react'
import { ArrowUpDown, ChevronDown, Clock3, FileText, Hash, Search, UserRound, X } from 'lucide-react'

import { OptionPickerDialog } from '../../../components/ConfirmDialog'
import { SegmentedControl } from '../../../components/SegmentedControl'
import { ZhihuApiError } from '../api/errors'
import type {
  ZhihuSearchContentType,
  ZhihuSearchSort,
  ZhihuSearchTab,
  ZhihuSearchTimeRange,
} from '../api/endpoints'
import type { ZhihuFeedService } from '../feed/service'
import type { ZhihuContentSummary, ZhihuEntityRef, ZhihuSearchState } from '../types'
import {
  ZhihuContentRow,
  ZhihuEmptyState,
  ZhihuErrorBanner,
  ZhihuLoadingState,
  ZhihuSurface,
} from './ZhihuUi'

interface Props {
  initialQuery: string
  initialState?: ZhihuSearchState
  service: ZhihuFeedService
  onQueryChange: (query: string, state: ZhihuSearchState) => void
  onStateChange?: (state: ZhihuSearchState) => void
  onOpen: (ref: ZhihuEntityRef, state: ZhihuSearchState) => void
  restrictedMemberHashId?: string
  restrictedMemberName?: string
  onClearRestriction?: () => void
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>
}

const SORT_OPTIONS: Array<{ id: ZhihuSearchSort; label: string }> = [
  { id: 'default', label: '综合排序' },
  { id: 'latest', label: '最新发布' },
  { id: 'most-voted', label: '最多赞同' },
]
const CONTENT_OPTIONS: Array<{ id: ZhihuSearchContentType; label: string }> = [
  { id: 'all', label: '全部内容' },
  { id: 'answer', label: '回答' },
  { id: 'article', label: '文章' },
]
const TIME_OPTIONS: Array<{ id: ZhihuSearchTimeRange; label: string }> = [
  { id: 'all', label: '不限时间' },
  { id: 'day', label: '一天内' },
  { id: 'week', label: '一周内' },
  { id: 'month', label: '一个月内' },
  { id: 'three-months', label: '三个月内' },
  { id: 'half-year', label: '半年内' },
  { id: 'year', label: '一年内' },
]

function optionLabel<T extends string>(options: Array<{ id: T; label: string }>, value: T): string {
  return options.find((item) => item.id === value)?.label ?? value
}

function FilterChip({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-haze/60 bg-ink-raised/50 px-3.5 text-[11.5px] font-medium text-paper-muted transition-colors hover:border-sky-500/40 hover:bg-ink-raised hover:text-sky-500 active:scale-95"
    >
      <span className="text-paper-faint">{icon}</span>
      <span>{label}</span>
      <ChevronDown size={12} strokeWidth={1.8} className="text-paper-faint" />
    </button>
  )
}


export function ZhihuSearchScreen({
  initialQuery,
  initialState,
  service,
  onQueryChange,
  onStateChange,
  onOpen,
  restrictedMemberHashId,
  restrictedMemberName,
  onClearRestriction,
  scrollContainerRef,
}: Props) {
  const [input, setInput] = useState(initialState?.input ?? initialQuery)
  const [query, setQuery] = useState(initialState?.query ?? initialQuery)
  const [tab, setTab] = useState<ZhihuSearchTab>(initialState?.tab ?? 'general')
  const [sort, setSort] = useState<ZhihuSearchSort>(initialState?.sort ?? 'default')
  const [contentType, setContentType] = useState<ZhihuSearchContentType>(initialState?.contentType ?? 'all')
  const [timeRange, setTimeRange] = useState<ZhihuSearchTimeRange>(initialState?.timeRange ?? 'all')
  const [items, setItems] = useState<ZhihuContentSummary[]>(initialState?.items ?? [])
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialState?.nextCursor)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picker, setPicker] = useState<'sort' | 'content' | 'time' | null>(null)
  const epoch = useRef(0)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const skipRestoredSearchRef = useRef(Boolean(initialState))
  const searchState = useMemo<ZhihuSearchState>(() => ({
    input,
    query,
    tab,
    sort,
    contentType,
    timeRange,
    items,
    nextCursor,
  }), [contentType, input, items, nextCursor, query, sort, tab, timeRange])

  useEffect(() => {
    onStateChange?.(searchState)
  }, [onStateChange, searchState])

  useEffect(() => {
    if (!query.trim()) {
      setItems([])
      setNextCursor(undefined)
      setError(null)
      return
    }
    if (skipRestoredSearchRef.current) {
      skipRestoredSearchRef.current = false
      return
    }
    const request = ++epoch.current
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void service.search(query, undefined, controller.signal, {
      tab,
      sort,
      contentType,
      timeRange,
      restrictedMemberHashId,
    }).then(
      (page) => {
        if (request !== epoch.current) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setLoading(false)
      },
      (reason) => {
        if (controller.signal.aborted || request !== epoch.current) return
        const apiError = reason instanceof ZhihuApiError ? reason : null
        setError(apiError?.message ?? (reason instanceof Error ? reason.message : '搜索失败'))
        setLoading(false)
      },
    )
    return () => controller.abort()
  }, [contentType, query, restrictedMemberHashId, service, sort, tab, timeRange])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const next = input.trim()
    const nextState = { ...searchState, input: next, query: next, items: [], nextCursor: undefined }
    setInput(next)
    setQuery(next)
    setItems([])
    setNextCursor(undefined)
    onQueryChange(next, nextState)
  }

  const loadMore = () => {
    if (!nextCursor || loadingMore || loading || !query.trim()) return
    const cursor = nextCursor
    const request = epoch.current
    setLoadingMore(true)
    setError(null)
    void service.search(query, cursor, undefined, {
      tab,
      sort,
      contentType,
      timeRange,
      restrictedMemberHashId,
    }).then(
      (page) => {
        if (request !== epoch.current) return
        setItems((prev) => {
          const seen = new Set(prev.map((item) => `${item.ref.kind}:${item.ref.id}`))
          return [...prev, ...page.items.filter((item) => !seen.has(`${item.ref.kind}:${item.ref.id}`))]
        })
        setNextCursor(page.nextCursor)
        setLoadingMore(false)
      },
      (reason) => {
        if (request !== epoch.current) return
        setError(reason instanceof Error ? reason.message : '加载更多失败')
        setLoadingMore(false)
      },
    )
  }

  useEffect(() => {
    const target = sentinelRef.current
    if (!target || !nextCursor || loading || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { root: scrollContainerRef?.current ?? null, rootMargin: '0px 0px 320px 0px', threshold: 0.01 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  // loadMore reads the current query/cursor state; recreating after each page is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, loadingMore, nextCursor, scrollContainerRef])

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 sm:px-6">
      <form onSubmit={submit} className="flex items-center gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-haze/60 bg-ink-raised/50 px-4 transition-[border-color,background-color] focus-within:border-sky-500/50 focus-within:bg-ink-raised/80">
          <Search size={15} strokeWidth={2} className="shrink-0 text-sky-500" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="搜索知乎内容、问题、答主…"
            autoFocus={!initialQuery}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-paper outline-none placeholder:text-paper-faint/70"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput('')}
              aria-label="清空搜索"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-paper-faint hover:bg-paper/5 hover:text-paper"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <button
          type="submit"
          aria-label="搜索"
          title="搜索"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0066FF] text-white shadow-sm transition-[background-color,transform] hover:bg-[#005ce6] active:scale-95"
        >
          <Search size={17} strokeWidth={2} />
        </button>
      </form>

      {restrictedMemberHashId && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-cinnabar/25 bg-cinnabar/7 px-3 py-2.5 text-[11px] text-paper-muted">
          <UserRound size={14} strokeWidth={1.6} className="shrink-0 text-cinnabar-soft" />
          <span className="min-w-0 flex-1 truncate">只搜索 {restrictedMemberName?.trim() || 'TA'} 的创作</span>
          {onClearRestriction && (
            <button
              type="button"
              onClick={onClearRestriction}
              aria-label="取消用户范围限制"
              title="改为全站搜索"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-paper-faint transition-colors hover:bg-paper/5 hover:text-paper"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div className="mt-3">
        <SegmentedControl
          label="搜索范围"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'general', label: '全站' },
            { value: 'people', label: '用户' },
            { value: 'topic', label: '话题' },
          ]}
        />
      </div>

      {tab === 'general' && (
        <div className="scroll-hidden -mx-1 mt-2.5 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <FilterChip icon={<ArrowUpDown size={13} />} label={optionLabel(SORT_OPTIONS, sort)} onClick={() => setPicker('sort')} />
          <FilterChip icon={<FileText size={13} />} label={optionLabel(CONTENT_OPTIONS, contentType)} onClick={() => setPicker('content')} />
          <FilterChip icon={<Clock3 size={13} />} label={optionLabel(TIME_OPTIONS, timeRange)} onClick={() => setPicker('time')} />
        </div>
      )}

      {error && <div className="mt-3"><ZhihuErrorBanner>{error}</ZhihuErrorBanner></div>}
      {loading && items.length === 0 && <ZhihuLoadingState label="正在搜索知乎…" />}
      {!loading && query && !error && items.length === 0 && (
        <ZhihuEmptyState
          icon={tab === 'people' ? <UserRound size={28} /> : tab === 'topic' ? <Hash size={28} /> : <Search size={28} />}
          title="没有找到匹配内容"
          description="换一个关键词，或调整筛选条件再试。"
        />
      )}
      {!query && (
        <ZhihuEmptyState icon={<Search size={28} />} title="搜索知乎" description="问题、回答、文章、用户和话题都可以直接搜索。" />
      )}

      {items.length > 0 && (
        <ZhihuSurface className="mt-3 divide-y divide-haze/55">
          {items.map((item) => (
            <ZhihuContentRow key={`${item.ref.kind}:${item.ref.id}`} item={item} onOpen={(value) => onOpen(value.ref, searchState)} showReason={false} />
          ))}
        </ZhihuSurface>
      )}

      {nextCursor && items.length > 0 && (
        <div ref={sentinelRef} className="flex min-h-14 items-center justify-center font-mono text-[10px] text-paper-faint">
          {loadingMore ? '正在加载更多…' : '继续上滑加载'}
        </div>
      )}

      <OptionPickerDialog
        open={picker === 'sort'}
        title="排序"
        value={sort}
        options={SORT_OPTIONS}
        onChange={(value) => { setSort(value); setPicker(null) }}
        onCancel={() => setPicker(null)}
      />
      <OptionPickerDialog
        open={picker === 'content'}
        title="内容类型"
        value={contentType}
        options={CONTENT_OPTIONS}
        onChange={(value) => { setContentType(value); setPicker(null) }}
        onCancel={() => setPicker(null)}
      />
      <OptionPickerDialog
        open={picker === 'time'}
        title="时间范围"
        value={timeRange}
        options={TIME_OPTIONS}
        onChange={(value) => { setTimeRange(value); setPicker(null) }}
        onCancel={() => setPicker(null)}
      />
    </div>
  )
}
