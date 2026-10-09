import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
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
import { searchOnlineFeeds } from '../../features/feedDiscovery/onlineSearch'
import { RssHubInstancesScreen } from '../../features/rsshub/RssHubInstancesScreen'
import { RssHubSubscriptionRebindScreen } from '../../features/rsshub/RssHubSubscriptionRebindScreen'
import { isSensitiveRssHubRoute, normalizeRssHubInstances, rssHubFeedUrl, type RssHubInstance } from '../../features/rsshub/instances'
import { resolveRssHubRadarTarget } from '../../features/rsshub/radar'
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

function formatPreviewTime(checkedAt: number) {
  return new Date(checkedAt).toLocaleTimeString()
}

export function FeedStoreScreen({ prefs, currentCategoryId, currentPresetId, currentPresetName, enabledIds, onSubscribe, onAddBuiltinToCategory, onPause, onUpdateRssHubInstances, onUpdateSubscription, onDelete, onOpenSource, onBack, initialQuery = '' }: Props) {
  const [tab, setTab] = useState<'discover' | 'subscribed'>('discover')
  const [query, setQuery] = useState(initialQuery)
  const [results, setResults] = useState<FeedDiscoveryEntry[]>([])
  const [searchedQuery, setSearchedQuery] = useState('')
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
    }
  }, [])

  const changeQuery = (value: string) => {
    searchController.current?.abort()
    searchController.current = null
    setSearching(false)
    setQuery(value)
    setResults([])
    setSearchedQuery('')
    setError(null)
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
    setSelectedInstanceId(next.instanceId ?? instances.find((item) => item.enabled)?.id ?? '')
    setPresetId(currentPresetId)
    const visible = visibleCategories(prefs).filter((item) => !isAggregateCategoryId(item.id))
    setTarget(visible.find((item) => item.id === currentCategoryId)?.id ?? visible[0]?.id ?? '__mix_only__')
    setAddToMix(true)
  }
  const search = async () => {
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
        onChange={(value) => { setTab(value); setError(null) }}
      />

      <form
        className="space-y-2.5"
        onSubmit={(event) => { event.preventDefault(); if (tab === 'discover') void search() }}
      >
        <label htmlFor="feed-store-search" className="block font-mono text-[10px] tracking-[0.18em] text-paper-faint">
          {tab === 'discover' ? '搜索网站、关键词或订阅地址' : '搜索已订阅'}
        </label>
        <div className="flex min-h-12 items-center gap-1 rounded-2xl border border-haze bg-ink-raised/80 px-2.5 shadow-[var(--shadow-lift)] focus-within:border-cinnabar/45">
          <Search size={15} strokeWidth={1.7} className="ml-1.5 shrink-0 text-paper-faint" />
          <input
            id="feed-store-search"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="例如 OpenAI、少数派、https://example.com"
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
              disabled={searching || !query.trim()}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-cinnabar px-3.5 text-[12px] font-medium text-white transition-opacity disabled:opacity-35"
            >
              {searching ? <Loader2 size={13} className="animate-spin" /> : null}
              {searching ? '正在在线搜索…' : '在线搜索'}
            </button>
          ) : null}
        </div>
        {tab === 'discover' ? (
          <p className="px-0.5 text-[11px] leading-relaxed text-paper-faint">
            关键词由 Feedly 在线搜索；网址优先发现原站 RSS，再查找 RSSHub 转换规则。规则按需加载，不在应用安装时下载目录。
          </p>
        ) : null}
      </form>

      {tab === 'discover' && onUpdateRssHubInstances ? (
        <section className="flex items-center gap-3 rounded-2xl border border-haze bg-ink-raised/60 px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cinnabar/10 text-cinnabar-soft"><RadioTower size={17} strokeWidth={1.6} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium text-paper">RSSHub 网站订阅</p>
            <p className="mt-0.5 text-[10.5px] leading-snug text-paper-faint">{instances.filter((item) => item.enabled).length} 个可用候选服务 · 请求由第三方提供</p>
          </div>
          <button type="button" onClick={() => setShowInstances(true)}
            className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-haze px-3 text-[11.5px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-cinnabar-soft">
            管理实例 <ChevronRight size={12} />
          </button>
        </section>
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

    {tab === 'discover' ? (
      <SettingsSection title={searchedQuery ? '在线结果 · ' + results.length : '在线发现'}>
        <div aria-live="polite" className="page-x pb-2">
          {searching && !results.length ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-haze/70 bg-ink-raised/40 py-14 text-[12.5px] text-paper-faint">
              <Loader2 size={15} className="animate-spin text-cinnabar-soft" />
              正在查找订阅地址…
            </div>
          ) : results.length ? (
            <div className="overflow-hidden rounded-2xl border border-haze bg-ink-raised/70 shadow-[var(--shadow-lift)]">
              {results.map((item, index) => {
                const badge = duplicateLabel(item)
                return (
                  <button
                    key={item.entryId}
                    type="button"
                    onClick={() => openEntry(item)}
                    className={`group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-paper/4 ${
                      index > 0 ? 'border-t border-haze/70' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-paper">{item.title}</span>
                        {item.type === 'rsshub' ? <span className="mt-0.5 shrink-0 rounded-full border border-cinnabar/30 bg-cinnabar/8 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.04em] text-cinnabar-soft">RSSHub</span> : null}
                        {badge ? (
                          <span className="mt-0.5 shrink-0 rounded-full bg-cinnabar/10 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.06em] text-cinnabar-soft">
                            {badge}
                          </span>
                        ) : null}
                      </span>
                      {item.description ? (
                        <span className="mt-1.5 line-clamp-2 block text-[12px] leading-relaxed text-paper-muted">{item.description}</span>
                      ) : null}
                      <span className="mt-2 block break-all font-mono text-[10px] leading-relaxed text-paper-faint">{item.feedUrl ?? item.routeTemplate}</span>
                      {item.statusNote ? <span className="mt-1 block text-[10.5px] text-paper-faint">{item.statusNote}</span> : null}
                    </span>
                    <ChevronRight size={15} strokeWidth={1.6} className="mt-1 shrink-0 text-paper-faint/70 transition-colors group-hover:text-cinnabar-soft" />
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-haze/70 bg-ink-raised/35 px-5 py-12 text-center">
              <p className="text-[13.5px] text-paper-muted">
                {searchedQuery ? '没有找到订阅地址，请换个关键词或输入网站网址' : '输入网站名称、关键词或网址，联网查找订阅'}
              </p>
            </div>
          )}
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
    ) : (
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
                <div className="flex items-center justify-between gap-3">
                  <p className="font-mono text-[10px] tracking-[0.1em] text-paper-faint">使用实例</p>
                  {onUpdateRssHubInstances ? <button type="button" onClick={() => setShowInstances(true)}
                    className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[11px] text-cinnabar-soft transition-colors hover:bg-cinnabar/8">
                    管理服务 <ChevronRight size={12} />
                  </button> : null}
                </div>
                <div>
                  <FeedStorePicker title="使用 RSSHub 实例" value={selectedInstance?.id ?? ''}
                    disabled={!instances.some((item) => item.enabled)}
                    options={instances.filter((item) => item.enabled).map((item) => ({ id: item.id, label: item.name + ' · ' + new URL(item.url).hostname }))}
                    onChange={(id) => {
                      previewController.current?.abort()
                      setPreview(null)
                      setSelectedInstanceId(id)
                    }}
                  />
                </div>
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
