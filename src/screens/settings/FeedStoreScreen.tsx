import { useEffect, useRef, useState } from 'react'
import { Search, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { SettingsSection, SettingsShell } from '../../components/SettingsShell'
import { FeedStorePicker } from '../../features/feedDiscovery/FeedStorePicker'
import { searchOnlineFeeds } from '../../features/feedDiscovery/onlineSearch'
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
export interface FeedStoreNavigationState {
  tab: 'discover' | 'subscribed'
  query: string
  scrollTop: number
  results?: FeedDiscoveryEntry[]
  searchedQuery?: string
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
  onUpdateSubscription: (sourceId: string, url: string, discovery: SourceDiscoveryMetadata) => { ok: boolean; message?: string }
  onDelete: (sourceId: string) => { ok: boolean; message?: string }
  onOpenSource: (sourceId: string) => void
  navigationState: FeedStoreNavigationState
  onNavigationStateChange: (state: FeedStoreNavigationState) => void
  onBack: () => void
}

export function FeedStoreScreen({ prefs, currentCategoryId, currentPresetId, currentPresetName, enabledIds, onSubscribe, onAddBuiltinToCategory, onPause, onDelete, onOpenSource, navigationState, onNavigationStateChange, onBack }: Props) {
  const [tab, setTab] = useState(navigationState.tab)
  const [query, setQuery] = useState(navigationState.query)
  const [results, setResults] = useState<FeedDiscoveryEntry[]>(navigationState.results ?? [])
  const [searchedQuery, setSearchedQuery] = useState(navigationState.searchedQuery ?? '')
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
  const categories = allRegisteredCategories(prefs).filter((item) => !isAggregateCategoryId(item.id))
  const stateRef = useRef(navigationState)
  stateRef.current = { tab, query, results, searchedQuery, scrollTop: navigationState.scrollTop }
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      const scroll = document.querySelector<HTMLElement>('[data-settings-scroll]')
      if (scroll) scroll.scrollTop = navigationState.scrollTop
    }, 0)
    void clearLegacyDiscoveryCache()
    return () => {
      globalThis.clearTimeout(timer)
      searchController.current?.abort()
      previewController.current?.abort()
      onNavigationStateChange({ ...stateRef.current, scrollTop: document.querySelector<HTMLElement>('[data-settings-scroll]')?.scrollTop ?? stateRef.current.scrollTop })
    }
  }, [navigationState.scrollTop, onNavigationStateChange])

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
  const openEntry = (next: FeedDiscoveryEntry) => {
    closeEntry()
    setEntry(next)
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
      const found = await searchOnlineFeeds(query, controller.signal)
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
    if (!entry?.feedUrl) return
    previewController.current?.abort()
    const controller = new AbortController()
    previewController.current = controller
    setPreviewing(true)
    setError(null)
    try {
      const next = await previewFeed(entry.feedUrl, { signal: controller.signal })
      if (previewController.current === controller && !controller.signal.aborted) setPreview(next)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '检测失败')
    } finally {
      if (previewController.current === controller) { previewController.current = null; setPreviewing(false) }
    }
  }
  const subscribe = (unverified = false) => {
    if (!entry?.feedUrl || previewing || (!preview?.ok && !(unverified && preview && !preview.ok && preview.retryable))) return
    const duplicate = findSubscriptionDuplicate(prefs, { url: entry.feedUrl })
    if (duplicate?.kind === 'custom' || duplicate?.kind === 'generator-route') { onOpenSource(duplicate.source.id); return }
    if (duplicate && target === '__save_only__') { setError('该来源已内置，可直接查看，无需重复保存。'); return }
    const destination = target === '__save_only__' || target === '__mix_only__' ? undefined : target
    const outcome = duplicate
      ? onAddBuiltinToCategory(duplicate.source.id, destination ?? FOLLOWS_ENABLED_SOURCES, presetId, addToMix)
      : onSubscribe({ name: preview?.ok ? preview.title || entry.title : entry.title, label: entry.title.slice(0, 12), kind: 'feed', url: entry.feedUrl, siteUrl: entry.siteUrl, discovery: { providerId: entry.providerId, entryId: entry.entryId, generator: 'feed', verification: { status: preview?.ok ? 'verified' : 'unverified', checkedAt: preview?.ok ? preview.checkedAt : undefined } } }, destination, target === '__save_only__' ? false : target === '__mix_only__' || addToMix, presetId)
    if (!outcome.ok) { setError(outcome.message ?? '订阅保存失败'); return }
    setSavedId(duplicate?.source.id ?? makeCustomSourceId(entry.feedUrl))
    closeEntry()
  }
  const subscribed = (prefs.customSources ?? []).filter((source) => (source.name + ' ' + source.url).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const duplicateLabel = (item: FeedDiscoveryEntry) => {
    const duplicate = findSubscriptionDuplicate(prefs, { url: item.feedUrl ?? '' })
    return duplicate ? duplicate.kind === 'builtin' ? '已内置' : duplicate.source.paused ? '已暂停' : '已订阅' : null
  }
  return <SettingsShell title="RSS 订阅商店" caption="在线查找订阅地址 · 订阅后由本机直连来源" onBack={onBack}>
    <div className="page-x flex gap-1 border-b border-haze pb-3">
      {(['discover', 'subscribed'] as const).map((value) => <button key={value} type="button" onClick={() => { setTab(value); setError(null) }} className={'min-h-11 flex-1 rounded-md text-[12px] ' + (tab === value ? 'bg-ink-raised text-paper' : 'text-paper-muted')}>{value === 'discover' ? '发现' : '已订阅'}</button>)}
    </div>
    <form className="page-x pt-4" onSubmit={(event) => { event.preventDefault(); if (tab === 'discover') void search() }}>
      <label htmlFor="feed-store-search" className="text-[11px] text-paper-faint">{tab === 'discover' ? '搜索网站、关键词或订阅地址' : '搜索已订阅'}</label>
      <div className="mt-2 flex min-h-11 items-center gap-2 rounded-md border border-haze px-3">
        <Search size={15} className="text-paper-faint" /><input id="feed-store-search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="例如 OpenAI、少数派、https://example.com" className="min-w-0 flex-1 bg-transparent text-[13px] text-paper outline-none" />
        {query ? <button type="button" aria-label="清除搜索" onClick={() => changeQuery('')} className="min-h-11 min-w-11 text-paper-faint"><X size={15} /></button> : null}
      </div>
      {tab === 'discover' ? <><button type="button" onClick={() => void search()} disabled={searching || !query.trim()} className="mt-2 min-h-11 text-[12px] text-cinnabar disabled:opacity-40">{searching ? '正在在线搜索…' : '在线搜索'}</button><p className="pb-3 text-[10px] text-paper-faint">关键词发送到 Feedly；网址由目标网站与 Feedsearch 查找。结果仅在本次页面临时保留。</p></> : null}
    </form>
    {error ? <p role="alert" className="page-x py-3 text-[12px] text-cinnabar">{error}</p> : null}
    {savedId ? <div role="status" className="page-x flex items-center gap-3 py-3 text-[11px] text-paper-muted"><span>订阅已保存</span><button type="button" onClick={() => onOpenSource(savedId)} className="min-h-11 text-cinnabar">查看订阅</button><button type="button" onClick={() => { setSavedId(null); setTab('discover') }} className="min-h-11 text-cinnabar">继续发现</button></div> : null}
    {tab === 'discover' ? <SettingsSection title={searchedQuery ? '在线结果 · ' + results.length : '在线发现'}>
      <div aria-live="polite">
        {results.map((item) => <button key={item.entryId} type="button" onClick={() => openEntry(item)} className="page-x block min-h-16 w-full border-b border-haze py-3 text-left"><span className="block text-[13px] text-paper">{item.title} {duplicateLabel(item) ? <span className="text-[10px] text-cinnabar">{duplicateLabel(item)}</span> : null}</span>{item.description ? <span className="mt-1 line-clamp-2 block text-[11px] text-paper-muted">{item.description}</span> : null}<span className="mt-1 block break-all font-mono text-[10px] text-paper-faint">{item.feedUrl}</span></button>)}
        {!results.length && !searching ? <p className="page-x py-8 text-center text-[12px] text-paper-faint">{searchedQuery ? '没有找到订阅地址，请换个关键词或输入网站网址' : '输入网站名称、关键词或网址，联网查找订阅'}</p> : null}
      </div>
      {results.some((item) => item.providerId === 'feedly') ? <a href="https://feedly.com/" target="_blank" rel="noopener noreferrer" className="page-x block py-3 text-[10px] text-paper-faint">搜索结果来自 Feedly</a> : null}
      {results.some((item) => item.providerId === 'feedsearch') ? <a href="https://feedsearch.dev/" target="_blank" rel="noopener noreferrer" className="page-x block py-3 text-[10px] text-paper-faint">网站发现由 Feedsearch 提供</a> : null}
    </SettingsSection> : <SettingsSection title={'全部自建订阅 · ' + (prefs.customSources?.length ?? 0)}>
      <p className="page-x pb-3 text-[11px] text-paper-muted">暂停影响所有预设，已缓存内容保留。</p>
      {subscribed.map((source) => {
        const members = categories.filter((category) => categorySourceIds(category.id, prefs).includes(source.id))
        return <div key={source.id} className="page-x flex items-center gap-2 border-b border-haze py-3">
          <button type="button" onClick={() => onOpenSource(source.id)} className="min-h-11 min-w-0 flex-1 text-left"><span className="block truncate text-[13px] text-paper">{source.name}</span><span className="mt-1 block text-[10px] text-paper-faint">{members.length ? members.map((category) => category.label).join(' · ') : '未加入当前预设分类'}{enabledIds.includes(source.id) ? ' · 综合' : ''}</span></button>
          {!members.length ? <button type="button" onClick={() => { const destination = categories.find((category) => category.id === currentCategoryId) ?? visibleCategories(prefs).find((category) => !isAggregateCategoryId(category.id)); const outcome = onAddBuiltinToCategory(source.id, destination?.id ?? FOLLOWS_ENABLED_SOURCES, currentPresetId); setError(outcome.ok ? null : outcome.message ?? '保存失败') }} className="min-h-11 text-[10px] text-cinnabar">加入当前分类</button> : null}
          <button type="button" aria-label={(source.paused ? '恢复 ' : '暂停 ') + source.name} onClick={() => { const outcome = onPause(source.id, !source.paused); setError(outcome.ok ? null : outcome.message ?? '订阅保存失败') }} className="min-h-11 min-w-11 text-[10px] text-cinnabar">{source.paused ? '已暂停' : '启用'}</button>
          <button type="button" aria-label={'删除 ' + source.name} onClick={() => { setError(null); setDeleteSource(source) }} className="min-h-11 min-w-11 text-paper-faint"><Trash2 size={15} /></button>
        </div>
      })}
      {!subscribed.length ? <p className="page-x py-8 text-center text-[12px] text-paper-faint">{query ? '没有匹配的自建订阅' : '还没有自建订阅'}</p> : null}
    </SettingsSection>}
    {entry ? <div className="absolute inset-0 z-40 bg-ink" style={{ paddingBottom: 'var(--sab)' }}><SettingsShell title={entry.title} caption="实际检测后订阅" onBack={closeEntry}>
      <div className="page-x space-y-4 pt-4">
        <p className="break-all font-mono text-[11px] text-paper-muted">{entry.feedUrl}</p>
        <p className="text-[11px] text-paper-faint">当前预设：{currentPresetName}</p>
        <FeedStorePicker title="加入分类" value={target} onChange={setTarget} options={[...categories.map((category) => ({ id: category.id, label: category.label })), { id: '__mix_only__', label: '加入综合' }, { id: '__save_only__', label: '仅保存，暂不加入信息流' }]} />
        {target !== '__mix_only__' && target !== '__save_only__' ? <label className="flex min-h-11 items-center gap-2 text-[12px] text-paper-muted"><input type="checkbox" checked={addToMix} onChange={(event) => setAddToMix(event.target.checked)} />同时加入综合</label> : null}
        <button type="button" disabled={previewing} onClick={() => void runPreview()} className="min-h-11 text-[12px] text-cinnabar disabled:opacity-40">{previewing ? '正在检测与预览' : '检测与预览'}</button>
        {preview?.ok ? <div className="text-[12px] text-paper-muted"><p>本次检测成功 · {preview.itemCount} 条 · {new Date(preview.checkedAt).toLocaleTimeString()}</p>{preview.itemCount === 0 ? <p>当前暂无条目</p> : <ul>{preview.articles.map((article, index) => <li key={index} className="py-2">{article.title}</li>)}</ul>}</div> : preview ? <p role="alert" className="text-[12px] text-cinnabar">{preview.message}</p> : null}
        {error ? <p role="alert" className="text-[12px] text-cinnabar">{error}</p> : null}
        <button type="button" disabled={!preview?.ok || previewing} onClick={() => subscribe()} className="min-h-11 w-full rounded-full bg-cinnabar text-[12px] text-white disabled:opacity-30">订阅</button>
        {preview && !preview.ok && preview.retryable && !previewing ? <button type="button" onClick={() => subscribe(true)} className="min-h-11 text-[11px] text-paper-muted">仍添加，稍后重试</button> : null}
      </div>
    </SettingsShell></div> : null}
    <ConfirmDialog open={Boolean(deleteSource)} title="删除订阅？" message={error ?? '将删除此订阅，并清理各预设中的分类和综合引用。'} confirmLabel="删除" danger onCancel={() => { setDeleteSource(null); setError(null) }} onConfirm={() => { if (!deleteSource) return; const outcome = onDelete(deleteSource.id); if (!outcome.ok) { setError(outcome.message ?? '删除保存失败'); return }; if (savedId === deleteSource.id) setSavedId(null); setDeleteSource(null) }} />
  </SettingsShell>
}
