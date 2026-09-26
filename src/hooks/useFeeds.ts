import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  articleDateCursor,
  mergeHeadPage,
  mergeOlderPage,
  nextClientCatalogPage,
  openClientCatalog,
  placeUndatedPageAfterExisting,
  sortArticles,
  summarizePagination,
  trimLegacyCatalogCache,
  type PaginationViewState,
  type SourcePagingState,
} from '../lib/feedPagination'
import { fetchAbsoluteText, fetchSourceText } from '../lib/http'
import { detectNextPageUrl } from '../features/catalogEngine/pagination'
import { describeNonFeedPayload } from '../lib/feedPayload'
import { normalizeLegacyVideoArticle } from '../lib/videoArticle'
import {
  enrichJazzyearDates,
  enrichLatepostDates,
  enrichPaulGrahamDates,
  neteasePageEntryCount,
  parseSourcePayload,
  parseThePaperCursor,
  thePaperCursor,
  thePaperCursorAdvances,
  thePaperPageRequest,
  zhihuEditionDate,
} from '../lib/parseFeed'
import { parseSourceArticles } from '../lib/sourceArticles'
import {
  cachedListMatchesSourceVersion,
  loadCachedList,
  saveCachedArticles,
  type CachedList,
  type CachedPagingMeta,
} from '../lib/storage'
import {
  createRefreshProgress,
  finishRefreshProgress,
  settleRefreshSource,
} from '../lib/refreshProgress'
import { mapWithFeedConcurrency } from '../lib/feedRefreshConcurrency'
import { buildFeedStatusList } from '../lib/feedStatusList'
import type { Article, RefreshProgress, SourceStatus } from '../lib/types'
import {
  CATALOG_PAGE_SIZE,
  NETEASE_PAGE_SIZE,
  SOURCES,
  findSource,
  maxOffsetPages,
  pagingStrategyOf,
  sourceSupportsPaging,
  usesClientCatalogPaging,
  zhihuBeforeUrl,
  type NewsSource,
} from '../sources/registry'

interface FeedsResult {
  articles: Article[]
  statuses: SourceStatus[]
  refreshing: boolean
  refreshProgress: RefreshProgress | null
  loadingMore: boolean
  lastUpdated?: number
  offline: boolean
  paginationState: (sourceIds: string[]) => PaginationViewState
  /** 不传则刷新 hook 当前跟踪的全部源；传入则只刷新这些源 */
  refresh: (sourceIds?: string[]) => Promise<void>
  loadMore: (sourceIds: string[]) => Promise<void>
}

/** Keep one slow source from holding the whole refresh UI indefinitely. */
const REFRESH_TIMEOUT_MS = 25_000

/** 列表先上屏，详情日期在后台补全后写回（不阻塞刷新完成态） */
function scheduleDetailDateEnrichment(
  id: string,
  source: NewsSource,
  payload: string,
  articles: Article[],
  signal: AbortSignal,
  applyHeadPage: (
    id: string,
    source: NewsSource,
    payload: string,
    incoming: Article[],
  ) => number,
): void {
  if (signal.aborted) return
  const enrich =
    source.kind === 'latepost'
      ? enrichLatepostDates
      : source.kind === 'jazzyear'
        ? enrichJazzyearDates
        : source.kind === 'paulgraham'
          ? enrichPaulGrahamDates
          : null
  if (!enrich) return
  void enrich(
    articles,
    (url, fetchSignal) => fetchAbsoluteText(url, { signal: fetchSignal }),
    signal,
  ).then((enriched) => {
    if (signal.aborted) return
    applyHeadPage(id, source, payload, enriched)
  })
}

interface InitialFeeds {
  buckets: Map<string, Article[]>
  updatedAt: Record<string, number>
  paging: Record<string, SourcePagingState>
}

function pagingFromCache(
  source: NewsSource,
  cached: CachedList | null,
  itemCount: number,
): SourcePagingState {
  if (!cached) return { phase: 'uninitialized' }

  const persisted = cached.paging
  switch (pagingStrategyOf(source)) {
    case 'upstream-offset': {
      const maxPage = Math.max(0, maxOffsetPages(source) - 1)
      const inferredPage = Math.max(
        0,
        Math.min(
          maxPage,
          Math.floor((Math.max(itemCount, 1) - 1) / NETEASE_PAGE_SIZE),
        ),
      )
      return {
        phase: persisted?.exhausted ? 'exhausted' : 'ready',
        page: persisted?.page ?? inferredPage,
      }
    }
    case 'client-catalog': {
      const inferredPage = Math.max(
        0,
        Math.floor((Math.max(itemCount, 1) - 1) / CATALOG_PAGE_SIZE),
      )
      const page = typeof persisted?.page === 'number' ? persisted.page : inferredPage
      return {
        phase: persisted?.exhausted ? 'exhausted' : 'ready',
        page,
      }
    }
    case 'upstream-cursor': {
      const cursor =
        persisted?.cursor ?? (source.kind === 'zhihu' ? articleDateCursor(cached.items) : undefined)
      return {
        phase: persisted?.exhausted ? 'exhausted' : cursor ? 'ready' : 'uninitialized',
        cursor,
        page: persisted?.page,
      }
    }
  }
}

function loadCachedSource(
  sourceId: string,
  extraSources?: NewsSource[],
): {
  items: Article[]
  cachedAt?: number
  paging: SourcePagingState
} {
  const source = findSource(sourceId, extraSources)
  const loadedCache = loadCachedList(sourceId)
  const cached = cachedListMatchesSourceVersion(loadedCache, source?.cacheVersion)
    ? loadedCache
    : null
  let items = (cached?.items ?? []).map(normalizeLegacyVideoArticle)
  if (
    source &&
    cached &&
    usesClientCatalogPaging(source) &&
    typeof cached.paging?.page !== 'number' &&
    items.length > CATALOG_PAGE_SIZE
  ) {
    items = trimLegacyCatalogCache(items, CATALOG_PAGE_SIZE)
  }
  return {
    items,
    cachedAt: cached?.cachedAt,
    paging: source
      ? pagingFromCache(source, cached, items.length)
      : { phase: 'uninitialized' },
  }
}

/** 只恢复当前需要的源缓存，避免启动时同步解析全部 SOURCES */
function readInitialFeeds(sourceIds: string[], extraSources?: NewsSource[]): InitialFeeds {
  const buckets = new Map<string, Article[]>()
  const updatedAt: Record<string, number> = {}
  const paging: Record<string, SourcePagingState> = {}

  for (const id of sourceIds) {
    const loaded = loadCachedSource(id, extraSources)
    if (loaded.cachedAt !== undefined && loaded.items.length) {
      buckets.set(id, loaded.items)
      updatedAt[id] = loaded.cachedAt
    }
    paging[id] = loaded.paging
  }

  return { buckets, updatedAt, paging }
}

function mergeCachedSources(
  buckets: Map<string, Article[]>,
  paging: Record<string, SourcePagingState>,
  updatedAt: Record<string, number>,
  sourceIds: string[],
  extraSources?: NewsSource[],
): {
  buckets: Map<string, Article[]>
  paging: Record<string, SourcePagingState>
  updatedAt: Record<string, number>
  changed: boolean
} {
  let changed = false
  let nextBuckets = buckets
  const nextPaging = paging
  const nextUpdatedAt = { ...updatedAt }

  for (const id of sourceIds) {
    if (nextPaging[id] || nextBuckets.has(id)) continue
    if (nextBuckets === buckets) nextBuckets = new Map(buckets)
    const loaded = loadCachedSource(id, extraSources)
    if (loaded.cachedAt !== undefined && loaded.items.length) {
      nextBuckets.set(id, loaded.items)
      nextUpdatedAt[id] = loaded.cachedAt
    }
    nextPaging[id] = loaded.paging
    changed = true
  }

  return {
    buckets: nextBuckets,
    paging: nextPaging,
    updatedAt: nextUpdatedAt,
    changed,
  }
}

function cacheMeta(state: SourcePagingState | undefined): CachedPagingMeta | undefined {
  if (!state) return undefined
  const meta: CachedPagingMeta = {}
  if (typeof state.page === 'number') meta.page = state.page
  if (state.cursor) meta.cursor = state.cursor
  if (state.phase === 'exhausted') meta.exhausted = true
  return Object.keys(meta).length ? meta : undefined
}

function cacheMetaForItems(
  sourceId: string,
  state: SourcePagingState | undefined,
  items: Article[],
  extraSources?: NewsSource[],
): CachedPagingMeta | undefined {
  const source = findSource(sourceId, extraSources)
  const meta: CachedPagingMeta = { ...cacheMeta(state) }
  if (source?.cacheVersion) meta.sourceVersion = source.cacheVersion
  if (source?.kind !== 'zhihu') return Object.keys(meta).length ? meta : undefined

  const cachedItems = items.slice(0, 160)
  const cachedCursor = articleDateCursor(cachedItems)
  const next = { ...meta, cursor: cachedCursor ?? meta.cursor }
  // When memory contains more than the durable cache can retain, the archive
  // may continue from the oldest retained date after restart.
  if (items.length > cachedItems.length) delete next.exhausted
  return Object.keys(next).length ? next : undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败'
}

export function useFeeds(
  enabledIds: string[],
  onCacheChange?: () => void,
  extraSources?: NewsSource[],
  refreshContextKey?: string,
): FeedsResult {
  const initialRef = useRef<InitialFeeds | null>(null)
  if (!initialRef.current) initialRef.current = readInitialFeeds(enabledIds, extraSources)

  const [buckets, setBuckets] = useState(initialRef.current.buckets)
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [refreshProgress, setRefreshProgress] = useState<RefreshProgress | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pagingTick, setPagingTick] = useState(0)
  const [updatedAtBySource, setUpdatedAtBySource] = useState(initialRef.current.updatedAt)
  const [lastRefreshSucceeded, setLastRefreshSucceeded] = useState(false)

  const pagingRef = useRef(initialRef.current.paging)
  const bucketsRef = useRef(buckets)
  bucketsRef.current = buckets
  const updatedAtRef = useRef(initialRef.current.updatedAt)
  const enabledIdsRef = useRef(enabledIds)
  enabledIdsRef.current = enabledIds
  const extraSourcesRef = useRef(extraSources)
  extraSourcesRef.current = extraSources
  const getSource = useCallback((id: string) => findSource(id, extraSourcesRef.current), [])
  /** client-catalog：完整解析结果仅驻内存，列表窗口从此切片 */
  const catalogRef = useRef<Map<string, Article[]>>(new Map())

  const refreshControllerRef = useRef<AbortController | null>(null)
  const prefetchControllerRef = useRef<AbortController | null>(null)
  const loadMoreControllerRef = useRef<AbortController | null>(null)
  const loadMoreInFlightRef = useRef(false)
  const refreshInFlightRef = useRef(false)
  const refreshContextRef = useRef(refreshContextKey)

  const cancelActiveRefresh = useCallback(() => {
    const controller = refreshControllerRef.current
    refreshControllerRef.current = null
    controller?.abort()
    refreshInFlightRef.current = false
    setRefreshing(false)
    setRefreshProgress(null)
    setStatuses((prev) => {
      let changed = false
      const next = { ...prev }
      Object.entries(prev).forEach(([id, status]) => {
        if (status?.state !== 'loading') return
        delete next[id]
        changed = true
      })
      return changed ? next : prev
    })
  }, [])

  useLayoutEffect(() => {
    if (refreshContextRef.current === refreshContextKey) return
    refreshContextRef.current = refreshContextKey
    cancelActiveRefresh()
  }, [cancelActiveRefresh, refreshContextKey])

  // 分类切换时按需从本地缓存补齐，不在首屏同步扫全部源
  const enabledKey = enabledIds.join('|')
  useEffect(() => {
    const merged = mergeCachedSources(
      bucketsRef.current,
      pagingRef.current,
      updatedAtRef.current,
      enabledIdsRef.current,
      extraSourcesRef.current,
    )
    if (!merged.changed) return
    pagingRef.current = merged.paging
    updatedAtRef.current = merged.updatedAt
    if (merged.buckets !== bucketsRef.current) {
      bucketsRef.current = merged.buckets
      setBuckets(merged.buckets)
    }
    setUpdatedAtBySource(merged.updatedAt)
    setPagingTick((tick) => tick + 1)
  }, [enabledKey])

  const ensureClientCatalog = useCallback(
    async (source: NewsSource, signal: AbortSignal): Promise<Article[]> => {
      const cached = catalogRef.current.get(source.id)
      if (cached?.length) return cached
      const payload = await fetchSourceText(source, signal)
      const { catalog } = openClientCatalog(
        await parseSourceArticles(source, payload, signal),
        CATALOG_PAGE_SIZE,
      )
      catalogRef.current.set(source.id, catalog)
      return catalog
    },
    [],
  )

  const markBucketReady = useCallback((id: string, items: Article[]) => {
    setUpdatedAtBySource((prev) => {
      const next = { ...prev, [id]: Date.now() }
      updatedAtRef.current = next
      return next
    })
    setStatuses((prev) => ({
      ...prev,
      [id]: {
        sourceId: id,
        state: 'ready',
        count: items.length,
        fetchedAt: Date.now(),
      },
    }))
  }, [])

  const updatePaging = useCallback((id: string, next: SourcePagingState) => {
    pagingRef.current[id] = next
    setPagingTick((tick) => tick + 1)
  }, [])

  const commitBucket = useCallback((id: string, items: Article[]) => {
    const next = new Map(bucketsRef.current).set(id, items)
    bucketsRef.current = next
    setBuckets(next)
    saveCachedArticles(
      id,
      items,
      cacheMetaForItems(id, pagingRef.current[id], items, extraSourcesRef.current),
    )
  }, [])

  const applyHeadPage = useCallback(
    (id: string, source: NewsSource, payload: string, incoming: Article[]): number => {
      const previousPaging = pagingRef.current[id] ?? { phase: 'uninitialized' as const }
      const strategy = pagingStrategyOf(source)

      if (strategy === 'client-catalog') {
        const { catalog, head, paging } = openClientCatalog(incoming, CATALOG_PAGE_SIZE)
        catalogRef.current.set(id, catalog)
        updatePaging(id, paging)
        // 下拉刷新重置窗口，避免旧全量缓存继续占内存 / 本地存储
        commitBucket(id, head)
        markBucketReady(id, head)
        return head.length
      }

      if (strategy === 'upstream-offset') {
        // Offset pages shift when new headlines arrive. Rewalk from page 1 and
        // dedupe against retained history so a refresh cannot create gaps.
        updatePaging(id, { phase: 'ready', page: 0 })
      } else if (source.kind === 'thepaper') {
        // 澎湃的 startTime 是服务端快照游标；刷新必须采用本次首页返回的新游标，
        // 不能沿用旧缓存，否则会从旧快照继续翻页并产生缺口。
        const cursor = thePaperCursor(payload)
        const parsedCursor = parseThePaperCursor(cursor)
        updatePaging(id, {
          phase: parsedCursor ? (parsedCursor.hasNext ? 'ready' : 'exhausted') : 'error',
          page: 0,
          cursor,
          error: parsedCursor ? undefined : '澎湃未返回有效分页游标',
        })
      } else {
        const edition = zhihuEditionDate(payload)
        updatePaging(id, {
          phase: previousPaging.phase === 'exhausted' ? 'exhausted' : edition ? 'ready' : 'error',
          cursor: previousPaging.cursor ?? edition,
          error: edition ? undefined : '知乎日报未返回有效日期游标',
        })
      }

      const existing = bucketsRef.current.get(id) ?? []
      const merged = mergeHeadPage(existing, incoming)
      commitBucket(id, merged)
      markBucketReady(id, merged)
      return merged.length
    },
    [commitBucket, markBucketReady, updatePaging],
  )

  const paginationState = useCallback(
    (sourceIds: string[]): PaginationViewState => {
      void pagingTick
      const entries = [...new Set(sourceIds)].flatMap((id) => {
        const source = getSource(id)
        if (!source || !sourceSupportsPaging(source)) return []
        return [pagingRef.current[id] ?? { phase: 'uninitialized' as const }]
      })
      return summarizePagination(entries)
    },
    [getSource, pagingTick],
  )

  const stopLoadMore = useCallback(() => {
    loadMoreControllerRef.current?.abort()
    loadMoreControllerRef.current = null
    loadMoreInFlightRef.current = false
    setLoadingMore(false)
    Object.entries(pagingRef.current).forEach(([id, state]) => {
      if (state.phase !== 'loading') return
      pagingRef.current[id] = {
        ...state,
        phase: state.page !== undefined || state.cursor ? 'ready' : 'uninitialized',
        error: undefined,
      }
    })
    setPagingTick((tick) => tick + 1)
  }, [])

  /** Pull-to-refresh updates the head and preserves previously loaded history. */
  const refresh = useCallback(async (sourceIds?: string[]) => {
    if (refreshInFlightRef.current) return
    const scope = sourceIds?.length ? sourceIds : enabledIdsRef.current
    const ids = [...new Set(scope)].filter((id) => Boolean(getSource(id)))
    if (!ids.length) return
    refreshInFlightRef.current = true
    stopLoadMore()
    prefetchControllerRef.current?.abort()
    refreshControllerRef.current?.abort()
    const controller = new AbortController()
    refreshControllerRef.current = controller
    setRefreshing(true)
    setRefreshProgress(createRefreshProgress(ids))
    setLastRefreshSucceeded(false)

    setStatuses((prev) => {
      const next = { ...prev }
      ids.forEach((id) => {
        next[id] = { sourceId: id, state: 'loading', count: bucketsRef.current.get(id)?.length ?? 0 }
      })
      return next
    })

    let anySucceeded = false
    let timedOut = false
    const refreshTimer = window.setTimeout(() => {
      if (refreshControllerRef.current !== controller) return
      timedOut = true
      controller.abort(new DOMException('刷新超时', 'TimeoutError'))
    }, REFRESH_TIMEOUT_MS)

    try {
      await mapWithFeedConcurrency(
        ids,
        async (id) => {
          const source = getSource(id)
          if (!source) return
          let synced = false
          try {
            const payload = await fetchSourceText(source, controller.signal)
            if (controller.signal.aborted) return
            const articles = parseSourcePayload(source, payload)
            if (!articles.length) {
              throw new Error(describeNonFeedPayload(payload) || '返回内容为空')
            }
            applyHeadPage(id, source, payload, articles)
            scheduleDetailDateEnrichment(
              id,
              source,
              payload,
              articles,
              controller.signal,
              applyHeadPage,
            )
            anySucceeded = true
            synced = true
          } catch (error) {
            if (controller.signal.aborted) return
            setStatuses((prev) => ({
              ...prev,
              [id]: {
                sourceId: id,
                state: 'error',
                count: bucketsRef.current.get(id)?.length ?? 0,
                error: errorMessage(error),
                fetchedAt: Date.now(),
              },
            }))
          } finally {
            if (!controller.signal.aborted) {
              setRefreshProgress((progress) =>
                progress ? settleRefreshSource(progress, id, synced) : progress,
              )
            }
          }
        },
        controller.signal,
      )
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
    } finally {
      window.clearTimeout(refreshTimer)
    }

    if (refreshControllerRef.current === controller) {
      refreshControllerRef.current = null
      refreshInFlightRef.current = false
      setRefreshing(false)
      setLastRefreshSucceeded(anySucceeded)
      setRefreshProgress((progress) =>
        progress ? finishRefreshProgress(progress) : progress,
      )
      if (timedOut) {
        setStatuses((prev) => {
          const next = { ...prev }
          ids.forEach((id) => {
            if (next[id]?.state !== 'loading') return
            next[id] = {
              sourceId: id,
              state: 'error',
              count: bucketsRef.current.get(id)?.length ?? 0,
              error: '刷新超时',
              fetchedAt: Date.now(),
            }
          })
          return next
        })
      }
      if (anySucceeded) onCacheChange?.()
    }
  }, [applyHeadPage, getSource, onCacheChange, stopLoadMore])

  /** Quietly initialize sources that have no list cache yet. */
  const prefetchMissing = useCallback(
    async (ids: string[]) => {
      if (refreshInFlightRef.current) return
      const missing = ids.filter((id) => !(bucketsRef.current.get(id)?.length))
      if (!missing.length) return

      prefetchControllerRef.current?.abort()
      const controller = new AbortController()
      prefetchControllerRef.current = controller
      let anySucceeded = false

      try {
        await mapWithFeedConcurrency(
          missing,
          async (id) => {
            const source = getSource(id)
            if (!source) return
            try {
              const payload = await fetchSourceText(source, controller.signal)
              if (controller.signal.aborted) return
              const articles = parseSourcePayload(source, payload)
              if (!articles.length) {
                throw new Error(describeNonFeedPayload(payload) || '返回内容为空')
              }
              applyHeadPage(id, source, payload, articles)
              scheduleDetailDateEnrichment(
                id,
                source,
                payload,
                articles,
                controller.signal,
                applyHeadPage,
              )
              anySucceeded = true
            } catch (error) {
              if (controller.signal.aborted) return
              setStatuses((prev) => ({
                ...prev,
                [id]: {
                  sourceId: id,
                  state: 'error',
                  count: bucketsRef.current.get(id)?.length ?? 0,
                  error: errorMessage(error),
                  fetchedAt: Date.now(),
                },
              }))
            }
          },
          controller.signal,
        )
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
      }

      if (prefetchControllerRef.current === controller) prefetchControllerRef.current = null
      if (!controller.signal.aborted && anySucceeded) onCacheChange?.()
    },
    [applyHeadPage, getSource, onCacheChange],
  )

  const loadMore = useCallback(
    async (sourceIds: string[]) => {
      if (refreshInFlightRef.current || loadMoreInFlightRef.current) return
      const targets = [...new Set(sourceIds)].filter((id) => {
        const source = getSource(id)
        if (!source || !sourceSupportsPaging(source)) return false
        return pagingRef.current[id]?.phase !== 'exhausted'
      })
      if (!targets.length) return

      const controller = new AbortController()
      loadMoreControllerRef.current = controller
      loadMoreInFlightRef.current = true
      setLoadingMore(true)
      let anyAdded = false

      try {
        await mapWithFeedConcurrency(
          targets,
          async (id) => {
          const source = getSource(id)
          if (!source) return
          const previous = pagingRef.current[id] ?? { phase: 'uninitialized' as const }
          updatePaging(id, { ...previous, phase: 'loading', error: undefined })

          try {
            let state = pagingRef.current[id]
            const strategy = pagingStrategyOf(source)

            if (strategy === 'client-catalog') {
              const catalog = await ensureClientCatalog(source, controller.signal)
              if (controller.signal.aborted) return
              const currentPage = pagingRef.current[id]?.page ?? 0
              const { slice, paging } = nextClientCatalogPage(
                catalog,
                currentPage,
                CATALOG_PAGE_SIZE,
              )
              updatePaging(id, paging)

              const existing = bucketsRef.current.get(id) ?? []
              if (!slice.length) {
                saveCachedArticles(
                  id,
                  existing,
                  cacheMetaForItems(id, pagingRef.current[id], existing),
                )
                return
              }

              const { merged, added } = mergeOlderPage(existing, slice)
              commitBucket(id, merged)
              if (added > 0) {
                anyAdded = true
                markBucketReady(id, merged)
              } else {
                saveCachedArticles(
                  id,
                  existing,
                  cacheMetaForItems(id, pagingRef.current[id], existing),
                )
              }
              return
            }

            if (strategy === 'upstream-offset') {
              // next-link: use discovered URL from previous page
              if (source.frameworkHint?.paginationPattern.kind === 'next-link') {
                const nextUrl = pagingRef.current[id]?.nextUrl
                if (!nextUrl) {
                  const headPayload = await fetchSourceText(source, controller.signal)
                  if (controller.signal.aborted) return
                  const headArticles = await parseSourceArticles(source, headPayload, controller.signal)
                  applyHeadPage(id, source, headPayload, headArticles)
                  const discoveredNext = detectNextPageUrl(headPayload, source.url)
                  updatePaging(id, {
                    phase: discoveredNext ? 'ready' : 'exhausted',
                    page: 0,
                    nextUrl: discoveredNext,
                  })
                  return
                }

                const payload = await fetchSourceText(source, controller.signal, { url: nextUrl })
                if (controller.signal.aborted) return
                const parsed = await parseSourceArticles(source, payload, controller.signal)
                const discoveredNext = detectNextPageUrl(payload, nextUrl)
                const currentPage = pagingRef.current[id]?.page ?? 0
                updatePaging(id, {
                  phase: discoveredNext && parsed.length ? 'ready' : 'exhausted',
                  page: currentPage + 1,
                  nextUrl: discoveredNext,
                })
                const existing = bucketsRef.current.get(id) ?? []
                if (!parsed.length) {
                  saveCachedArticles(id, existing, cacheMetaForItems(id, pagingRef.current[id], existing))
                  return
                }
                const historical = placeUndatedPageAfterExisting(existing, parsed)
                const { merged, added } = mergeOlderPage(existing, historical)
                if (added > 0) {
                  commitBucket(id, merged)
                  anyAdded = true
                  markBucketReady(id, merged)
                }
                return
              }

              const maxPages = maxOffsetPages(source)
              // Skip duplicate or fully filtered offset pages in one interaction.
              for (let attempt = 0; attempt < 3; attempt += 1) {
                const currentPage = pagingRef.current[id]?.page ?? 0
                const nextPage = currentPage + 1
                if (nextPage >= maxPages) {
                  updatePaging(id, { phase: 'exhausted', page: maxPages - 1 })
                  const items = bucketsRef.current.get(id) ?? []
                  saveCachedArticles(id, items, cacheMetaForItems(id, pagingRef.current[id], items))
                  return
                }

                const payload = await fetchSourceText(source, controller.signal, {
                  page: nextPage,
                })
                if (controller.signal.aborted) return
                const parsed = await parseSourceArticles(source, payload, controller.signal)
                // 网易用原始条目数（过滤图集后可能为空但仍有下一页）；其它源用解析结果
                const rawCount =
                  source.kind === 'netease' ? neteasePageEntryCount(payload) : parsed.length
                const exhausted = rawCount === 0 || nextPage + 1 >= maxPages
                updatePaging(id, {
                  phase: exhausted ? 'exhausted' : 'ready',
                  page: nextPage,
                })

                const existing = bucketsRef.current.get(id) ?? []
                const historical = placeUndatedPageAfterExisting(existing, parsed)
                const { merged, added } = mergeOlderPage(existing, historical)
                if (added > 0) {
                  commitBucket(id, merged)
                  anyAdded = true
                  markBucketReady(id, merged)
                  return
                }

                saveCachedArticles(
                  id,
                  existing,
                  cacheMetaForItems(id, pagingRef.current[id], existing),
                )
                if (exhausted) return
              }
              return
            }

            // upstream-cursor：澎湃使用 startTime 快照游标；知乎日报使用日期游标。
            // 旧缓存可能没有游标，先刷新首页建立游标，再在同一次交互继续向后翻。
            if (!state.cursor) {
              const headPayload = await fetchSourceText(source, controller.signal)
              if (controller.signal.aborted) return
              const headArticles = await parseSourceArticles(
                source,
                headPayload,
                controller.signal,
              )
              if (!headArticles.length) {
                throw new Error(source.kind === 'thepaper' ? '澎湃最新列表为空' : '知乎日报最新一期为空')
              }
              applyHeadPage(id, source, headPayload, headArticles)
              state = pagingRef.current[id]
              updatePaging(id, { ...state, phase: 'loading', error: undefined })
            }

            const previousCursor = state.cursor
            if (!previousCursor) {
              throw new Error(source.kind === 'thepaper' ? '澎湃分页游标尚未初始化' : '知乎日报日期游标尚未初始化')
            }

            let payload: string
            let nextCursor: string | undefined
            let nextPage = state.page ?? 0
            if (source.kind === 'thepaper') {
              const requestJson = thePaperPageRequest(source, previousCursor, nextPage + 1)
              if (!requestJson) {
                updatePaging(id, { ...state, phase: 'exhausted' })
                return
              }
              payload = await fetchSourceText(source, controller.signal, { requestJson })
              nextCursor = thePaperCursor(payload)
              if (!nextCursor || !thePaperCursorAdvances(previousCursor, nextCursor)) {
                throw new Error('澎湃返回了未前进的历史分页游标')
              }
              nextPage += 1
            } else {
              payload = await fetchSourceText(source, controller.signal, {
                url: zhihuBeforeUrl(previousCursor),
              })
              nextCursor = zhihuEditionDate(payload)
              if (!nextCursor || nextCursor >= previousCursor) {
                throw new Error('知乎日报返回了无效的历史日期游标')
              }
            }

            if (controller.signal.aborted) return
            const parsed = await parseSourceArticles(source, payload, controller.signal)
            if (source.kind === 'thepaper') {
              const parsedCursor = parseThePaperCursor(nextCursor)
              if (!parsedCursor) throw new Error('澎湃返回了无效的历史分页游标')
              updatePaging(id, {
                phase: parsed.length && parsedCursor.hasNext ? 'ready' : 'exhausted',
                page: nextPage,
                cursor: nextCursor,
              })
            } else {
              updatePaging(id, {
                phase: parsed.length ? 'ready' : 'exhausted',
                cursor: nextCursor,
              })
            }

            const existing = bucketsRef.current.get(id) ?? []
            if (!parsed.length) {
              saveCachedArticles(
                id,
                existing,
                cacheMetaForItems(id, pagingRef.current[id], existing),
              )
              return
            }
            const historical =
              source.kind === 'thepaper' ? placeUndatedPageAfterExisting(existing, parsed) : parsed
            const { merged, added } = mergeOlderPage(existing, historical)
            commitBucket(id, merged)
            if (added > 0) {
              anyAdded = true
              markBucketReady(id, merged)
            }
          } catch (error) {
            if (controller.signal.aborted) return
            const current = pagingRef.current[id] ?? previous
            updatePaging(id, {
              ...current,
              phase: 'error',
              error: errorMessage(error),
            })
          }
          },
          controller.signal,
        )
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
      }

      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null
        loadMoreInFlightRef.current = false
        setLoadingMore(false)
        if (anyAdded) onCacheChange?.()
      }
    },
    [applyHeadPage, commitBucket, ensureClientCatalog, markBucketReady, onCacheChange, updatePaging],
  )

  useEffect(() => {
    return () => {
      refreshControllerRef.current?.abort()
      prefetchControllerRef.current?.abort()
      loadMoreControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    void prefetchMissing(enabledIdsRef.current)
  }, [enabledKey, prefetchMissing])

  const articles = useMemo(() => {
    const list: Article[] = []
    for (let i = 0; i < enabledIds.length; i += 1) {
      const items = buckets.get(enabledIds[i])
      if (items?.length) {
        for (let j = 0; j < items.length; j += 1) {
          list.push(items[j])
        }
      }
    }
    return sortArticles(list)
  }, [buckets, enabledKey])

  const lastUpdated = useMemo(() => {
    const times = enabledIds
      .map((id) => updatedAtBySource[id])
      .filter((value): value is number => typeof value === 'number')
    return times.length ? Math.max(...times) : undefined
  }, [enabledIds, updatedAtBySource])

  const statusList = useMemo(
    () => buildFeedStatusList(SOURCES, extraSources, statuses, buckets),
    [buckets, extraSources, statuses],
  )

  return {
    articles,
    statuses: statusList,
    refreshing,
    refreshProgress,
    loadingMore,
    lastUpdated,
    offline: !lastRefreshSucceeded && articles.length > 0,
    paginationState,
    refresh,
    loadMore,
  }
}
