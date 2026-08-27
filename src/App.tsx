import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { AppShell } from './components/AppShell'
import { DlnaCastBanner } from './components/DlnaCastBanner'
import { OpenInAppBanner } from './components/OpenInAppBanner'
import { DesktopSidebar } from './components/DesktopSidebar'
import { TabBar, type TabKey } from './components/TabBar'
import { SyncOnboardingPrompt } from './features/account/SyncOnboardingPrompt'
import { useAccount } from './features/account/useAccount'
import { syncRouteFromAppUrl } from './features/sync/nativeNotification'
import { toastForSyncEvent, syncStatusCaption, type SyncToastModel } from './features/sync/notifier'
import { useCloudSync } from './features/sync/useCloudSync'
import { SyncToast } from './components/SyncToast'
import { useFeeds } from './hooks/useFeeds'
import { usePreferences } from './hooks/usePreferences'
import { usePresets } from './hooks/usePresets'
import {
  bodyCacheStats,
  hasCachedBody,
  listCachedArticles,
  saveCachedBody,
  setBodyPinned,
  syncBodyPins,
} from './lib/bodyCache'
import { sortArticles } from './lib/feedPagination'
import { log } from './lib/logger'
import {
  buildReadingProfile,
  collectReadArticles,
  rankRecommendations,
  recommendationReadiness,
  scopeSignalsToSources,
} from './lib/recommend'
import { resolveArticleBody } from './lib/resolveBody'
import {
  isAndroidBrowser,
  preferredOpenInAppUrl,
  shareTokenFromAppUrl,
} from './lib/appDeepLink'
import {
  articleFromSharePayload,
  clearShareLocation,
  decodeShareToken,
  shareTokenFromPath,
  type SharePayload,
} from './lib/shareLink'
import {
  hasSeenProductTour,
  hasSeenSyncOnboarding,
  listCacheStats,
  loadEnabledSources,
  loadIdSet,
  loadLaterArticles,
  markSyncOnboardingSeen,
  saveEnabledSources,
  saveIdSet,
  saveLaterArticles,
} from './lib/storage'
import { chineseDate } from './lib/time'
import type { Article } from './lib/types'
import { THEME_MODES, THEME_SCHEMES, schemeSeedColors } from './lib/theme'
import { ChannelsScreen } from './screens/ChannelsScreen'
import { FeedScreen } from './screens/FeedScreen'
import { MeScreen } from './screens/MeScreen'
import { SiteScreen } from './screens/SiteScreen'
import { AboutScreen } from './screens/settings/AboutScreen'
import { AccountSyncScreen } from './screens/settings/AccountSyncScreen'
import { ChangelogScreen } from './screens/settings/ChangelogScreen'
import { OpenSourceScreen } from './screens/settings/OpenSourceScreen'
import { AppearanceScreen } from './screens/settings/AppearanceScreen'
import { CustomSchemeScreen } from './screens/settings/CustomSchemeScreen'
import { CategorySettingsScreen } from './screens/settings/CategorySettingsScreen'
import { CategorySourcesScreen } from './screens/settings/CategorySourcesScreen'
import { CategoryEditScreen } from './screens/settings/CategoryEditScreen'
import { CustomSourcesScreen } from './screens/settings/CustomSourcesScreen'
import { HistoryScreen } from './screens/settings/HistoryScreen'
import { LaterScreen } from './screens/settings/LaterScreen'
import { LocalSearchScreen } from './screens/settings/LocalSearchScreen'
import { PresetListScreen } from './screens/settings/PresetListScreen'
import { StorageScreen } from './screens/settings/StorageScreen'
import { TypographyScreen } from './screens/settings/TypographyScreen'
import { TranslationScreen } from './screens/settings/TranslationScreen'
import { ProxyScreen } from './screens/settings/ProxyScreen'
import { ConfirmDialog } from './components/ConfirmDialog'
import {
  BRAND_TITLE,
  CurrentEasterEgg,
  EasterEggShell,
  useEasterEggTrigger,
} from './features/easterEgg'
import { proxyModeLabel } from './features/proxy/config'
import { useProductTour } from './features/productTour/useProductTour'
import { UpdateDialog } from './features/appUpdate/UpdateDialog'
import { useAppUpdate } from './features/appUpdate/useAppUpdate'
import { usePrestore } from './features/prestore/usePrestore'
import {
  translationDisplayModeLabel,
  translationLanguageLabel,
  translationProviderLabel,
} from './features/translation/config'
import { RECOMMEND_CATEGORY_ID, type CategoryId } from './sources/categories'
import {
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  addCustomCategory,
  addCustomSource,
  allRegisteredSources,
  batchImportSourcesAndCategories,
  defaultFeedCategoryId,
  deleteCustomCategory,
  deleteCustomSource,
  deleteCustomSources,
  recommendationScopeSourceIds,
  resetCategoryLayout,
  resetCategorySources,
  resetTypography,
  setAutoRefreshOnCategorySwitch,
  setCategoryOrder,
  setEinkMode,
  setPrestoreEnabled,
  setPrestorePerSourceLimit,
  setRecommendEnabled,
  setWifiOnlyAutoLoadMedia,
  selectThemeScheme,
  setCustomSchemeColors,
  setThemeMode,
  sourceIdsForCategoryWithPrefs,
  toggleCategorySource,
  toggleCategoryVisible,
  updateCustomCategory,
  updateCustomSource,
  updateTypography,
  visibleCategories,
  withRecommendCategory,
  type TypographyPrefs,
} from './sources/preferences'
import { SOURCES, findSource } from './sources/registry'

const ReaderScreen = lazy(() =>
  import('./screens/ReaderScreen').then((module) => ({
    default: module.ReaderScreen,
  })),
)

const DEFAULT_ENABLED = SOURCES.filter((source) => source.enabled).map((source) => source.id)

function emptyCacheSnapshot() {
  return {
    bodies: { count: 0, bytes: 0, pinned: 0, pinnedBytes: 0 },
    lists: { count: 0, bytes: 0 },
    history: [] as ReturnType<typeof listCachedArticles>,
  }
}

function readCacheSnapshot() {
  return {
    bodies: bodyCacheStats(),
    lists: listCacheStats(),
    history: listCachedArticles(30),
  }
}

type SettingsRoute =
  | { name: 'presets' }
  | { name: 'categories'; returnTo?: 'presets' | 'me' }
  | { name: 'category-sources'; categoryId: CategoryId }
  | { name: 'category-edit'; categoryId?: CategoryId }
  | { name: 'custom-sources' }
  | { name: 'channels' }
  | { name: 'typography' }
  | { name: 'appearance' }
  | { name: 'custom-scheme' }
  | { name: 'storage' }
  | { name: 'translation' }
  | { name: 'proxy' }
  | { name: 'later' }
  | { name: 'history' }
  | { name: 'local-search' }
  | { name: 'account-sync' }
  | { name: 'about' }
  | { name: 'changelog' }
  | { name: 'licenses' }

interface BodyPrefetchTask {
  article: Article
  shouldPin: () => boolean
  onCacheChange: () => void
  extraSources?: import('./sources/registry').NewsSource[]
}

const bodyPrefetchQueue: BodyPrefetchTask[] = []
const queuedBodyIds = new Set<string>()
let activeBodyPrefetches = 0
const BODY_PREFETCH_CONCURRENCY = 2

function drainBodyPrefetchQueue(): void {
  while (activeBodyPrefetches < BODY_PREFETCH_CONCURRENCY && bodyPrefetchQueue.length) {
    const task = bodyPrefetchQueue.shift()!
    activeBodyPrefetches += 1

    void (async () => {
      try {
        // 排队期间已被移出稍后读，不再为未浏览内容消耗弱网流量。
        if (!task.shouldPin()) return
        const resolved = await resolveArticleBody(task.article, undefined, task.extraSources)
        if (resolved.bodySource === 'video') return
        const cached = saveCachedBody(
          task.article,
          {
            html: resolved.contentHtml,
            bodySource: resolved.bodySource,
          },
          { pinned: task.shouldPin() },
        )
        if (cached) task.onCacheChange()
      } catch {
        // 离线或抽取失败时静默跳过；下次启动、重新收藏或实际阅读时会再试。
      } finally {
        queuedBodyIds.delete(task.article.id)
        activeBodyPrefetches -= 1
        drainBodyPrefetchQueue()
      }
    })()
  }
}

/** 稍后读是明确的离线意图，限并发补齐正文，避免弱网下同时发起大量请求。 */
function prefetchBody(task: BodyPrefetchTask): void {
  if (task.article.contentType === 'video') return
  if (hasCachedBody(task.article.id)) {
    setBodyPinned(task.article.id, task.shouldPin())
    task.onCacheChange()
    return
  }
  if (queuedBodyIds.has(task.article.id)) return

  queuedBodyIds.add(task.article.id)
  bodyPrefetchQueue.push(task)
  drainBodyPrefetchQueue()
}

export default function App() {
  const { prefs, resolvedTheme, update, replaceFromSync: replacePreferences } = usePreferences()
  const [tab, setTab] = useState<TabKey>('today')
  const [todayPullRefreshSeq, setTodayPullRefreshSeq] = useState(0)
  const [categoryId, setCategoryId] = useState<CategoryId>(
    () => defaultFeedCategoryId(visibleCategories(prefs)),
  )
  const [settingsRoute, setSettingsRoute] = useState<SettingsRoute | null>(null)
  const appUpdate = useAppUpdate({ settingsOpen: settingsRoute != null })
  const [focusReturnRoute, setFocusReturnRoute] = useState<SettingsRoute | null>(null)
  const [enabledIds, setEnabledIds] = useState<string[]>(() => loadEnabledSources() ?? DEFAULT_ENABLED)
  const presets = usePresets({
    prefs,
    enabledIds,
    updatePrefs: update,
    setEnabledIds,
  })
  /**
   * 账户与云同步都是纯附加能力：未登录时 `useCloudSync` 不创建引擎、不发任何请求，
   * 下面所有阅读、解析、缓存逻辑与它们完全解耦。
   */
  const account = useAccount()
  const syncRuntime = useMemo(
    () => ({ prefs, enabledIds, presets: presets.state }),
    [prefs, enabledIds, presets.state],
  )
  const [syncToast, setSyncToast] = useState<SyncToastModel | null>(null)
  const handleSyncEvent = useCallback((event: Parameters<typeof toastForSyncEvent>[0]) => {
    const toast = toastForSyncEvent(event)
    if (toast) setSyncToast(toast)
  }, [])
  const cloudSync = useCloudSync({
    account: account.status === 'authenticated' ? account.adapter : null,
    authenticated: account.status === 'authenticated',
    runtime: syncRuntime,
    replacePreferences,
    replaceEnabledIds: setEnabledIds,
    replacePresets: presets.replaceFromSync,
    onEvent: handleSyncEvent,
  })
  const [syncOnboardingSeen, setSyncOnboardingSeen] = useState(() => hasSeenSyncOnboarding())
  const dismissSyncOnboarding = useCallback(() => {
    markSyncOnboardingSeen()
    setSyncOnboardingSeen(true)
  }, [])
  const openAccountSync = useCallback(() => {
    setTab('me')
    setSettingsRoute({ name: 'account-sync' })
  }, [])
  /**
   * 冷启动深链 `/a/<token>`：本地解码后直接进阅读器（正文仍走 resolveBody 站内抽取）。
   * 显式写成 lazy initializer，token 也留一份给「在 App 中打开」引导条拼深链。
   * `sharedEntry` 为 null = 普通访问；`payload` 为 null = token 损坏，
   * 给中文提示后停在首页。query（如卡片页逃生门的 `?app=1`）不影响 pathname 解码。
   */
  const [sharedEntry] = useState<{ token: string; payload: SharePayload | null } | null>(() => {
    const pathname = typeof window === 'undefined' ? '' : window.location.pathname
    const token = shareTokenFromPath(pathname)
    if (!token) return null
    return { token, payload: decodeShareToken(token) }
  })
  const [reading, setReading] = useState<Article | null>(() => {
    if (!sharedEntry?.payload) return null
    return articleFromSharePayload(sharedEntry.payload, prefs.customSources)
  })
  const [deepLinkError, setDeepLinkError] = useState(sharedEntry?.payload === null)

  useEffect(() => {
    if (!sharedEntry) return
    if (sharedEntry.payload === null) {
      log.app.warn('share deep link rejected: token corrupted or truncated')
    } else {
      log.app.info('share deep link opened', sharedEntry.payload.sourceId)
    }
  }, [sharedEntry])
  /** 墨水屏中区进设置时暂存文章，从「我的」返回时恢复阅读 */
  const [readerReturnArticle, setReaderReturnArticle] = useState<Article | null>(null)
  const readerOverlayCloserRef = useRef<(() => boolean) | null>(null)
  const [eggOpen, setEggOpen] = useState(false)
  const openEgg = useCallback(() => setEggOpen(true), [])
  const { onTap: onBrandTap } = useEasterEggTrigger(openEgg)
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null)
  const [categoryFilterSourceId, setCategoryFilterSourceId] = useState<string | null>(null)

  /**
   * 功能引导：首次进首页（启动页撤除后）自动播放一次；「关于」页可重看。
   * ready 限定在无遮挡层的「速闻」页，分享深链冷启动等场景会等回到首页再播。
   */
  const tourFinish = useCallback(() => setTab('today'), [])
  const { start: startProductTourNow, stopIfActive: stopProductTourIfActive } = useProductTour({
    ready:
      tab === 'today' &&
      !reading &&
      !settingsRoute &&
      !focusSourceId &&
      !eggOpen &&
      !deepLinkError,
    setTab,
    onFinish: tourFinish,
  })

  const replayProductTour = useCallback(() => {
    setSettingsRoute(null)
    setFocusSourceId(null)
    setTab('today')
    startProductTourNow()
  }, [startProductTourNow])
  const [later, setLater] = useState<Article[]>(() => loadLaterArticles())
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIdSet('read'))
  const laterRef = useRef(later)
  /** 推荐排序经 ref 读取已读集合：打开文章返回时不重排，避免列表跳动 */
  const readIdsRef = useRef(readIds)
  readIdsRef.current = readIds
  const [cacheSnapshot, setCacheSnapshot] = useState(emptyCacheSnapshot)
  const cacheSnapshotReadyRef = useRef(false)
  const refreshCacheSnapshot = useCallback(() => {
    cacheSnapshotReadyRef.current = true
    setCacheSnapshot(readCacheSnapshot())
  }, [])
  const notifyCacheChange = useCallback(() => {
    // 首屏不主动扫正文/列表统计；等「我的 / 存储 / 历史」真正需要时再计算
    if (!cacheSnapshotReadyRef.current) return
    setCacheSnapshot(readCacheSnapshot())
  }, [])

  useEffect(() => {
    const needsSnapshot =
      tab === 'me' ||
      settingsRoute?.name === 'storage' ||
      settingsRoute?.name === 'history' ||
      settingsRoute?.name === 'later' ||
      settingsRoute?.name === 'local-search'
    if (!needsSnapshot) return
    refreshCacheSnapshot()
  }, [tab, settingsRoute, refreshCacheSnapshot])

  const regularCategories = useMemo(() => visibleCategories(prefs), [prefs])

  /**
   * 推荐候选池：严格取当前预设启用的全部信源（可见分类并集，综合贡献频道启用列表）。
   * 以内容 key 记忆 Set，避免无关偏好变化（如排版）触发就绪判定与画像重算。
   */
  const recommendScopeKey = useMemo(
    () => recommendationScopeSourceIds(prefs, enabledIds).join('|'),
    [prefs, enabledIds],
  )
  const recommendScope = useMemo(
    () => new Set(recommendScopeKey ? recommendScopeKey.split('|') : []),
    [recommendScopeKey],
  )

  /**
   * 推荐就绪进度：阈值收在 lib/recommend 内，这里拿到「已读 X / 需 Y」
   * 供设置页解释推荐栏何时出现；计数达阈值即停，开销有界。
   */
  const recommendReadiness = useMemo(
    () => recommendationReadiness({ readIds, laterArticles: later }, recommendScope),
    [readIds, later, recommendScope],
  )
  /** 推荐分类是否亮起：设置开关开启且预设内阅读达标，二者缺一不亮 */
  const recommendEnabled = prefs.recommendEnabled !== false
  const recommendReady = recommendEnabled && recommendReadiness.ready

  /** 首页轨道：推荐亮起时插到最前；默认选中与回退永远落在第一个普通分类 */
  const categories = useMemo(
    () => withRecommendCategory(regularCategories, recommendReady),
    [regularCategories, recommendReady],
  )

  // 当前分类失效（被隐藏 / 推荐熄灭 / 首次进入不可见）时退回第一个普通分类，绝不自动落到推荐
  useEffect(() => {
    if (!categories.length) return
    if (!categories.some((category) => category.id === categoryId)) {
      setCategoryId(defaultFeedCategoryId(categories))
      setCategoryFilterSourceId(null)
    }
  }, [categories, categoryId])

  // 切换预设后回到新预设的第一个普通分类：推荐池随预设而变，不静默延续推荐 Tab
  const activePresetId = presets.state.activePresetId
  const prevPresetIdRef = useRef(activePresetId)
  useEffect(() => {
    if (prevPresetIdRef.current === activePresetId) return
    prevPresetIdRef.current = activePresetId
    if (categoryId === RECOMMEND_CATEGORY_ID) {
      setCategoryId(defaultFeedCategoryId(regularCategories))
      setCategoryFilterSourceId(null)
    }
  }, [activePresetId, categoryId, regularCategories])

  const categorySourceIds = useMemo(
    () => sourceIdsForCategoryWithPrefs(categoryId, prefs, enabledIds),
    [categoryId, prefs, enabledIds],
  )

  const availableCategorySources = useMemo(
    () =>
      categorySourceIds
        .map((id) => findSource(id, prefs.customSources))
        .filter((s): s is NonNullable<ReturnType<typeof findSource>> => Boolean(s)),
    [categorySourceIds, prefs.customSources],
  )

  // 若切换分类导致已选信源不在新分类中，自动重置回全部
  useEffect(() => {
    if (categoryFilterSourceId && !categorySourceIds.includes(categoryFilterSourceId)) {
      setCategoryFilterSourceId(null)
    }
  }, [categoryFilterSourceId, categorySourceIds])

  /**
   * 只抓当前分类（或单源聚焦）已开启的源。
   * 综合 Tab 的 categorySourceIds 本身就是频道启用列表；
   * 其它分类以分类信源设置为准，不再并入全部综合源。
   */
  const fetchIds = useMemo(() => {
    const ids = new Set(categorySourceIds)
    if (focusSourceId) ids.add(focusSourceId)
    return [...ids]
  }, [categorySourceIds, focusSourceId])

  /**
   * 下拉刷新 / 加载更多 / 进度提示：与当前列表可见范围一致。
   * 选中单个信源时只更新该源；选「全部」时更新分类下全部开启源；聚焦源页只更新该源。
   */
  const listScopeIds = useMemo(() => {
    if (focusSourceId) return [focusSourceId]
    if (categoryFilterSourceId) return [categoryFilterSourceId]
    return categorySourceIds
  }, [focusSourceId, categoryFilterSourceId, categorySourceIds])

  const openSourceFeed = useCallback(
    (sourceId: string, returnTo: SettingsRoute | null = null) => {
      setFocusReturnRoute(returnTo)
      setSettingsRoute(null)
      setFocusSourceId(sourceId)
    },
    [],
  )

  const closeSourceFeed = useCallback(() => {
    setFocusSourceId(null)
    if (focusReturnRoute) {
      setSettingsRoute(focusReturnRoute)
      setFocusReturnRoute(null)
    }
  }, [focusReturnRoute])

  const closeReader = useCallback(() => {
    setReading(null)
    clearShareLocation()
  }, [])

  const dismissDeepLinkError = useCallback(() => {
    setDeepLinkError(false)
    clearShareLocation()
  }, [])

  const restoreReaderFromSettings = useCallback(() => {
    if (!readerReturnArticle) return
    setSettingsRoute(null)
    setReading(readerReturnArticle)
    setReaderReturnArticle(null)
  }, [readerReturnArticle])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let disposed = false
    let removeListener: (() => Promise<void>) | undefined

    void CapacitorApp.addListener('backButton', () => {
      if (stopProductTourIfActive()) {
        return
      }
      if (eggOpen) {
        setEggOpen(false)
        return
      }
      if (reading && readerOverlayCloserRef.current?.()) {
        return
      }
      if (reading) {
        closeReader()
        return
      }
      if (settingsRoute?.name === 'category-sources' || settingsRoute?.name === 'category-edit') {
        setSettingsRoute({ name: 'categories' })
        return
      }
      if (settingsRoute?.name === 'channels') {
        setSettingsRoute({ name: 'categories' })
        return
      }
      if (settingsRoute?.name === 'categories') {
        setSettingsRoute({ name: 'presets' })
        return
      }
      if (settingsRoute?.name === 'changelog' || settingsRoute?.name === 'licenses') {
        setSettingsRoute({ name: 'about' })
        return
      }
      if (settingsRoute?.name === 'custom-scheme') {
        setSettingsRoute({ name: 'appearance' })
        return
      }
      if (settingsRoute) {
        setSettingsRoute(null)
        return
      }
      if (readerReturnArticle) {
        restoreReaderFromSettings()
        return
      }
      if (focusSourceId) {
        closeSourceFeed()
        return
      }
      if (tab !== 'today') {
        setTab('today')
        return
      }
      void CapacitorApp.exitApp()
    }).then((handle) => {
      if (disposed) {
        void handle.remove()
        return
      }
      removeListener = () => handle.remove()
    })

    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [closeReader, closeSourceFeed, eggOpen, focusSourceId, readerReturnArticle, reading, restoreReaderFromSettings, settingsRoute, stopProductTourIfActive, tab])

  const {
    articles: fetchedArticles,
    statuses,
    refreshing,
    refreshProgress,
    loadingMore,
    lastUpdated,
    offline,
    paginationState,
    refresh,
    loadMore,
  } = useFeeds(fetchIds, notifyCacheChange, prefs.customSources)

  const prestore = usePrestore({
    prefs,
    enabledIds,
    presetId: presets.state.activePresetId,
    // 首页刷新、加载历史和主动阅读优先，自动预存不与前台关键路径争抢网络/CPU。
    suspend: refreshing || loadingMore || Boolean(reading),
  })

  // 预存清单自身携带文章元数据，离线时无需依赖 localStorage 列表缓存。
  // 当前在线/列表缓存版本覆盖同 ID 的旧元数据，随后统一按发布时间排序。
  const availableArticles = useMemo(() => {
    const byId = new Map(prestore.snapshot.articles.map((article) => [article.id, article]))
    fetchedArticles.forEach((article) => byId.set(article.id, article))
    return sortArticles([...byId.values()])
  }, [fetchedArticles, prestore.snapshot.articles])

  /**
   * 推荐栏内的刷新（下拉或顶栏按钮）即「重算推荐」：除了拉新候选，
   * 还基于最新已读 / 稍后读信号重建画像并立即重排。画像本身不落盘，
   * 每次都是即时计算，因此没有需要单独「重置」的隐藏状态。
   */
  const [recommendProfileSeq, setRecommendProfileSeq] = useState(0)
  const runRefresh = useCallback(() => {
    if (categoryId === RECOMMEND_CATEGORY_ID) {
      setRecommendProfileSeq((seq) => seq + 1)
    }
    return refresh(listScopeIds)
  }, [refresh, listScopeIds, categoryId])

  // 进入分类 / 信源集合变化时，预拉该分类已开启的源（受 autoRefreshOnCategorySwitch 开关控制）
  const bootstrapKey = fetchIds.join('|')
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const isInitialMountRef = useRef(true)
  const prevCategoryIdRef = useRef(categoryId)

  useEffect(() => {
    if (!fetchIds.length) return
    const isCategoryChange = prevCategoryIdRef.current !== categoryId
    prevCategoryIdRef.current = categoryId

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false
      void refreshRef.current(fetchIds)
      return
    }

    if (isCategoryChange && prefs.autoRefreshOnCategorySwitch === false) {
      return
    }

    void refreshRef.current(fetchIds)
  }, [bootstrapKey, categoryId, fetchIds, prefs.autoRefreshOnCategorySwitch])

  const categorySourceSet = useMemo(() => new Set(categorySourceIds), [categorySourceIds])
  const articles = useMemo(
    () => availableArticles.filter((item) => categorySourceSet.has(item.sourceId)),
    [availableArticles, categorySourceSet],
  )

  const availableArticlesRef = useRef(availableArticles)
  availableArticlesRef.current = availableArticles

  /**
   * 本地推荐画像：进入「推荐」分类时从本机信号（已读 id × 各池元数据 join、
   * 稍后读、正文缓存阅读历史）构建一次，并裁剪到当前预设的候选池——
   * 各预设画像互不串味。停留期间的下拉刷新 / 顶栏刷新经 recommendProfileSeq
   * 触发重建（重算推荐），单次已读不重算（避免读完返回列表跳动）。
   * 信号全部经 ref 读取，避免每次已读变化都重排。
   */
  const recommendProfile = useMemo(() => {
    if (categoryId !== RECOMMEND_CATEGORY_ID) return null
    void recommendProfileSeq
    const laterNow = laterRef.current
    const historyArticles = listCachedArticles(60).map((entry) => entry.article)
    return buildReadingProfile(
      scopeSignalsToSources(
        {
          readArticles: collectReadArticles(readIdsRef.current, [
            laterNow,
            historyArticles,
            availableArticlesRef.current,
          ]),
          laterArticles: laterNow,
        },
        recommendScope,
      ),
    )
  }, [categoryId, recommendScope, recommendProfileSeq])

  /** 推荐结果：排除已读与稍后读（稍后读有专页），冷启动退化为按时间 */
  const recommendedArticles = useMemo(() => {
    if (!recommendProfile) return null
    const excludeIds = new Set(readIdsRef.current)
    for (const item of laterRef.current) excludeIds.add(item.id)
    return rankRecommendations(articles, recommendProfile, { excludeIds })
  }, [articles, recommendProfile])

  /** 单源筛选时保持数组引用稳定：每次渲染现算会让列表翻译等依赖 articles 的 effect 反复中止重启 */
  const displayedArticles = useMemo(() => {
    const base = recommendedArticles ?? articles
    return categoryFilterSourceId
      ? base.filter((item) => item.sourceId === categoryFilterSourceId)
      : base
  }, [articles, recommendedArticles, categoryFilterSourceId])

  const articlesForCategory = useCallback(
    (id: CategoryId) => {
      const ids = new Set(sourceIdsForCategoryWithPrefs(id, prefs, enabledIds))
      return availableArticles.filter((item) => ids.has(item.sourceId))
    },
    [availableArticles, prefs, enabledIds],
  )

  const handleCategoryChange = useCallback((newId: CategoryId) => {
    setCategoryId(newId)
    setCategoryFilterSourceId(null)
  }, [])

  const laterIds = useMemo(() => new Set(later.map((item) => item.id)), [later])

  useEffect(() => saveEnabledSources(enabledIds), [enabledIds])
  useEffect(() => saveLaterArticles(later), [later])
  useEffect(() => saveIdSet('read', readIds), [readIds])

  useEffect(() => {
    laterRef.current = later
    const pinnedIds = new Set(later.map((item) => item.id))
    syncBodyPins(pinnedIds)

    later.forEach((article) => {
      if (article.contentType === 'video' || hasCachedBody(article.id)) return
      prefetchBody({
        article,
        shouldPin: () => laterRef.current.some((item) => item.id === article.id),
        onCacheChange: notifyCacheChange,
        extraSources: prefs.customSources,
      })
    })
    notifyCacheChange()
  }, [later, notifyCacheChange, prefs.customSources])

  const openArticle = useCallback((article: Article) => {
    setReaderReturnArticle(null)
    setReading(article)
    setReadIds((prev) => new Set(prev).add(article.id))
  }, [])

  const customSourcesRef = useRef(prefs.customSources)
  customSourcesRef.current = prefs.customSources

  /**
   * App 唤起深链：Android 的 https App Links 与 `newsnook://` 自定义 scheme
   * 都经 Capacitor 的 launchUrl（冷启动）/ appUrlOpen（运行中）送进来，
   * 与 Web 冷启动共用同一套 token 解码，直接进阅读器。
   * 同一 URL 只处理一次——冷启动时两个入口可能重复上报。
   */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let disposed = false
    let removeListener: (() => Promise<void>) | undefined
    const handledUrls = new Set<string>()

    const openFromUrl = (url: string) => {
      if (!url || handledUrls.has(url)) return
      handledUrls.add(url)
      // 同步通知点开后落到「账户与同步」，不是分享深链
      if (syncRouteFromAppUrl(url)) {
        openAccountSync()
        return
      }
      const token = shareTokenFromAppUrl(url)
      if (!token) return
      const payload = decodeShareToken(token)
      if (!payload) {
        log.app.warn('app deep link rejected: token corrupted or truncated')
        setDeepLinkError(true)
        return
      }
      log.app.info('app deep link opened', payload.sourceId)
      openArticle(articleFromSharePayload(payload, customSourcesRef.current))
    }

    void CapacitorApp.getLaunchUrl()
      .then((launch) => {
        if (!disposed && launch?.url) openFromUrl(launch.url)
      })
      .catch(() => {})

    void CapacitorApp.addListener('appUrlOpen', (event) => {
      if (!disposed) openFromUrl(event.url)
    }).then((handle) => {
      if (disposed) {
        void handle.remove()
        return
      }
      removeListener = () => handle.remove()
    })

    return () => {
      disposed = true
      if (removeListener) void removeListener()
    }
  }, [openAccountSync, openArticle])

  /**
   * 「在 App 中打开」引导条：网页版打开分享深链、且是 Android 浏览器时才给。
   * 链接由 lib/appDeepLink 按浏览器选 intent:// 或 newsnook://，
   * 未安装 App 时点击无事发生，网页阅读不受影响。
   */
  const [openInAppDismissed, setOpenInAppDismissed] = useState(false)
  const openInAppUrl = useMemo(() => {
    if (!sharedEntry?.payload) return null
    if (Capacitor.isNativePlatform()) return null
    if (typeof navigator === 'undefined' || !isAndroidBrowser(navigator.userAgent)) return null
    return preferredOpenInAppUrl(sharedEntry.token, navigator.userAgent)
  }, [sharedEntry])
  const showOpenInAppBanner = Boolean(
    openInAppUrl &&
      !openInAppDismissed &&
      reading &&
      sharedEntry?.payload &&
      reading.originUrl === sharedEntry.payload.originUrl,
  )
  /**
   * 同步介绍只在功能引导之后、首页无遮挡时露一次面，且只对未登录用户。
   * 它是可选加分项，不参与 driver.js 的引导流程，两个按钮都会记下「看过」。
   */
  const showSyncOnboarding =
    !syncOnboardingSeen &&
    account.status === 'anonymous' &&
    hasSeenProductTour() &&
    tab === 'today' &&
    !reading &&
    !settingsRoute &&
    !focusSourceId &&
    !eggOpen &&
    !deepLinkError

  const toggleLater = useCallback((article: Article) => {
    if (laterRef.current.some((item) => item.id === article.id)) {
      const next = laterRef.current.filter((item) => item.id !== article.id)
      laterRef.current = next
      setLater(next)
      setBodyPinned(article.id, false)
      notifyCacheChange()
      return
    }

    const next = [article, ...laterRef.current]
    laterRef.current = next
    setLater(next)
    prefetchBody({
      article,
      shouldPin: () => laterRef.current.some((item) => item.id === article.id),
      onCacheChange: notifyCacheChange,
      extraSources: prefs.customSources,
    })
  }, [notifyCacheChange, prefs.customSources])

  const removeLater = useCallback((id: string) => {
    const next = laterRef.current.filter((item) => item.id !== id)
    laterRef.current = next
    setLater(next)
    setBodyPinned(id, false)
    notifyCacheChange()
  }, [notifyCacheChange])

  const toggleSource = useCallback((id: string) => {
    setEnabledIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }, [])

  const focusSource = focusSourceId ? findSource(focusSourceId, prefs.customSources) : undefined
  const focusArticles = useMemo(
    () =>
      focusSource
        ? availableArticles.filter((item) => item.sourceId === focusSource.id)
        : [],
    [availableArticles, focusSource],
  )

  const activeCategory = categories.find((item) => item.id === categoryId)

  const presetSwitcherItems = useMemo(() => {
    const activeId = presets.state.activePresetId
    return [
      ...presets.builtins.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        builtin: true,
        active: preset.id === activeId,
      })),
      ...presets.state.userPresets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        builtin: false,
        active: preset.id === activeId,
      })),
    ]
  }, [presets.builtins, presets.state])

  const frameworkSiteCount = useMemo(
    () => (prefs.customSources ?? []).filter((s) => s.frameworkHint && s.kind === 'web-catalog').length,
    [prefs.customSources],
  )

  const presetSwitcherConfig = useMemo(() => ({
    activeName: presets.activePreset?.name ?? '场景预设',
    items: presetSwitcherItems,
    onSelect: (id: string) => presets.applyPreset(id),
    onManage: () => setSettingsRoute({ name: 'presets' }),
    onSites: frameworkSiteCount > 0 ? () => setTab('sites') : undefined,
    siteCount: frameworkSiteCount,
  }), [presets, presetSwitcherItems, frameworkSiteCount])

  const cachedHistory = useMemo(
    () =>
      cacheSnapshot.history
        .filter((entry) => !laterIds.has(entry.article.id))
        .map((entry) => entry.article),
    [cacheSnapshot.history, laterIds],
  )

  const customSourcesSummary = useMemo(() => {
    const count = prefs.customSources?.length ?? 0
    return count
      ? `${count} 个自建订阅源 · 支持 OPML 导入与导出`
      : '添加 RSS/Atom 订阅源 · OPML 导入与导出'
  }, [prefs.customSources])

  // 缓存模块显式刷新快照，避免返回设置页后显示旧统计。
  const storageSummary = useMemo(() => {
    if (tab !== 'me') return ''
    const bytes = cacheSnapshot.bodies.bytes + cacheSnapshot.lists.bytes + prestore.snapshot.stats.bytes
    const size =
      bytes === 0
        ? '0 KB'
        : bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${prestore.snapshot.stats.articleCount} 篇预存 · ${cacheSnapshot.bodies.count} 篇阅读缓存 · 占用 ${size}`
  }, [cacheSnapshot, prestore.snapshot.stats.articleCount, prestore.snapshot.stats.bytes, tab])

  const typographySummary = useMemo(() => {
    const family = FONT_FAMILY_OPTIONS.find((item) => item.id === prefs.typography.fontFamily)
    const scale = FONT_SCALE_OPTIONS.find((item) => item.value === prefs.typography.fontScale)
    const indent = prefs.typography.firstLineIndent ? ' · 首行缩进' : ''
    return `${family?.label ?? '黑体'} · 字号${scale?.label ?? '自定义'} · 行高 ${prefs.typography.lineHeight}${indent}`
  }, [prefs.typography])

  const appearanceSummary = useMemo(() => {
    const mode = THEME_MODES.find((item) => item.id === prefs.theme)
    const scheme = THEME_SCHEMES.find((item) => item.id === prefs.scheme)
    const current = resolvedTheme === 'dark' ? '夜读深色' : '昼读浅色'
    const themeSummary =
      prefs.theme === 'system'
        ? `跟随系统 · 当前${current}`
        : `${mode?.label ?? '夜读'} · ${mode?.caption ?? ''}`
    return `${scheme?.label ?? '墨问'} · ${themeSummary}`
  }, [prefs.scheme, prefs.theme, resolvedTheme])

  const translationSummary = useMemo(
    () =>
      `${translationProviderLabel(prefs.translation.provider)} · ${translationDisplayModeLabel(prefs.translation.displayMode)} · ${translationLanguageLabel(prefs.translation.sourceLanguage)} → ${translationLanguageLabel(prefs.translation.targetLanguage)}`,
    [prefs.translation],
  )

  const proxySummary = useMemo(() => {
    const mode = proxyModeLabel(prefs.proxy.mode)
    if (prefs.proxy.mode === 'off') return '未启用'
    return `${mode} · ${prefs.proxy.proxyUrl ? '已配置' : '未填写地址'}`
  }, [prefs.proxy])

  const renderSettings = () => {
    if (!settingsRoute) return null

    if (settingsRoute.name === 'typography') {
      return (
        <TypographyScreen
          prefs={prefs}
          onChange={(patch: Partial<TypographyPrefs>) =>
            update((prev) => updateTypography(prev, patch))
          }
          onReset={() => update(resetTypography)}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'appearance') {
      return (
        <AppearanceScreen
          theme={prefs.theme}
          resolved={resolvedTheme}
          scheme={prefs.scheme}
          customScheme={prefs.customScheme}
          einkMode={Boolean(prefs.einkMode)}
          onChange={(theme) => update((prev) => setThemeMode(prev, theme))}
          onSchemeChange={(scheme) => update((prev) => selectThemeScheme(prev, scheme))}
          onEditCustomScheme={() => setSettingsRoute({ name: 'custom-scheme' })}
          onEinkModeChange={(enabled) => update((prev) => setEinkMode(prev, enabled))}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'custom-scheme') {
      return (
        <CustomSchemeScreen
          customScheme={prefs.customScheme ?? schemeSeedColors('ink')}
          resolved={resolvedTheme}
          onChange={(mode, colors) => update((prev) => setCustomSchemeColors(prev, mode, colors))}
          onBack={() => setSettingsRoute({ name: 'appearance' })}
        />
      )
    }

    if (settingsRoute.name === 'storage') {
      return (
        <StorageScreen
          laterCount={later.length}
          usage={{ bodies: cacheSnapshot.bodies, lists: cacheSnapshot.lists }}
          prestore={{
            enabled: prefs.prestore.enabled,
            perSourceLimit: prefs.prestore.perSourceLimit,
            sourceCount: prestore.sourceCount,
            presetName: presets.activePreset?.name ?? '当前预设',
            stats: prestore.snapshot.stats,
            syncing: prestore.syncing,
            progress: prestore.progress,
            error: prestore.error,
            onEnabledChange: (enabled) =>
              update((prev) => setPrestoreEnabled(prev, enabled)),
            onPerSourceLimitChange: (limit) =>
              update((prev) => setPrestorePerSourceLimit(prev, limit)),
            onSync: prestore.syncNow,
            onClear: prestore.clear,
          }}
          onCacheChange={notifyCacheChange}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'translation') {
      return (
        <TranslationScreen
          prefs={prefs.translation}
          onChange={(translation) => update((prev) => ({ ...prev, translation }))}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'proxy') {
      return (
        <ProxyScreen
          prefs={prefs.proxy}
          wifiOnlyAutoLoadMedia={Boolean(prefs.wifiOnlyAutoLoadMedia)}
          onChange={(proxy) => update((prev) => ({ ...prev, proxy }))}
          onWifiOnlyAutoLoadMediaChange={(enabled) =>
            update((prev) => setWifiOnlyAutoLoadMedia(prev, enabled))
          }
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'presets') {
      return (
        <PresetListScreen
          state={presets.state}
          builtins={presets.builtins}
          onApply={(id) => {
            presets.applyPreset(id)
            setSettingsRoute(null)
            setTab('today')
          }}
          onEditPreset={(id) => {
            if (presets.state.activePresetId !== id) {
              presets.applyPreset(id)
            }
            setSettingsRoute({ name: 'categories', returnTo: 'presets' })
          }}
          onEditLayout={() => setSettingsRoute({ name: 'categories', returnTo: 'presets' })}
          onSaveAs={(name) => presets.saveAs(name)}
          onCreateBlank={(name) => presets.createBlank(name)}
          onRestoreFactory={(id) => presets.restoreFactory(id)}
          onRename={(id, name) => presets.rename(id, name)}
          onDelete={(id) => presets.remove(id)}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'custom-sources') {
      return (
        <CustomSourcesScreen
          prefs={prefs}
          onAddCustomSource={(source, targetCatId) =>
            update((prev) => addCustomSource(prev, source, targetCatId).nextPrefs)
          }
          onUpdateCustomSource={(sourceId, patch) =>
            update((prev) => updateCustomSource(prev, sourceId, patch))
          }
          onDeleteCustomSource={(sourceId) =>
            update((prev) => deleteCustomSource(prev, sourceId))
          }
          onDeleteCustomSources={(sourceIds) =>
            update((prev) => deleteCustomSources(prev, sourceIds))
          }
          onBatchImport={(sources, categories) =>
            update((prev) => batchImportSourcesAndCategories(prev, sources, categories))
          }
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'channels') {
      return (
        <ChannelsScreen
          allSources={allRegisteredSources(prefs)}
          enabledIds={enabledIds}
          statuses={statuses}
          onToggle={toggleSource}
          onInspect={(id) => openSourceFeed(id, { name: 'channels' })}
          onBack={() => setSettingsRoute({ name: 'categories' })}
        />
      )
    }

    if (settingsRoute.name === 'category-sources') {
      return (
        <CategorySourcesScreen
          categoryId={settingsRoute.categoryId}
          prefs={prefs}
          onToggleSource={(id, sourceId) =>
            update((prev) => toggleCategorySource(prev, id, sourceId))
          }
          onReset={(id) => update((prev) => resetCategorySources(prev, id))}
          onBack={() => setSettingsRoute({ name: 'categories' })}
        />
      )
    }

    if (settingsRoute.name === 'category-edit') {
      return (
        <CategoryEditScreen
          categoryId={settingsRoute.categoryId}
          prefs={prefs}
          onSave={(draft) => {
            if (settingsRoute.categoryId) {
              update((prev) =>
                updateCustomCategory(prev, settingsRoute.categoryId!, draft),
              )
            } else {
              update((prev) => addCustomCategory(prev, draft).nextPrefs)
            }
            setSettingsRoute({ name: 'categories' })
          }}
          onDelete={(id) => {
            update((prev) => deleteCustomCategory(prev, id))
            setSettingsRoute({ name: 'categories' })
          }}
          onBack={() => setSettingsRoute({ name: 'categories' })}
        />
      )
    }

    if (settingsRoute.name === 'later') {
      return (
        <LaterScreen
          later={later}
          onOpen={openArticle}
          onRemoveLater={removeLater}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'history') {
      return (
        <HistoryScreen
          history={cachedHistory}
          onOpen={openArticle}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'local-search') {
      return (
        <LocalSearchScreen
          feedArticles={availableArticles}
          later={later}
          history={cachedHistory}
          readIds={readIds}
          laterIds={laterIds}
          onOpen={(article) => {
            setSettingsRoute(null)
            openArticle(article)
          }}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'account-sync') {
      return (
        <AccountSyncScreen
          account={account}
          sync={cloudSync}
          runtime={syncRuntime}
          onBack={() => setSettingsRoute(null)}
        />
      )
    }

    if (settingsRoute.name === 'about') {
      return (
        <AboutScreen
          onBack={() => setSettingsRoute(null)}
          resolvedTheme={resolvedTheme}
          updateSupported={appUpdate.supported}
          updateCaption={appUpdate.manualCaption}
          hasUpdate={appUpdate.hasUpdate}
          availableVersion={appUpdate.availableVersion}
          onCheckUpdate={() => void appUpdate.promptManualCheck()}
          onOpenChangelog={() => setSettingsRoute({ name: 'changelog' })}
          onOpenLicenses={() => setSettingsRoute({ name: 'licenses' })}
          onReplayTour={replayProductTour}
          flavorSwitchSupported={appUpdate.supported}
          currentChannelLabel={appUpdate.currentChannel === 'local' ? '离线翻译版' : '云端版'}
          flavorSwitchTitle={
            appUpdate.oppositeChannel === 'local' ? '切换到离线翻译版' : '切换到云端版'
          }
          flavorSwitchCaption={appUpdate.flavorSwitchCaption}
          onSwitchFlavor={appUpdate.onPromptFlavorSwitch}
        />
      )
    }

    if (settingsRoute.name === 'changelog') {
      return <ChangelogScreen onBack={() => setSettingsRoute({ name: 'about' })} />
    }

    if (settingsRoute.name === 'licenses') {
      return <OpenSourceScreen onBack={() => setSettingsRoute({ name: 'about' })} />
    }

    return (
      <CategorySettingsScreen
        prefs={prefs}
        enabledCount={enabledIds.length}
        presetLabel={presets.activePreset?.name}
        restoreFactory={Boolean(presets.activePreset?.builtin)}
        recommend={{
          enabled: recommendEnabled,
          ready: recommendReadiness.ready,
          scopedDocs: recommendReadiness.scopedDocs,
          requiredDocs: recommendReadiness.requiredDocs,
          onChange: (enabled) => update((prev) => setRecommendEnabled(prev, enabled)),
        }}
        onReorder={(order) => update((prev) => setCategoryOrder(prev, order))}
        onToggleVisible={(id) => update((prev) => toggleCategoryVisible(prev, id))}
        onToggleAutoRefresh={(enabled) =>
          update((prev) => setAutoRefreshOnCategorySwitch(prev, enabled))
        }
        onEditSources={(id) => setSettingsRoute({ name: 'category-sources', categoryId: id })}
        onEditCategory={(id) => setSettingsRoute({ name: 'category-edit', categoryId: id })}
        onNewCategory={() => setSettingsRoute({ name: 'category-edit' })}
        onOpenChannels={() => setSettingsRoute({ name: 'channels' })}
        onResetLayout={(opts) => {
          if (presets.activePreset?.builtin) {
            presets.restoreFactory()
            return
          }
          update((prev) => resetCategoryLayout(prev, opts))
        }}
        onBack={() =>
          setSettingsRoute(
            settingsRoute.name === 'categories' && settingsRoute.returnTo === 'presets'
              ? { name: 'presets' }
              : null,
          )
        }
      />
    )
  }

  const renderTab = () => {
    if (focusSource) {
      return (
        <FeedScreen
          title={focusSource.name}
          caption={focusSource.url.replace(/^https?:\/\//, '').slice(0, 38)}
          articles={focusArticles}
          statuses={statuses.filter((status) => status.sourceId === focusSource.id)}
          refreshing={refreshing}
          refreshProgress={refreshProgress}
          loadingMore={loadingMore}
          paginationState={paginationState([focusSource.id])}
          lastUpdated={lastUpdated}
          readIds={readIds}
          laterIds={laterIds}
          prestoredIds={prestore.articleIds}
          showLead={false}
          offline={offline}
          translationPrefs={prefs.translation}
          customSources={prefs.customSources}
          onRefresh={runRefresh}
          onLoadMore={() => void loadMore([focusSource.id])}
          onOpen={openArticle}
          onBack={closeSourceFeed}
          searchTemplate={focusSource.frameworkHint?.searchTemplate}
          frameworkCategories={focusSource.frameworkHint?.categories}
        />
      )
    }

    if (tab === 'me') {
      return (
        <MeScreen
          later={later}
          history={cachedHistory}
          readCount={readIds.size}
          customSourcesSummary={customSourcesSummary}
          categoriesSummary={`${regularCategories.length} 个启用分类 · ${
            prefs.autoRefreshOnCategorySwitch !== false ? '切换自动刷新开启' : '切换自动刷新已关闭'
          }`}
          presetsSummary={`${presets.activePreset?.name ?? '未选择'} · ${regularCategories.length} 分类 · ${enabledIds.length} 源`}
          typographySummary={typographySummary}
          appearanceSummary={appearanceSummary}
          translationSummary={translationSummary}
          proxySummary={proxySummary}
          storageSummary={storageSummary}
          accountSummary={syncStatusCaption(cloudSync.status, {
            authenticated: account.status === 'authenticated',
          })}
          hasUpdate={appUpdate.hasUpdate}
          availableVersion={appUpdate.availableVersion}
          onBackToReading={readerReturnArticle ? restoreReaderFromSettings : undefined}
          onOpenLater={() => setSettingsRoute({ name: 'later' })}
          onOpenHistory={() => setSettingsRoute({ name: 'history' })}
          onOpenLocalSearch={() => setSettingsRoute({ name: 'local-search' })}
          onOpenCustomSources={() => setSettingsRoute({ name: 'custom-sources' })}
          onOpenCategories={() => setSettingsRoute({ name: 'categories', returnTo: 'me' })}
          onOpenPresets={() => setSettingsRoute({ name: 'presets' })}
          onOpenTypographySettings={() => setSettingsRoute({ name: 'typography' })}
          onOpenAppearanceSettings={() => setSettingsRoute({ name: 'appearance' })}
          onOpenTranslationSettings={() => setSettingsRoute({ name: 'translation' })}
          onOpenProxySettings={() => setSettingsRoute({ name: 'proxy' })}
          onOpenStorageSettings={() => setSettingsRoute({ name: 'storage' })}
          onOpenAccountSync={() => setSettingsRoute({ name: 'account-sync' })}
          onOpenAbout={() => setSettingsRoute({ name: 'about' })}
        />
      )
    }

    if (tab === 'sites') {
      const frameworkSites = (prefs.customSources ?? [])
        .filter((s) => s.frameworkHint && s.kind === 'web-catalog')
        .map((s) => ({ source: s, hint: s.frameworkHint! }))
      return (
        <SiteScreen
          sites={frameworkSites}
          readIds={readIds}
          onOpen={openArticle}
          onBack={() => setTab('today')}
        />
      )
    }

    const activeFilterSource = categoryFilterSourceId
      ? findSource(categoryFilterSourceId, prefs.customSources)
      : null

    return (
      <FeedScreen
        title={BRAND_TITLE}
        caption={
          activeFilterSource
            ? `${chineseDate()} · ${activeCategory?.label ?? ''} · ${activeFilterSource.name}`
            : `${chineseDate()} · ${activeCategory?.label ?? ''} · ${categorySourceIds.length} 源`
        }
        articles={displayedArticles}
        statuses={statuses.filter((status) => listScopeIds.includes(status.sourceId))}
        refreshing={refreshing}
        refreshProgress={refreshProgress}
        loadingMore={loadingMore}
        paginationState={paginationState(listScopeIds)}
        lastUpdated={lastUpdated}
        readIds={readIds}
        laterIds={laterIds}
        prestoredIds={prestore.articleIds}
        showLead
        offline={offline}
        categories={categories}
        categoryId={categoryId}
        onCategoryChange={handleCategoryChange}
        availableSources={availableCategorySources}
        selectedSourceId={categoryFilterSourceId}
        onSelectSource={setCategoryFilterSourceId}
        articlesForCategory={articlesForCategory}
        presetSwitcher={presetSwitcherConfig}
        translationPrefs={prefs.translation}
        customSources={prefs.customSources}
        onRefresh={runRefresh}
        onLoadMore={() => void loadMore(listScopeIds)}
        onOpen={openArticle}
        onBrandTap={onBrandTap}
        onOpenLocalSearch={() => setSettingsRoute({ name: 'local-search' })}
        pullRefreshSeq={todayPullRefreshSeq}
        searchTemplate={activeFilterSource?.frameworkHint?.searchTemplate}
        frameworkCategories={activeFilterSource?.frameworkHint?.categories}
      />
    )
  }

  return (
    <AppShell>
      <div className="flex h-full w-full flex-row overflow-hidden">
        <DesktopSidebar
          categories={categories}
          activeCategoryId={categoryId}
          onCategoryChange={(newId) => {
            setCategoryId(newId)
            setCategoryFilterSourceId(null)
            setTab('today')
            setSettingsRoute(null)
            setFocusSourceId(null)
          }}
          activeTab={tab}
          settingsRouteName={settingsRoute ? settingsRoute.name : null}
          laterCount={later.length}
          historyCount={cachedHistory.length}
          theme={prefs.theme}
          resolvedTheme={resolvedTheme}
          hasUpdate={appUpdate.hasUpdate}
          onToggleTheme={() => {
            update((prev) => setThemeMode(prev, resolvedTheme === 'dark' ? 'light' : 'dark'))
          }}
          presetSwitcher={{
            activeName: presets.activePreset?.name ?? '场景预设',
            items: presetSwitcherItems,
            onSelect: (id) => presets.applyPreset(id),
            onManage: () => setSettingsRoute({ name: 'presets' }),
            onSites: frameworkSiteCount > 0 ? () => setTab('sites') : undefined,
            siteCount: frameworkSiteCount,
          }}
          onNavigateHome={() => {
            setTab('today')
            setSettingsRoute(null)
            setFocusSourceId(null)
          }}
          onNavigateLater={() => setSettingsRoute({ name: 'later' })}
          onNavigateHistory={() => setSettingsRoute({ name: 'history' })}
          onNavigateSettings={() => {
            setTab('me')
            setSettingsRoute(null)
          }}
          onNavigateAbout={() => setSettingsRoute({ name: 'about' })}
          onBrandTap={onBrandTap}
        />

        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-ink">
          {renderTab()}

          {!focusSource && (
            <TabBar
              active={tab}
              laterCount={later.length}
              hasUpdate={appUpdate.hasUpdate}
              onChange={(key) => {
                setFocusSourceId(null)
                setFocusReturnRoute(null)
                if (key !== 'me') setReaderReturnArticle(null)
                setTab(key)
              }}
              onTodayDoubleTap={() => setTodayPullRefreshSeq((seq) => seq + 1)}
            />
          )}

          {renderSettings()}
        </main>
      </div>

      <DlnaCastBanner />

      <EasterEggShell open={eggOpen} onClose={() => setEggOpen(false)}>
        <CurrentEasterEgg onClose={() => setEggOpen(false)} />
      </EasterEggShell>

      {reading && (
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="正在打开文章"
              className="absolute inset-0 z-30 flex items-center justify-center bg-ink"
              style={{ paddingTop: 'var(--sat)' }}
            >
              {/* 分享深链落地时明示状态，避免看起来像闪了一下首页 */}
              {sharedEntry?.payload ? (
                <span className="font-mono text-[12px] tracking-[0.12em] text-paper-muted">
                  正在打开分享的文章…
                </span>
              ) : null}
            </div>
          }
        >
          <ReaderScreen
            article={reading}
            saved={laterIds.has(reading.id)}
            onClose={closeReader}
            onToggleLater={toggleLater}
            onCacheChange={notifyCacheChange}
            overlayCloserRef={readerOverlayCloserRef}
            translationPrefs={prefs.translation}
            customSources={prefs.customSources}
            einkMode={Boolean(prefs.einkMode)}
            wifiOnlyAutoLoadMedia={Boolean(prefs.wifiOnlyAutoLoadMedia)}
            fontScale={prefs.typography.fontScale}
            onTypographyChange={(patch) => update((prev) => updateTypography(prev, patch))}
            onOpenSettings={() => {
              setReaderReturnArticle(reading)
              setReading(null)
              setSettingsRoute(null)
              setTab('me')
            }}
            onOpenRelated={openArticle}
          />
        </Suspense>
      )}

      {showOpenInAppBanner && openInAppUrl && (
        <OpenInAppBanner href={openInAppUrl} onDismiss={() => setOpenInAppDismissed(true)} />
      )}

      <SyncOnboardingPrompt
        open={showSyncOnboarding}
        onSignIn={() => {
          dismissSyncOnboarding()
          openAccountSync()
        }}
        onDismiss={dismissSyncOnboarding}
      />

      {/* 阅读器盖在最上层时不打扰，等回到列表再说 */}
      <SyncToast
        toast={reading ? null : syncToast}
        onDismiss={() => setSyncToast(null)}
        onAction={openAccountSync}
      />


      <ConfirmDialog
        open={deepLinkError}
        title="打不开这条分享"
        message="链接可能已损坏或被截断。请让分享的人重新发一次，或先在首页看看今天的更新。"
        confirmLabel="知道了"
        cancelLabel="关闭"
        onConfirm={dismissDeepLinkError}
        onCancel={dismissDeepLinkError}
      />
      <UpdateDialog
        open={appUpdate.dialogOpen}
        release={appUpdate.dialogRelease}
        localVersion={appUpdate.localVersion}
        onUpdate={appUpdate.onUpdate}
        onLater={appUpdate.onLater}
        onSkip={appUpdate.onSkip}
      />
      <ConfirmDialog
        open={appUpdate.installPermissionOpen}
        title="需要安装权限"
        message="更新需要允许安装未知应用。请在系统设置中开启后返回继续。"
        confirmLabel="去设置"
        cancelLabel="取消"
        onConfirm={appUpdate.onConfirmInstallPermission}
        onCancel={appUpdate.onCancelInstallPermission}
      />
      <ConfirmDialog
        open={appUpdate.flavorConfirmOpen}
        title="切换安装包"
        message={appUpdate.flavorConfirmMessage}
        confirmLabel="下载并安装"
        cancelLabel="取消"
        onConfirm={() => void appUpdate.onConfirmFlavorSwitch()}
        onCancel={appUpdate.onCancelFlavorSwitch}
      />
      <ConfirmDialog
        open={appUpdate.flavorErrorOpen}
        title="无法切换"
        message={appUpdate.flavorErrorMessage}
        confirmLabel="知道了"
        cancelLabel="关闭"
        onConfirm={appUpdate.onDismissFlavorError}
        onCancel={appUpdate.onDismissFlavorError}
      />
    </AppShell>
  )
}
