import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Link2,
  Globe2,
  RadioTower,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SegmentedControl } from '../../components/SegmentedControl'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { FeedStorePicker } from '../../features/feedDiscovery/FeedStorePicker'
import { searchOnlineFeeds, websiteSearchUrl } from '../../features/feedDiscovery/onlineSearch'
import { RssHubInstancesScreen } from '../../features/rsshub/RssHubInstancesScreen'
import { RssHubSubscriptionRebindScreen } from '../../features/rsshub/RssHubSubscriptionRebindScreen'
import { isSensitiveRssHubRoute, normalizeRssHubInstances, rssHubFeedUrl, type RssHubInstance } from '../../features/rsshub/instances'
import { resolveRssHubRadarTarget } from '../../features/rsshub/radar'
import { parseRssHubLogicalInput } from '../../features/rsshub/input'
import { probeRssHubRoutes, probeRssHubRoute, type RssHubProbeResult } from '../../features/rsshub/probe'
import { previewFeed } from '../../features/feedDiscovery/preview'
import { findSubscriptionDuplicate } from '../../features/feedDiscovery/subscriptionActions'
import { clearLegacyDiscoveryCache } from '../../features/feedDiscovery/legacyCache'
import type { FeedDiscoveryEntry, FeedDiscoveryPreviewResult } from '../../features/feedDiscovery/types'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import type { CategoryId } from '../../sources/categories'
import { FOLLOWS_ENABLED_SOURCES, allRegisteredCategories, categorySourceIds, isAggregateCategoryId, visibleCategories, type Preferences } from '../../sources/preferences'
import { makeCustomSourceId, type NewsSource, type SourceDiscoveryMetadata } from '../../sources/registry'

interface SubscriptionDraft {
  name: string
  label: string
  url: string
  siteUrl?: string
  kind: NewsSource['kind']
  discovery: SourceDiscoveryMetadata
}
interface Props {
  prefs: Preferences
  currentCategoryId: CategoryId
  currentPresetId: string
  currentPresetName: string
  enabledIds: string[]
  onSubscribe: (draft: SubscriptionDraft, categoryId: CategoryId | undefined, addToMix: boolean, presetId: string) => { ok: boolean; message?: string }
  onSubscribeMany?: (drafts: SubscriptionDraft[], categoryId: CategoryId | undefined, addToMix: boolean, presetId: string) => { ok: boolean; message?: string }
  onAddBuiltinToCategory: (sourceId: string, categoryId: CategoryId, presetId: string, addToMix?: boolean) => { ok: boolean; message?: string }
  onPause: (sourceId: string, paused: boolean) => { ok: boolean; message?: string }
  onUpdateRssHubInstances?: (instances: RssHubInstance[]) => void
  onUpdateSubscription: (sourceId: string, url: string, discovery: SourceDiscoveryMetadata) => { ok: boolean; message?: string }
  onDelete: (sourceId: string) => { ok: boolean; message?: string }
  onOpenSource: (sourceId: string) => void
  onBack: () => void
  /** 仅测试用：进入时预填搜索词。正式入口不传，始终空白。 */
  initialQuery?: string
}

type DiscoveryMode = 'keyword' | 'website'

const WEBSITE_EXAMPLES = [
  { label: 'B 站 UP 主', value: 'https://space.bilibili.com/1161918898' },
  { label: '豆瓣电影', value: 'https://movie.douban.com/coming' },
]
const KEYWORD_EXAMPLES = ['人工智能', '汽车', '科技']

function formatPreviewTime(checkedAt: number) {
  return new Date(checkedAt).toLocaleTimeString()
}

function candidateHost(entry: FeedDiscoveryEntry): string {
  try {
    return new URL(entry.siteUrl ?? entry.feedUrl ?? '').hostname
  } catch {
    return ''
  }
}

function isWebsiteUrl(value: string): boolean {
  try { return Boolean(websiteSearchUrl(value) || parseRssHubLogicalInput(value)) } catch { return false }
}

export function FeedStoreScreen({ prefs, currentCategoryId, currentPresetId, currentPresetName, enabledIds, onSubscribe, onSubscribeMany, onAddBuiltinToCategory, onPause, onUpdateRssHubInstances, onUpdateSubscription, onDelete, onOpenSource, onBack, initialQuery = '' }: Props) {
  const [tab, setTab] = useState<'discover' | 'subscribed'>('discover')
  const [query, setQuery] = useState(initialQuery)
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>(() => isWebsiteUrl(initialQuery) ? 'website' : 'keyword')
  const [results, setResults] = useState<FeedDiscoveryEntry[]>([])
  const [searchedQuery, setSearchedQuery] = useState('')
  const [probes, setProbes] = useState<Record<string, RssHubProbeResult>>({})
  const [probing, setProbing] = useState(false)
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([])
  const probeController = useRef<AbortController | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchController = useRef<AbortController | null>(null)
  const previewController = useRef<AbortController | null>(null)
  const [entry, setEntry] = useState<FeedDiscoveryEntry | null>(null)
  const [preview, setPreview] = useState<FeedDiscoveryPreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [target, setTarget] = useState<CategoryId>('__mix_only__')
  const [addToMix, setAddToMix] = useState(true)
  const [presetId, setPresetId] = useState(currentPresetId)
  const [deleteSource, setDeleteSource] = useState<NewsSource | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [showInstances, setShowInstances] = useState(false)
  const [rebindSource, setRebindSource] = useState<NewsSource | null>(null)
  const [routeInputs, setRouteInputs] = useState<Record<string, string>>({})
  const [selectedInstanceId, setSelectedInstanceId] = useState('')
  const instances = normalizeRssHubInstances(prefs.rsshubInstances)
  const selectedInstance = selectedInstanceId
    ? instances.find((item) => item.id === selectedInstanceId && item.enabled)
    : instances.find((item) => item.enabled)
  const routeResolution = entry?.type === 'rsshub' && entry.routeTemplate
    ? resolveRssHubRadarTarget(entry.routeTemplate, { ...entry.parameters, ...routeInputs })
    : null
  const effectiveFeedUrl = entry?.type === 'rsshub'
    ? selectedInstance && routeResolution?.path ? rssHubFeedUrl(selectedInstance, routeResolution.path) : undefined
    : entry?.feedUrl
  const categories = allRegisteredCategories(prefs).filter((item) => !isAggregateCategoryId(item.id))
  useEffect(() => {
    void clearLegacyDiscoveryCache()
    return () => {
      searchController.current?.abort()
      previewController.current?.abort()
      probeController.current?.abort()
    }
  }, [])

  const changeQuery = (value: string) => {
    searchController.current?.abort()
    probeController.current?.abort()
    probeController.current = null
    setProbing(false)
    setProbes({})
    setSelectedRoutes([])
    searchController.current = null
    setSearching(false)
    setQuery(value)
    if (tab === 'discover' && isWebsiteUrl(value)) setDiscoveryMode('website')
    setResults([])
    setSearchedQuery('')
    setError(null)
  }
  const switchDiscoveryMode = (mode: DiscoveryMode) => {
    if (mode === discoveryMode) return
    changeQuery('')
    setDiscoveryMode(mode)
  }
  const closeEntry = () => {
    previewController.current?.abort()
    previewController.current = null
    setPreviewing(false)
    setPreview(null)
    setEntry(null)
    setError(null)
  }
  useHardwareBackLayer(Boolean(entry), () => { closeEntry(); return true })
  useHardwareBackLayer(showInstances, () => { setShowInstances(false); return true })
  useHardwareBackLayer(Boolean(rebindSource), () => { setRebindSource(null); return true })
  const openEntry = (next: FeedDiscoveryEntry) => {
    closeEntry()
    setEntry(next)
    setRouteInputs({})
    setSelectedInstanceId(probes[next.routePath ?? '']?.instanceId ?? next.instanceId ?? instances.find((item) => item.enabled)?.id ?? '')
    const alreadyChecked = next.routePath ? probes[next.routePath] : undefined
    if (alreadyChecked?.feed) setPreview(alreadyChecked.feed)
    setPresetId(currentPresetId)
    const visible = visibleCategories(prefs).filter((item) => !isAggregateCategoryId(item.id))
    setTarget(visible.find((item) => item.id === currentCategoryId)?.id ?? visible[0]?.id ?? '__mix_only__')
    setAddToMix(true)
  }
  const search = async () => {
    if (!query.trim()) return
    if (discoveryMode === 'website' && !isWebsiteUrl(query)) {
      setError('这里需要网站网址；按名称查找请使用「搜索 RSS」')
      return
    }
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setSearching(true)
    setError(null)
    setResults([])
    setSearchedQuery('')
    try {
      const found = await searchOnlineFeeds(query, controller.signal, instances)
      if (searchController.current !== controller || controller.signal.aborted) return
      setResults(found)
      setSearchedQuery(query.trim())
      const ready = found.filter((item) => item.type === 'rsshub' && item.routePath && !item.missingParameters?.length)
      if (ready.length) {
        const probeCtl = new AbortController()
        probeController.current?.abort()
        probeController.current = probeCtl
        setProbing(true)
        const routes = ready.map((item) => item.routePath!)
        void probeRssHubRoutes(routes, instances, probeCtl.signal, (outcome) => {
          if (probeController.current !== probeCtl) return
          setProbes((before) => ({ ...before, [outcome.routePath]: outcome }))
          if (outcome.state === 'available') setSelectedRoutes((before) => [...new Set([...before, outcome.routePath])])
        }, found.length === 1 && found[0].type === 'rsshub' ? found[0].instanceId : undefined).catch(() => {}).finally(() => {
          if (probeController.current === probeCtl) { probeController.current = null; setProbing(false) }
        })
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '在线搜索失败，请重试')
    } finally {
      if (searchController.current === controller) { searchController.current = null; setSearching(false) }
    }
  }
  const runPreview = async () => {
    if (!entry || !effectiveFeedUrl) return
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setPreviewing(true)
    setPreview(null)
    setError(null)
    try {
      const route = routeResolution?.path
      const first = selectedInstance
      const eligible = entry.type === 'rsshub' && route && first
        ? [first, ...instances.filter((item) => item.enabled && item.id !== first.id && item.builtin === first.builtin)]
            .filter((_item, index) => index === 0 || !isSensitiveRssHubRoute(route))
            .slice(0, 2)
        : []
      if (!eligible.length) {
        const next = await previewFeed(effectiveFeedUrl, { signal: controller.signal })
        if (previewController.current === controller && !controller.signal.aborted) setPreview(next)
        return
      }
      if (entry.type === 'rsshub' && route) {
        const result = await probeRssHubRoute(route, instances, controller.signal, first?.id)
        if (previewController.current === controller && result.feed) {
          setSelectedInstanceId(result.instanceId ?? '')
          setPreview(result.feed)
        } else if (previewController.current === controller) {
          setError(result.detail ?? 'RSSHub 暂不可用')
        }
        return
      }
      let last: FeedDiscoveryPreviewResult | null = null
      for (const instance of eligible) {
        if (controller.signal.aborted) return
        const url = rssHubFeedUrl(instance, route!)
        const next = await previewFeed(url, { signal: controller.signal, timeoutMs: 9_000 })
        if (controller.signal.aborted) return
        last = next
        if (next.ok) {
          setSelectedInstanceId(instance.id)
          break
        }
        // Credentials and explicit authorization errors must not travel to another host.
        if (next.kind === 'aborted') break
      }
      if (previewController.current === controller && !controller.signal.aborted && last) setPreview(last)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '检测失败')
    } finally {
      if (previewController.current === controller) { previewController.current = null; setPreviewing(false) }
    }
  }
  const subscribeSelected = () => {
    if (!onSubscribeMany || !selectedRoutes.length) return
    const ready = results.filter((item) => item.type === 'rsshub' && item.routePath && selectedRoutes.includes(item.routePath))
      .map((item) => ({ item, result: probes[item.routePath!] }))
      .filter((item) => item.result?.state === 'available' && item.result.feedUrl && item.result.feed)
    const drafts: SubscriptionDraft[] = ready.map(({ item, result }) => ({
      name: result.feed!.title || item.title, label: item.title.slice(0, 12), url: result.feedUrl!,
      kind: 'feed', siteUrl: item.siteUrl,
      discovery: { providerId: 'rsshub', entryId: item.entryId, generator: 'rsshub',
        instanceId: result.instanceId, routeKey: item.routePath,
        verification: { status: 'verified', checkedAt: result.feed!.checkedAt } },
    }))
    if (!drafts.length) return
    const outcome = onSubscribeMany(drafts, undefined, true, currentPresetId)
    if (!outcome.ok) { setError(outcome.message ?? '批量订阅保存失败'); return }
    setSavedId(makeCustomSourceId(drafts[0].url))
    setSelectedRoutes([])
  }
  const subscribe = (unverified = false) => {
    if (!entry || !effectiveFeedUrl || previewing || (!preview?.ok && !(unverified && preview && !preview.ok && preview.retryable))) return
    const discovery: SourceDiscoveryMetadata = entry.type === 'rsshub' && routeResolution?.path
      ? {
          providerId: 'rsshub', entryId: entry.entryId, generator: 'rsshub',
          instanceId: selectedInstance?.id, routeKey: routeResolution.path,
          verification: { status: preview?.ok ? 'verified' : 'unverified', checkedAt: preview?.ok ? preview.checkedAt : undefined },
        }
      : {
          providerId: entry.providerId, entryId: entry.entryId, generator: 'feed',
          verification: { status: preview?.ok ? 'verified' : 'unverified', checkedAt: preview?.ok ? preview.checkedAt : undefined },
        }
    const duplicate = findSubscriptionDuplicate(prefs, { url: effectiveFeedUrl, discovery })
    if (duplicate?.kind === 'custom' || duplicate?.kind === 'generator-route') { onOpenSource(duplicate.source.id); return }
    if (duplicate && target === '__save_only__') { setError('该来源已内置，可直接查看，无需重复保存。'); return }
    const destination = target === '__save_only__' || target === '__mix_only__' ? undefined : target
    const outcome = duplicate
      ? onAddBuiltinToCategory(duplicate.source.id, destination ?? FOLLOWS_ENABLED_SOURCES, presetId, addToMix)
      : onSubscribe({
          name: preview?.ok ? preview.title || entry.title : entry.title,
          label: entry.title.slice(0, 12), kind: 'feed',
          url: effectiveFeedUrl, siteUrl: entry.siteUrl, discovery,
        }, destination, target === '__save_only__' ? false : target === '__mix_only__' || addToMix, presetId)
    if (!outcome.ok) { setError(outcome.message ?? '订阅保存失败'); return }
    setSavedId(duplicate?.source.id ?? makeCustomSourceId(effectiveFeedUrl))
    closeEntry()
  }
  const subscribed = (prefs.customSources ?? []).filter((source) => (source.name + ' ' + source.url).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const duplicateLabel = (item: FeedDiscoveryEntry) => {
    const discovery = item.type === 'rsshub' && item.routePath
      ? { generator: 'rsshub' as const, providerId: 'rsshub', entryId: item.entryId, routeKey: item.routePath }
      : undefined
    const duplicate = findSubscriptionDuplicate(prefs, { url: item.feedUrl ?? '', discovery })
    return duplicate ? duplicate.kind === 'builtin' ? '已内置' : duplicate.source.paused ? '已暂停' : '已订阅' : null
  }
  const orderedResults = discoveryMode === 'website'
    ? [...results.filter((item) => item.type === 'direct'), ...results.filter((item) => item.type === 'rsshub')]
    : results
  const websiteInputInvalid = discoveryMode === 'website' && query.trim().length > 4 && !isWebsiteUrl(query)
  const canSubscribe = Boolean(preview?.ok) && !previewing
  const canForceAdd = Boolean(preview && !preview.ok && preview.retryable && !previewing)
  const attribution = [
    results.some((item) => item.providerId === 'feedly') ? { href: 'https://feedly.com/', label: '搜索结果来自 Feedly' } : null,
    results.some((item) => item.providerId === 'feedsearch') ? { href: 'https://feedsearch.dev/', label: '网站发现由 Feedsearch 提供' } : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>

  return <SettingsShell title="RSS 订阅商店" caption="在线查找订阅地址 · 订阅后由本机直连来源" onBack={onBack}>
    <div className="page-x space-y-5 pt-4">
      <SegmentedControl
        label="订阅商店分页"
        options={[
          { label: '发现', value: 'discover' },
          { label: '已订阅', value: 'subscribed' },
        ]}
        value={tab}
        onChange={(value) => { setTab(value); changeQuery(''); setError(null) }}
      />

      {tab === 'discover' ? (
        <div role="group" aria-label="选择发现方式" className="space-y-2.5">
          <p className="px-0.5 text-[12.5px] font-medium text-paper">你想如何添加内容？</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" aria-pressed={discoveryMode === 'keyword'}
              onClick={() => switchDiscoveryMode('keyword')}
              className={`min-h-[76px] rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar ${discoveryMode === 'keyword' ? 'border-cinnabar/45 bg-cinnabar/8' : 'border-haze bg-ink-raised/45 hover:border-cinnabar/35'}`}>
              <span className={`flex items-center gap-2 text-[13px] font-medium ${discoveryMode === 'keyword' ? 'text-cinnabar-soft' : 'text-paper'}`}>
                <Search size={16} strokeWidth={1.8} className="shrink-0" />
                按名称搜索
              </span>
              <span className="mt-1.5 block text-[10.5px] leading-snug text-paper-faint">查找现成 RSS 订阅源</span>
            </button>
            <button type="button" aria-pressed={discoveryMode === 'website'}
              onClick={() => switchDiscoveryMode('website')}
              className={`min-h-[76px] rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cinnabar ${discoveryMode === 'website' ? 'border-cinnabar/45 bg-cinnabar/8' : 'border-haze bg-ink-raised/45 hover:border-cinnabar/35'}`}>
              <span className={`flex items-center gap-2 text-[13px] font-medium ${discoveryMode === 'website' ? 'text-cinnabar-soft' : 'text-paper'}`}>
                <Link2 size={16} strokeWidth={1.8} className="shrink-0" />
                通过网站订阅
              </span>
              <span className="mt-1.5 block text-[10.5px] leading-snug text-paper-faint">发现 RSS / RSSHub</span>
            </button>
          </div>
        </div>
      ) : null}

      <form
        className="space-y-2.5"
        onSubmit={(event) => { event.preventDefault(); if (tab === 'discover') void search() }}
      >
        <label htmlFor="feed-store-search" className="block font-mono text-[10px] tracking-[0.12em] text-paper-faint">
          {tab === 'subscribed' ? '搜索已订阅' : discoveryMode === 'website' ? '粘贴网站或作者主页链接' : '输入名称或关键词'}
        </label>
        <div className="flex min-h-12 items-center gap-1 rounded-2xl border border-haze bg-ink-raised/80 px-2.5 shadow-[var(--shadow-lift)] focus-within:border-cinnabar/45">
          {tab === 'discover' && discoveryMode === 'website'
            ? <Link2 size={15} strokeWidth={1.7} className="ml-1.5 shrink-0 text-paper-faint" />
            : <Search size={15} strokeWidth={1.7} className="ml-1.5 shrink-0 text-paper-faint" />}
          <input
            id="feed-store-search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder={tab === 'subscribed' ? '搜索已保存的订阅' : discoveryMode === 'website' ? '网站主页或 rsshub://bilibili/…' : '例如 Bilibili、人工智能、汽车'}
            autoComplete="off"
            spellCheck={false}
            inputMode={tab === 'discover' && discoveryMode === 'website' ? 'url' : 'search'}
            className="min-w-0 flex-1 bg-transparent px-2 py-3 text-[13.5px] text-paper outline-none placeholder:text-paper-faint/65"
          />
          {query ? (
            <button type="button" aria-label="清除搜索" onClick={() => changeQuery('')} className="grid h-9 w-9 place-items-center rounded-full text-paper-faint transition-colors hover:bg-paper/6 hover:text-paper">
              <X size={14} strokeWidth={1.8} />
            </button>
          ) : null}
          {tab === 'discover' ? (
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching || !query.trim() || (discoveryMode === 'website' && !isWebsiteUrl(query))}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-cinnabar px-3.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-35"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : null}
              {searching ? '查找中…' : discoveryMode === 'website' ? '查找订阅' : '搜索 RSS'}
            </button>
          ) : null}
        </div>
        {tab === 'discover' ? (
          <>
            <p className="px-0.5 text-[11px] leading-relaxed text-paper-faint">
              {discoveryMode === 'website'
                ? '粘贴网站、栏目或 UP 主的主页网址，自动查找原站 RSS 和 RSSHub 转换方式。'
                : '通过 Feedly 搜索已有 RSS 源；订阅具体网站或 UP 主，请选择「通过网站订阅」。'}
            </p>
            {websiteInputInvalid ? (
              <p role="status" className="px-0.5 text-[11px] leading-relaxed text-cinnabar-soft">
                这里需要完整的网址，不是网站名称。
                <button type="button" onClick={() => switchDiscoveryMode('keyword')} className="ml-1 min-h-8 underline underline-offset-2">
                  改为按名称搜索
                </button>
              </p>
            ) : null}
            {!query.trim() ? (
              <div className="flex flex-wrap items-center gap-2 px-0.5">
                <span className="text-[10.5px] text-paper-faint">试一试</span>
                {discoveryMode === 'website' ? WEBSITE_EXAMPLES.map((example) => (
                  <button key={example.value} type="button" onClick={() => changeQuery(example.value)}
                    className="min-h-9 rounded-full border border-haze bg-ink-raised/40 px-3 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft">
                    {example.label}
                  </button>
                )) : KEYWORD_EXAMPLES.map((example) => (
                  <button key={example} type="button" onClick={() => changeQuery(example)}
                    className="min-h-9 rounded-full border border-haze bg-ink-raised/40 px-3 text-[11px] text-paper-muted transition-colors hover:border-cinnabar/35 hover:text-cinnabar-soft">
                    {example}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </form>

      {tab === 'discover' && discoveryMode === 'website' && onUpdateRssHubInstances ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-haze/70 bg-ink-raised/35 px-3.5 py-2.5">
          <RadioTower size={15} strokeWidth={1.7} className="shrink-0 text-cinnabar-soft" />
          <p className="min-w-0 flex-1 text-[11px] text-paper-muted">
            RSSHub · {instances.filter((item) => item.enabled).length} 个已启用实例
          </p>
          <button type="button" onClick={() => setShowInstances(true)}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] text-cinnabar-soft transition-colors hover:bg-cinnabar/8">
            管理服务 <ChevronRight size={12} />
          </button>
        </div>
      ) : null}

      {error && !entry ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-cinnabar/25 bg-cinnabar/8 px-3.5 py-3 text-[12.5px] leading-relaxed text-cinnabar-soft">
          <AlertCircle size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {savedId ? (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised/80 px-4 py-3.5 shadow-[var(--shadow-lift)]">
          <CheckCircle2 size={16} strokeWidth={1.8} className="shrink-0 text-cinnabar-soft" />
          <span className="min-w-0 flex-1 text-[12.5px] text-paper-muted">订阅已保存</span>
          <button type="button" onClick={() => onOpenSource(savedId)} className="min-h-9 rounded-full border border-cinnabar/35 bg-cinnabar/10 px-3 text-[11.5px] text-cinnabar-soft transition-colors hover:bg-cinnabar/16">
            查看订阅
          </button>
          <button type="button" onClick={() => { setSavedId(null); setTab('discover') }} className="min-h-9 px-1 text-[11.5px] text-cinnabar transition-opacity hover:opacity-80">
            继续发现
          </button>
        </div>
      ) : null}
    </div>

    {tab === 'discover' && (searching || Boolean(searchedQuery)) ? (
      <SettingsSection title={searching ? '正在查找' : '发现结果 · ' + results.length}>
        <div aria-live="polite" className="page-x pb-2">
          {searching && !results.length ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-haze/70 bg-ink-raised/40 py-10 text-[12.5px] text-paper-faint">
              <Loader2 size={15} className="animate-spin text-cinnabar-soft" />
              {discoveryMode === 'website' ? '正在检查网站和 RSSHub 路由…' : '正在搜索 RSS 订阅源…'}
            </div>
          ) : orderedResults.length ? (
            <>
              <p className="mb-2.5 px-0.5 text-[11px] text-paper-faint">{probing ? '正在自动检测 RSSHub 频道，可用结果会逐步出现。' : 'RSSHub 频道可选择，已验证的结果支持批量订阅。'}</p>
              <div className="overflow-hidden rounded-2xl border border-haze bg-ink-raised/70 shadow-[var(--shadow-lift)]">
                {orderedResults.map((item, index) => {
                  const badge = duplicateLabel(item)
                  const firstOfGroup = discoveryMode === 'website' && (index === 0 || orderedResults[index - 1]?.type !== item.type)
                  const hostname = candidateHost(item)
                  const check = item.routePath ? probes[item.routePath] : undefined
                  return (
                    <div key={item.entryId}>
                      {firstOfGroup ? (
                        <div className="flex items-center justify-between gap-3 border-b border-haze/70 bg-ink/20 px-4 py-2.5">
                          <span className="text-[11.5px] font-medium text-paper-muted">
                            {item.type === 'rsshub' ? 'RSSHub 转换' : '原站订阅与网址检测'}
                          </span>
                          <span className="font-mono text-[10.5px] text-paper-faint">
                            {results.filter((entry) => entry.type === item.type).length} 项
                          </span>
                        </div>
                      ) : null}
                      <div className="flex items-start gap-2">
                        {item.type === 'rsshub' && check?.state === 'available' && item.routePath ? (
                          <label className="flex min-h-11 shrink-0 items-center pl-3" aria-label={'选择订阅 ' + item.title}>
                            <input type="checkbox" checked={selectedRoutes.includes(item.routePath)}
                              onChange={(event) => setSelectedRoutes((before) => event.target.checked ? [...new Set([...before, item.routePath!])] : before.filter((route) => route !== item.routePath))}
                              className="size-4 accent-[var(--color-cinnabar)]" />
                          </label>
                        ) : null}
                      <button type="button" onClick={() => openEntry(item)}
                        className={`group flex min-h-[72px] w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cinnabar ${
                          index > 0 && !firstOfGroup ? 'border-t border-haze/70' : ''
                        }`}>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start gap-2">
                            <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-paper">{item.title}</span>
                            {item.type === 'rsshub' ? (
                              <span className="mt-0.5 shrink-0 rounded-full border border-cinnabar/25 bg-cinnabar/8 px-2 py-0.5 text-[10px] text-cinnabar-soft">RSSHub</span>
                            ) : null}
                            {badge ? <span className="mt-0.5 shrink-0 rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10px] text-cinnabar-soft">{badge}</span> : null}
                          </span>
                          {item.description && item.type !== 'rsshub' ? (
                            <span className="mt-1 line-clamp-1 block text-[11.5px] leading-relaxed text-paper-muted">{item.description}</span>
                          ) : null}
                          <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-paper-faint">
                            <Globe2 size={12} strokeWidth={1.6} className="shrink-0" />
                            <span className="truncate">{hostname || (item.routeTemplate ?? '待检测地址')}</span>
                            {item.type === 'rsshub' && item.missingParameters?.length ? <span className="shrink-0 text-cinnabar-soft">· 需补参数</span> : null}
                          </span>
                          {item.type === 'rsshub' ? <span aria-live="polite" className="mt-1 block text-[11px] text-paper-faint">{
                            check?.state === 'available' ? '可订阅 · ' + check.feed?.itemCount + ' 篇文章 · 自动选择 ' + new URL(check.feedUrl!).hostname :
                            check?.state === 'unavailable' ? '暂不可用 · ' + (check.detail ?? '请稍后重试') :
                            item.missingParameters?.length ? '需要补充参数后检测' : probing ? '正在自动检测可用实例…' : '尚未验证，可打开检测'
                          }</span> : null}
                          {item.providerId === 'direct-discovery' && item.statusNote ? (
                            <span className="mt-1 block text-[10.5px] text-paper-faint">{item.statusNote}</span>
                          ) : null}
                        </span>
                        <ChevronRight size={15} strokeWidth={1.6} className="mt-1 shrink-0 text-paper-faint/70 transition-colors group-hover:text-cinnabar-soft" />
                      </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {selectedRoutes.length > 0 && onSubscribeMany ? (
                <button type="button" onClick={subscribeSelected} className="mt-3 min-h-11 w-full rounded-full bg-cinnabar text-[13px] font-medium text-white">
                  订阅所选 {selectedRoutes.length} 个频道
                </button>
              ) : null}
              {discoveryMode === 'website' && !results.some((item) => item.type === 'rsshub') ? (
                <p className="mt-2.5 px-0.5 text-[11px] leading-relaxed text-paper-faint">
                  暂未匹配 RSSHub 转换规则。仍可点击上方网址检测是否包含原生 RSS。
                </p>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-haze/70 bg-ink-raised/35 px-5 py-8 text-center">
              <p className="text-[13px] text-paper-muted">
                {discoveryMode === 'website' ? '未找到匹配的订阅方式，请检查网址是否正确' : '暂未找到现成 RSS，试试其他名称或关键词'}
              </p>
            </div>
          )}
          {discoveryMode === 'keyword' && !searching ? (
            <div className="mt-3 flex items-center gap-3 rounded-2xl border border-haze/70 bg-ink-raised/35 px-3.5 py-3">
              <RadioTower size={16} strokeWidth={1.6} className="shrink-0 text-cinnabar-soft" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-paper">想订阅某个 UP 主或作者？</p>
                <p className="mt-0.5 text-[10.5px] text-paper-faint">复制他的主页网址，发现更多 RSSHub 订阅方式。</p>
              </div>
              <button type="button" onClick={() => switchDiscoveryMode('website')}
                className="inline-flex min-h-9 shrink-0 items-center gap-1 text-[11px] text-cinnabar-soft">
                粘贴网址 <ArrowRight size={13} />
              </button>
            </div>
          ) : null}
          {attribution.length ? (
            <div className="mt-3 space-y-1 px-0.5">
              {attribution.map((item) => (
                <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className="block text-[10.5px] text-paper-faint transition-colors hover:text-paper-muted">
                  {item.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </SettingsSection>
    ) : tab === 'discover' ? null : (
      <SettingsSection title={'全部自建订阅 · ' + (prefs.customSources?.length ?? 0)}>
        <p className="page-x pb-3 text-[11.5px] leading-relaxed text-paper-muted">暂停影响所有预设，已缓存内容保留。</p>
        <div className="page-x pb-2">
          {subscribed.length ? (
            <div className="overflow-hidden rounded-2xl border border-haze bg-ink-raised/70 shadow-[var(--shadow-lift)]">
              {subscribed.map((source, index) => {
                const members = categories.filter((category) => categorySourceIds(category.id, prefs).includes(source.id))
                return (
                  <div
                    key={source.id}
                    className={`flex items-center gap-2 px-3 py-3 ${index > 0 ? 'border-t border-haze/70' : ''}`}
                  >
                    <button type="button" onClick={() => onOpenSource(source.id)} className="min-h-11 min-w-0 flex-1 rounded-xl px-1 text-left transition-colors hover:bg-paper/4">
                      <span className="block truncate text-[13.5px] font-medium text-paper">{source.name}</span>
                      <span className="mt-1 block truncate text-[11px] text-paper-faint">
                        {members.length ? members.map((category) => category.label).join(' · ') : '未加入当前预设分类'}
                        {enabledIds.includes(source.id) ? ' · 综合' : ''}
                      </span>
                    </button>
                    {source.discovery?.generator === 'rsshub' && source.discovery.routeKey ? (
                      <button type="button" onClick={() => { setError(null); setRebindSource(source) }}
                        aria-label={'更换 ' + source.name + ' 的 RSSHub 服务'}
                        className="min-h-9 shrink-0 rounded-full border border-haze px-2.5 text-[10.5px] text-paper-muted transition-colors hover:border-cinnabar/30 hover:text-cinnabar-soft">
                        服务
                      </button>
                    ) : null}
                    {!members.length ? (
                      <button
                        type="button"
                        onClick={() => {
                          const destination = categories.find((category) => category.id === currentCategoryId) ?? visibleCategories(prefs).find((category) => !isAggregateCategoryId(category.id))
                          const outcome = onAddBuiltinToCategory(source.id, destination?.id ?? FOLLOWS_ENABLED_SOURCES, currentPresetId)
                          setError(outcome.ok ? null : outcome.message ?? '保存失败')
                        }}
                        className="min-h-9 shrink-0 rounded-full border border-cinnabar/30 bg-cinnabar/8 px-2.5 text-[10.5px] text-cinnabar-soft"
                      >
                        加入当前分类
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={(source.paused ? '恢复 ' : '暂停 ') + source.name}
                      onClick={() => {
                        const outcome = onPause(source.id, !source.paused)
                        setError(outcome.ok ? null : outcome.message ?? '订阅保存失败')
                      }}
                      className="min-h-9 min-w-9 shrink-0 rounded-full px-2 text-[10.5px] text-cinnabar transition-colors hover:bg-cinnabar/8"
                    >
                      {source.paused ? '已暂停' : '启用'}
                    </button>
                    <button
                      type="button"
                      aria-label={'删除 ' + source.name}
                      onClick={() => { setError(null); setDeleteSource(source) }}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-paper-faint transition-colors hover:bg-paper/6 hover:text-cinnabar"
                    >
                      <Trash2 size={14} strokeWidth={1.7} />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-haze/70 bg-ink-raised/35 px-5 py-12 text-center">
              <p className="text-[13.5px] text-paper-muted">{query ? '没有匹配的自建订阅' : '还没有自建订阅'}</p>
            </div>
          )}
        </div>
      </SettingsSection>
    )}

    {entry ? (
      <div className="absolute inset-0 z-40 bg-ink" style={{ paddingBottom: 'var(--sab)' }}>
        <SettingsShell title={entry.title} caption="实际检测后订阅" onBack={closeEntry}>
          <div className="page-x space-y-5 pt-4 pb-6">
            <section className="overflow-hidden rounded-2xl border border-haze bg-ink-raised/75 shadow-[var(--shadow-lift)]">
              <div className="px-4 py-4">
                <p className="font-mono text-[10px] tracking-[0.18em] text-paper-faint">{entry.type === 'rsshub' ? 'RSSHub 转换地址' : '订阅地址'}</p>
                <p className="mt-2 break-all font-mono text-[12px] leading-relaxed text-paper-muted">{effectiveFeedUrl ?? '请先填写必要的路由参数并选择实例'}</p>
                {entry.siteUrl ? <p className="mt-2 truncate text-[11.5px] text-paper-faint">{entry.siteUrl}</p> : null}
              </div>
              {entry.description ? (
                <>
                  <div className="h-px bg-haze/70" />
                  <p className="px-4 py-3.5 text-[12.5px] leading-relaxed text-paper-muted">{entry.description}</p>
                </>
              ) : null}
            </section>

            {entry.type === 'rsshub' ? (
              <section className="space-y-3.5 rounded-2xl border border-haze bg-ink-raised/75 p-4 shadow-[var(--shadow-lift)]">
                <div className="flex items-start gap-2.5">
                  <RadioTower size={17} className="mt-0.5 shrink-0 text-cinnabar-soft" />
                  <div>
                    <p className="text-[13.5px] font-medium text-paper">RSSHub 路由设置</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">匹配规则不等于可访问。服务由第三方运行，提交前请检测内容。</p>
                  </div>
                </div>
                <p className="break-all rounded-lg bg-ink/30 p-2.5 font-mono text-[10.5px] text-paper-muted">{entry.routeTemplate}</p>
                {(entry.missingParameters ?? []).map((parameter) => (
                  <label key={parameter} className="block text-[11.5px] text-paper-muted">
                    <span className="mb-1.5 block font-mono">必填参数 · {parameter}</span>
                    <input value={routeInputs[parameter] ?? ''} maxLength={250}
                      onChange={(event) => {
                        previewController.current?.abort()
                        setPreview(null)
                        setRouteInputs((prev) => ({ ...prev, [parameter]: event.target.value }))
                      }}
                      placeholder={'填写 ' + parameter}
                      className="min-h-11 w-full rounded-xl border border-haze bg-ink/30 px-3.5 text-[13px] text-paper outline-none placeholder:text-paper-faint/70 focus:border-cinnabar/45"
                    />
                  </label>
                ))}
                <div className="rounded-xl bg-ink/25 px-3.5 py-3 text-[11.5px] leading-relaxed text-paper-muted">
                  自动检测可用实例；实际成功的服务会用于保存与后续刷新。
                  {selectedInstance ? <span className="mt-1 block truncate font-mono text-[10.5px] text-paper-faint">当前 · {selectedInstance.url}</span> : null}
                </div>
                <details className="rounded-xl border border-haze/70 px-3.5 py-2.5">
                  <summary className="min-h-8 cursor-pointer text-[11.5px] text-paper-muted">高级选项 · 手动指定实例</summary>
                  <div className="space-y-3 pt-2">
                    <FeedStorePicker title="手动选择 RSSHub 实例" value={selectedInstance?.id ?? ''}
                      disabled={!instances.some((item) => item.enabled)}
                      options={instances.filter((item) => item.enabled).map((item) => ({ id: item.id, label: item.name + ' · ' + new URL(item.url).hostname }))}
                      onChange={(id) => {
                        previewController.current?.abort()
                        setPreview(null)
                        setSelectedInstanceId(id)
                      }}
                    />
                    {onUpdateRssHubInstances ? <button type="button" onClick={() => setShowInstances(true)}
                      className="inline-flex min-h-9 items-center gap-1 rounded-full text-[11.5px] text-cinnabar-soft">
                      管理服务 <ChevronRight size={12} />
                    </button> : null}
                  </div>
                </details>
                {routeResolution?.missing.length ? (
                  <p role="status" className="text-[11.5px] text-cinnabar-soft">还需填写：{routeResolution.missing.join('、')}</p>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3.5 rounded-2xl border border-haze bg-ink-raised/75 p-4 shadow-[var(--shadow-lift)]">
              <div>
                <p className="text-[13.5px] font-medium text-paper">加入位置</p>
                <p className="mt-1 text-[11.5px] text-paper-faint">当前预设：{currentPresetName}</p>
              </div>
              <div className="space-y-2">
                <p className="font-mono text-[10px] tracking-[0.16em] text-paper-faint">加入分类</p>
                <FeedStorePicker
                  title="加入分类"
                  value={target}
                  onChange={setTarget}
                  options={[
                    ...categories.map((category) => ({ id: category.id, label: category.label })),
                    { id: '__mix_only__', label: '加入综合' },
                    { id: '__save_only__', label: '仅保存，暂不加入信息流' },
                  ]}
                />
              </div>
              {target !== '__mix_only__' && target !== '__save_only__' ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-haze/75 bg-ink/30 px-3.5 text-[12.5px] text-paper-muted transition-colors hover:border-haze">
                  <input
                    type="checkbox"
                    checked={addToMix}
                    onChange={(event) => setAddToMix(event.target.checked)}
                    className="size-4 accent-[var(--color-cinnabar)]"
                  />
                  同时加入综合
                </label>
              ) : null}
            </section>

            <section className="overflow-hidden rounded-2xl border border-haze bg-ink-raised/75 shadow-[var(--shadow-lift)]">
              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-paper">检测与预览</p>
                  <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-paper-faint">先确认可读，再保存订阅</p>
                </div>
                <button
                  type="button"
                  disabled={previewing || !effectiveFeedUrl}
                  onClick={() => void runPreview()}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-cinnabar/40 bg-cinnabar/10 px-3.5 text-[12px] text-cinnabar-soft transition-colors hover:bg-cinnabar/16 disabled:opacity-40"
                >
                  {previewing ? <Loader2 size={13} className="animate-spin" /> : null}
                  {previewing ? '正在检测与预览' : '检测与预览'}
                </button>
              </div>

              <div className="border-t border-haze/70 px-4 py-3.5">
                {preview?.ok ? (
                  <div>
                    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]">
                      <span className="inline-flex items-center gap-1.5 text-cinnabar-soft">
                        <CheckCircle2 size={13} strokeWidth={1.8} />
                        本次检测成功
                      </span>
                      <span className="font-mono text-paper-faint">{preview.itemCount} 条</span>
                      <span className="font-mono text-paper-faint">{formatPreviewTime(preview.checkedAt)}</span>
                    </div>
                    {preview.itemCount === 0 ? (
                      <p className="rounded-xl bg-ink/35 px-3 py-5 text-center text-[12.5px] text-paper-faint">当前暂无条目</p>
                    ) : (
                      <ul className="overflow-hidden rounded-xl border border-haze/65 bg-ink/25">
                        {preview.articles.map((article, index) => (
                          <li
                            key={index}
                            className={`px-3.5 py-2.5 text-[13px] leading-snug text-paper ${index > 0 ? 'border-t border-haze/55' : ''}`}
                          >
                            {article.title}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : preview ? (
                  <p role="alert" className="flex items-start gap-2.5 rounded-xl border border-cinnabar/25 bg-cinnabar/8 px-3.5 py-3 text-[12.5px] leading-relaxed text-cinnabar-soft">
                    <AlertCircle size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                    <span>{preview.message}</span>
                  </p>
                ) : (
                  <p className="rounded-xl bg-ink/30 px-3.5 py-6 text-center text-[12.5px] leading-relaxed text-paper-faint">
                    点击右上角检测，确认源可读取后再订阅
                  </p>
                )}
                {error ? (
                  <p role="alert" className="mt-3 flex items-start gap-2.5 rounded-xl border border-cinnabar/25 bg-cinnabar/8 px-3.5 py-3 text-[12.5px] leading-relaxed text-cinnabar-soft">
                    <AlertCircle size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                  </p>
                ) : null}
              </div>
            </section>

            <div className="pt-1">
              <button
                type="button"
                disabled={!canSubscribe}
                onClick={() => subscribe()}
                className="min-h-11 w-full rounded-full bg-cinnabar text-[13.5px] font-medium text-white transition-opacity disabled:opacity-30"
              >
                订阅
              </button>
              {canForceAdd ? (
                <button type="button" onClick={() => subscribe(true)} className="mt-2 min-h-10 w-full text-[12px] text-paper-muted transition-colors hover:text-paper">
                  仍添加，稍后重试
                </button>
              ) : null}
            </div>
          </div>
        </SettingsShell>
      </div>
    ) : null}

    {rebindSource ? (
      <div className="absolute inset-0 z-50 bg-ink" style={{ paddingBottom: 'var(--sab)' }}>
        <RssHubSubscriptionRebindScreen source={rebindSource} instances={instances}
          onChange={onUpdateSubscription} onBack={() => setRebindSource(null)} />
      </div>
    ) : null}

    {showInstances && onUpdateRssHubInstances ? (
      <div className="absolute inset-0 z-50 bg-ink" style={{ paddingBottom: 'var(--sab)' }}>
        <RssHubInstancesScreen instances={instances} onChange={onUpdateRssHubInstances} onBack={() => setShowInstances(false)} />
      </div>
    ) : null}

    <ConfirmDialog
      open={Boolean(deleteSource)}
      title="删除订阅？"
      message={error ?? '将删除此订阅，并清理各预设中的分类和综合引用。'}
      confirmLabel="删除"
      danger
      onCancel={() => { setDeleteSource(null); setError(null) }}
      onConfirm={() => {
        if (!deleteSource) return
        const outcome = onDelete(deleteSource.id)
        if (!outcome.ok) { setError(outcome.message ?? '删除保存失败'); return }
        if (savedId === deleteSource.id) setSavedId(null)
        setDeleteSource(null)
      }}
    />
  </SettingsShell>
}
