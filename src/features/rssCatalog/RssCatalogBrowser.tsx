import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, BookOpen, Check, Globe2, Search, X } from 'lucide-react'
import type { FeedDiscoveryEntry } from '../feedDiscovery/types'
import { FeedStorePicker } from '../feedDiscovery/FeedStorePicker'
import { catalogEntryFor } from './entry'
import { createCatalogIndex, searchCatalog } from './search'
import type { CatalogService } from './service'
import type { CatalogFeed } from './schema'
import type { CatalogWorkerResult } from './workerClient'
import { getCatalogWorkerClient, resetCatalogWorkerClient } from './workerClient'

const PAGE_SIZE = 30
const EMPTY_FEEDS: CatalogFeed[] = []
const EMPTY_INDEX = createCatalogIndex(EMPTY_FEEDS)
const platformNames: Record<string, string> = {
  bilibili: 'B站', wechat: '微信公众号', youtube: 'YouTube',
  telegram: 'Telegram', douban: '豆瓣', jike: '即刻',
  weibo: '微博', zhihu: '知乎', reddit: 'Reddit', webcomic: '漫画',
  xiaohongshu: '小红书', douyin: '抖音',
  twitter: 'X / Twitter',
}

const languageName = (code: string) => {
  if (code === 'und') return '未标注语言'
  if (code === 'zh') return '中文'
  if (code === 'en') return '英文'
  try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code) ?? code } catch { return code }
}
interface Props { onSelect(entry: FeedDiscoveryEntry): void; duplicateLabel(entry: FeedDiscoveryEntry): string | null | undefined; service?: CatalogService }
export function RssCatalogBrowser({ onSelect, duplicateLabel, service }: Props) {
  const [workerUnsupported, setWorkerUnsupported] = useState(() => !service && typeof Worker === 'undefined')
  // Only injected services (tests) use the synchronous adapter. Production
  // WebViews parse and search exclusively in the background worker.
  const activeService = service ?? null
  const subscribe = useCallback((listener: () => void) => activeService?.subscribe(listener) ?? (() => {}), [activeService])
  const getSnapshot = useCallback(() => activeService?.snapshot ?? null, [activeService])
  const state = useSyncExternalStore(subscribe, getSnapshot, () => null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [language, setLanguage] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [status, setStatus] = useState('正在打开本地目录…')
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  const [workerData, setWorkerData] = useState<{ key: string; result: CatalogWorkerResult } | null>(null)
  const [workerUpdateFailed, setWorkerUpdateFailed] = useState(false)
  const workerKey = JSON.stringify([query, category, language, limit])

  useEffect(() => {
    if (!activeService) return
    let active = true
    const update = () => {
      void activeService.refresh().then(() => { if (active) setStatus('本地目录已就绪 · 可离线查找') }, () => { if (active) setStatus('已保留本地目录，稍后自动重试更新') })
    }
    void activeService.load().then(() => {
      if (!active) return
      setLoading(false)
      setStatus('本地目录可用，自动检查更新')
      update()
    }, () => { if (active) { setLoading(false); setFailed(true); setStatus('本地目录暂时无法打开，请重试') } })
    return () => { active = false }
  }, [activeService, attempt])

  useEffect(() => {
    if (activeService || workerUnsupported) return
    let active = true
    let client
    try { client = getCatalogWorkerClient() }
    catch { setWorkerUnsupported(true); return }
    const search = () => {
      void client.query({ query, category, language, limit })
        .then((result) => { if (active) setWorkerData({ key: workerKey, result }) })
        .catch(() => { if (active) setWorkerUnsupported(true) })
    }
    const unsubscribe = client.subscribe(search)
    search()
    return () => { active = false; unsubscribe() }
  }, [activeService, workerUnsupported, query, category, language, limit, workerKey, attempt])

  useEffect(() => {
    if (activeService || workerUnsupported) return
    let active = true
    try {
      void getCatalogWorkerClient().refresh()
        .then(() => { if (active) setWorkerUpdateFailed(false) },
          () => { if (active) setWorkerUpdateFailed(true) })
    } catch { setWorkerUnsupported(true) }
    return () => { active = false }
  }, [activeService, workerUnsupported, attempt])

  const feeds = state?.catalog.feeds
  const index = useMemo(() => activeService ? createCatalogIndex(feeds ?? EMPTY_FEEDS) : EMPTY_INDEX, [activeService, feeds])
  const localCategories = useMemo(() => {
    if (!activeService) return []
    const counts = new Map<string, number>()
    for (const feed of feeds ?? EMPTY_FEEDS) counts.set(feed.category, (counts.get(feed.category) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
  }, [activeService, feeds])
  const localLanguages = useMemo(() => activeService ? [...new Set((feeds ?? EMPTY_FEEDS).map((feed) => feed.language))].sort() : [], [activeService, feeds])
  const localResults = useMemo(() => activeService ? searchCatalog(index, { query, category, language }) : EMPTY_FEEDS, [activeService, index, query, category, language])
  const currentWorkerResult = workerData?.key === workerKey ? workerData.result : null
  const categories = activeService ? localCategories : (workerData?.result.summary.categories ?? [])
  const languages = activeService ? localLanguages : (workerData?.result.summary.languages ?? [])
  const results = activeService ? localResults : (currentWorkerResult?.feeds ?? EMPTY_FEEDS)
  const resultCount = activeService ? results.length : (currentWorkerResult?.total ?? 0)
  const displayLoading = activeService ? loading : !currentWorkerResult && !workerUnsupported
  const displayFailed = activeService ? failed : workerUnsupported
  const hasSummary = activeService ? feeds !== undefined : Boolean(workerData?.result.summary)
  const displayStatus = activeService ? status : workerUnsupported
    ? 'RSS 目录后台处理不可用，请重试或升级系统 WebView' : !workerData
    ? '正在打开本地目录…'
    : workerUpdateFailed ? '已保留本地目录，稍后自动重试更新' : '本地目录已就绪 · 可离线查找'
  const reset = () => { setQuery(''); setCategory(''); setLanguage(''); setLimit(PAGE_SIZE) }
  return <section aria-label="RSS 目录" className="editorial-rss-catalog space-y-4">
    {/* 紧凑精致的概览卡片 */}
    <header className="relative overflow-hidden rounded-2xl border border-haze/80 bg-ink-raised/60 p-4 shadow-sm">
      <BookOpen aria-hidden="true" size={80} strokeWidth={0.5} className="pointer-events-none absolute -right-3 -top-2 rotate-12 text-cinnabar/10" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11.5px] tracking-[0.09em] text-cinnabar-soft">RSS · 独立阅读与精选</p>
          <h2 className="mt-1 font-display text-[19px] font-semibold leading-snug text-paper">从好奇，找到好内容。</h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-muted">精选各领域优质源 · 本机离线即搜</p>
        </div>
        {hasSummary && <dl className="hidden shrink-0 gap-4 border-l border-haze/70 pl-3.5 text-right font-mono text-paper sm:flex">
          <div><dt className="text-[9.5px] text-paper-faint">订阅源</dt><dd className="mt-0.5 text-sm font-semibold">{activeService ? (feeds?.length.toLocaleString() ?? '—') : (workerData?.result.summary.count.toLocaleString() ?? '—')}</dd></div>
          <div><dt className="text-[9.5px] text-paper-faint">专题</dt><dd className="mt-0.5 text-sm font-semibold">{categories.length || '—'}</dd></div>
          <div><dt className="text-[9.5px] text-paper-faint">语言</dt><dd className="mt-0.5 text-sm font-semibold">{languages.length || '—'}</dd></div>
        </dl>}
      </div>
    </header>

    {/* 搜索框 */}
    <div className="space-y-1.5">
      <label htmlFor="rss-catalog-query" className="block font-mono text-[11.5px] tracking-[0.05em] text-paper-muted">搜索目录</label>
      <div className="flex min-h-12 items-center gap-2.5 rounded-2xl border border-haze bg-ink-raised/80 px-3.5 shadow-sm transition-colors focus-within:border-cinnabar/45 focus-within:ring-1 focus-within:ring-cinnabar/20">
        <Search aria-hidden="true" size={16} className="shrink-0 text-paper-faint" />
        <input id="rss-catalog-query" type="text" inputMode="search" role="searchbox" value={query} maxLength={300} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }} placeholder="名称、领域、关键词或域名" autoComplete="off" className="min-w-0 flex-1 bg-transparent py-3 text-[14.5px] text-paper outline-none placeholder:text-paper-faint/75" />
        {query ? <button type="button" aria-label="清除目录搜索" onClick={() => { setQuery(''); setLimit(PAGE_SIZE) }} className="grid size-9 place-items-center rounded-full text-paper-faint transition-colors hover:bg-paper/6 hover:text-paper"><X size={15} /></button> : null}
      </div>
    </div>

    {/* 专题与语言筛选 */}
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[12px] font-medium text-paper">按兴趣探索</h3>
        <div className="min-w-0 max-w-[55%]">
          <FeedStorePicker title="目录语言" value={language} options={[{ id: '', label: '全部语言' }, ...languages.map((code) => ({ id: code, label: languageName(code) }))]} onChange={(value) => { setLanguage(value); setLimit(PAGE_SIZE) }} />
        </div>
      </div>
      <div role="group" aria-label="目录专题" className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto p-0.5">
        <button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setLimit(PAGE_SIZE) }} className={`min-h-9 rounded-full border px-3 text-[11.5px] transition-colors ${!category ? 'border-cinnabar/50 bg-cinnabar/12 font-medium text-cinnabar-soft shadow-xs' : 'border-haze/75 bg-ink-raised/40 text-paper-muted hover:border-cinnabar/30 hover:text-paper'}`}>全部专题</button>
        {categories.map(([name, count]) => <button key={name} type="button" aria-pressed={category === name} onClick={() => { setCategory(category === name ? '' : name); setLimit(PAGE_SIZE) }} className={`min-h-9 rounded-full border px-3 text-[11.5px] transition-colors ${category === name ? 'border-cinnabar/50 bg-cinnabar/12 font-medium text-cinnabar-soft shadow-xs' : 'border-haze/75 bg-ink-raised/40 text-paper-muted hover:border-cinnabar/30 hover:text-paper'}`}><span>{name}</span><span aria-hidden="true" className="ml-1.5 font-mono text-[10px] opacity-60">{count}</span></button>)}
      </div>
    </div>

    {/* 状态与统计 */}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-haze/70 pb-2.5">
      <p role="status" className={`text-[12px] leading-relaxed ${displayFailed ? 'text-cinnabar-soft' : 'text-paper-muted'}`}>{displayStatus}</p>
      {displayFailed ? <button type="button" onClick={() => {
        if (activeService) { setFailed(false); setLoading(true) }
        else { resetCatalogWorkerClient(); setWorkerData(null); setWorkerUnsupported(false) }
        setAttempt((value) => value + 1)
      }} className="min-h-9 rounded-lg px-2 text-[12.5px] font-medium text-cinnabar-soft hover:bg-cinnabar/10">重试</button> : <span aria-live="polite" className="font-mono text-[11px] text-paper-muted">{resultCount} 个结果</span>}
    </div>

    {/* 空状态 */}
    {!displayLoading && !results.length && !displayFailed ? <div className="rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-10 text-center"><p className="text-[13.5px] font-medium text-paper">没有找到匹配的订阅源</p><p className="mt-1 text-[11.5px] text-paper-faint">试试更短的关键词，或放宽专题与语言限制。</p><button type="button" onClick={reset} className="mt-3.5 inline-flex min-h-9 items-center rounded-full border border-cinnabar/35 bg-cinnabar/10 px-3.5 text-[11.5px] text-cinnabar-soft transition-colors hover:bg-cinnabar/16">重置筛选</button></div> : null}

    {/* 列表 */}
    <div className="divide-y divide-haze/70 border-b border-haze/70">
      {results.slice(0, limit).map((feed) => {
        const entry = catalogEntryFor(feed)
        const duplicate = duplicateLabel(entry)
        let hostname = ''
        try { hostname = new URL(feed.url).hostname } catch {}
        return <button data-catalog-feed key={feed.id} type="button" onClick={() => onSelect(entry)} className="group flex min-h-[76px] w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-paper/3 focus-visible:outline-2 focus-visible:outline-cinnabar">
          <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-cinnabar/20 bg-cinnabar/8 font-display text-base font-medium text-cinnabar-soft transition-colors group-hover:border-cinnabar/40 group-hover:bg-cinnabar/12">{feed.title.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-medium leading-snug text-paper transition-colors group-hover:text-cinnabar-soft">{feed.title}{feed.nsfw ? <span className="rounded border border-cinnabar/35 px-1.5 py-0.5 font-mono text-[9px] font-medium leading-none text-cinnabar-soft">NSFW</span> : null}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-paper-faint"><Globe2 size={11} className="shrink-0" /><span className="truncate">{hostname}</span></span><span className="mt-1.5 block text-[10.5px] text-paper-muted">{feed.platform ? (platformNames[feed.platform] ?? feed.platform) + ' · ' : ''}{feed.category} · {languageName(feed.language)}{feed.region !== 'Global' && feed.region !== '未标注' ? ' · ' + feed.region : ''}</span></span>
          <span className="flex shrink-0 flex-col items-end justify-between gap-2.5 self-stretch pt-0.5">{duplicate ? <span className="flex items-center gap-1 rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10px] text-cinnabar-soft"><Check size={11} strokeWidth={2} />{duplicate}</span> : <span className="inline-flex items-center gap-0.5 text-[10.5px] text-paper-faint transition-colors group-hover:text-cinnabar-soft">预览订阅<ArrowUpRight aria-hidden="true" size={13} className="shrink-0 text-paper-faint group-hover:text-cinnabar-soft" /></span>}</span>
        </button>
      })}
    </div>
    {resultCount > limit ? <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="min-h-11 w-full rounded-2xl border border-haze/80 bg-ink-raised/50 text-[12px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper">加载更多</button> : null}
    <p className="pb-3 text-center text-[12px] leading-relaxed text-paper-faint">目录收录不代表当前可用，选择后可检测并预览。</p>
  </section>
}
