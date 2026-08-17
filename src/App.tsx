import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { AppShell } from './components/AppShell'
import { DesktopSidebar } from './components/DesktopSidebar'
import { TabBar, type TabKey } from './components/TabBar'
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
import { resolveArticleBody } from './lib/resolveBody'
import {
  listCacheStats,
  loadEnabledSources,
  loadIdSet,
  loadLaterArticles,
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
import { AboutScreen } from './screens/settings/AboutScreen'
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
import { UpdateDialog } from './features/appUpdate/UpdateDialog'
import { useAppUpdate } from './features/appUpdate/useAppUpdate'
import {
  translationDisplayModeLabel,
  translationLanguageLabel,
  translationProviderLabel,
} from './features/translation/config'
import type { CategoryId } from './sources/categories'
import {
  FONT_FAMILY_OPTIONS,
  FONT_SCALE_OPTIONS,
  addCustomCategory,
  addCustomSource,
  allRegisteredSources,
  batchImportSourcesAndCategories,
  deleteCustomCategory,
  deleteCustomSource,
  resetCategoryLayout,
  resetCategorySources,
  resetTypography,
  setAutoRefreshOnCategorySwitch,
  setCategoryOrder,
  setEinkMode,
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
  type TypographyPrefs,
} from './sources/preferences'
import { SOURCES, findSource } from './sources/registry'
import { BUILTIN_PRESETS } from './sources/presets'

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
  const { prefs, resolvedTheme, update } = usePreferences()
  const [tab, setTab] = useState<TabKey>('today')
  const [todayPullRefreshSeq, setTodayPullRefreshSeq] = useState(0)
  const [categoryId, setCategoryId] = useState<CategoryId>(
    () => visibleCategories(prefs)[0]?.id ?? 'mix',
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
  const [reading, setReading] = useState<Article | null>(null)
  /** 墨水屏中区进设置时暂存文章，从「我的」返回时恢复阅读 */
  const [readerReturnArticle, setReaderReturnArticle] = useState<Article | null>(null)
  const readerOverlayCloserRef = useRef<(() => boolean) | null>(null)
  const [eggOpen, setEggOpen] = useState(false)
  const openEgg = useCallback(() => setEggOpen(true), [])
  const { onTap: onBrandTap } = useEasterEggTrigger(openEgg)
  const [focusSourceId, setFocusSourceId] = useState<string | null>(null)
  const [categoryFilterSourceId, setCategoryFilterSourceId] = useState<string | null>(null)
  const [later, setLater] = useState<Article[]>(() => loadLaterArticles())
  const [readIds, setReadIds] = useState<Set<string>>(() => loadIdSet('read'))
  const laterRef = useRef(later)
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
      settingsRoute?.name === 'later'
    if (!needsSnapshot) return
    refreshCacheSnapshot()
  }, [tab, settingsRoute, refreshCacheSnapshot])

  const categories = useMemo(() => visibleCategories(prefs), [prefs])

  // 当前分类被隐藏（或首次进入时默认分类不可见）时退回第一个可见分类
  useEffect(() => {
    if (!categories.length) return
    if (!categories.some((category) => category.id === categoryId)) {
      setCategoryId(categories[0].id)
      setCategoryFilterSourceId(null)
    }
  }, [categories, categoryId])

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
      if (eggOpen) {
        setEggOpen(false)
        return
      }
      if (reading && readerOverlayCloserRef.current?.()) {
        return
      }
      if (reading) {
        setReading(null)
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
  }, [closeSourceFeed, eggOpen, focusSourceId, readerReturnArticle, reading, restoreReaderFromSettings, settingsRoute, tab])

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

  const runRefresh = useCallback(() => refresh(listScopeIds), [refresh, listScopeIds])

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
    () => fetchedArticles.filter((item) => categorySourceSet.has(item.sourceId)),
    [fetchedArticles, categorySourceSet],
  )

  const articlesForCategory = useCallback(
    (id: CategoryId) => {
      const ids = new Set(sourceIdsForCategoryWithPrefs(id, prefs, enabledIds))
      return fetchedArticles.filter((item) => ids.has(item.sourceId))
    },
    [fetchedArticles, prefs, enabledIds],
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
        ? fetchedArticles.filter((item) => item.sourceId === focusSource.id)
        : [],
    [fetchedArticles, focusSource],
  )

  const activeCategory = categories.find((item) => item.id === categoryId)

  const presetSwitcherItems = useMemo(() => {
    const activeId = presets.state.activePresetId
    const activeUser = presets.state.userPresets.find((item) => item.id === activeId)
    const basedOn = activeUser?.basedOnBuiltinId

    return [
      ...BUILTIN_PRESETS.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        builtin: true,
        active: basedOn === preset.id,
      })),
      ...presets.state.userPresets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        builtin: false,
        active: preset.id === activeId,
      })),
    ]
  }, [presets.state])

  const presetSwitcherConfig = useMemo(() => ({
    activeName: presets.activePreset?.name ?? '场景预设',
    items: presetSwitcherItems,
    onSelect: (id: string) => presets.applyPreset(id),
    onManage: () => setSettingsRoute({ name: 'presets' }),
  }), [presets, presetSwitcherItems])

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
    const bytes = cacheSnapshot.bodies.bytes + cacheSnapshot.lists.bytes
    const size =
      bytes === 0
        ? '0 KB'
        : bytes < 1024 * 1024
        ? `${Math.max(1, Math.round(bytes / 1024))} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${cacheSnapshot.bodies.count} 篇正文离线可读 · 占用 ${size}`
  }, [cacheSnapshot, tab])

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
        onReorder={(order) => update((prev) => setCategoryOrder(prev, order))}
        onToggleVisible={(id) => update((prev) => toggleCategoryVisible(prev, id))}
        onToggleAutoRefresh={(enabled) =>
          update((prev) => setAutoRefreshOnCategorySwitch(prev, enabled))
        }
        onEditSources={(id) => setSettingsRoute({ name: 'category-sources', categoryId: id })}
        onEditCategory={(id) => setSettingsRoute({ name: 'category-edit', categoryId: id })}
        onNewCategory={() => setSettingsRoute({ name: 'category-edit' })}
        onOpenChannels={() => setSettingsRoute({ name: 'channels' })}
        onResetLayout={(opts) => update((prev) => resetCategoryLayout(prev, opts))}
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
          showLead={false}
          offline={offline}
          translationPrefs={prefs.translation}
          customSources={prefs.customSources}
          onRefresh={runRefresh}
          onLoadMore={() => void loadMore([focusSource.id])}
          onOpen={openArticle}
          onBack={closeSourceFeed}
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
          categoriesSummary={`${categories.length} 个启用分类 · ${
            prefs.autoRefreshOnCategorySwitch !== false ? '切换自动刷新开启' : '切换自动刷新已关闭'
          }`}
          presetsSummary={`${presets.activePreset?.name ?? '未选择'} · ${categories.length} 分类 · ${enabledIds.length} 源`}
          typographySummary={typographySummary}
          appearanceSummary={appearanceSummary}
          translationSummary={translationSummary}
          proxySummary={proxySummary}
          storageSummary={storageSummary}
          hasUpdate={appUpdate.hasUpdate}
          availableVersion={appUpdate.availableVersion}
          onBackToReading={readerReturnArticle ? restoreReaderFromSettings : undefined}
          onOpenLater={() => setSettingsRoute({ name: 'later' })}
          onOpenHistory={() => setSettingsRoute({ name: 'history' })}
          onOpenCustomSources={() => setSettingsRoute({ name: 'custom-sources' })}
          onOpenCategories={() => setSettingsRoute({ name: 'categories', returnTo: 'me' })}
          onOpenPresets={() => setSettingsRoute({ name: 'presets' })}
          onOpenTypographySettings={() => setSettingsRoute({ name: 'typography' })}
          onOpenAppearanceSettings={() => setSettingsRoute({ name: 'appearance' })}
          onOpenTranslationSettings={() => setSettingsRoute({ name: 'translation' })}
          onOpenProxySettings={() => setSettingsRoute({ name: 'proxy' })}
          onOpenStorageSettings={() => setSettingsRoute({ name: 'storage' })}
          onOpenAbout={() => setSettingsRoute({ name: 'about' })}
        />
      )
    }

    const activeFilterSource = categoryFilterSourceId
      ? findSource(categoryFilterSourceId, prefs.customSources)
      : null
    const displayedArticles = categoryFilterSourceId
      ? articles.filter((item) => item.sourceId === categoryFilterSourceId)
      : articles

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
        pullRefreshSeq={todayPullRefreshSeq}
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

      <EasterEggShell open={eggOpen} onClose={() => setEggOpen(false)}>
        <CurrentEasterEgg onClose={() => setEggOpen(false)} />
      </EasterEggShell>

      {reading && (
        <Suspense
          fallback={
            <div
              role="status"
              aria-label="正在打开文章"
              className="absolute inset-0 z-30 bg-ink pt-[var(--sat)]"
            />
          }
        >
          <ReaderScreen
            article={reading}
            saved={laterIds.has(reading.id)}
            onClose={() => setReading(null)}
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
          />
        </Suspense>
      )}

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
