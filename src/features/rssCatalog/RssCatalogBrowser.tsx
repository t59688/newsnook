import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowUpRight, BookOpen, Check, Globe2, Search, X } from 'lucide-react'
import type { FeedDiscoveryEntry } from '../feedDiscovery/types'
import { FeedStorePicker } from '../feedDiscovery/FeedStorePicker'
import { createCatalogIndex, searchCatalog } from './search'
import { rssCatalogService } from './runtime'
import type { CatalogService } from './service'
import type { CatalogFeed } from './schema'

const PAGE_SIZE = 30
const languageName = (code: string) => {
  if (code === 'und') return '未标注语言'
  if (code === 'zh') return '中文'
  if (code === 'en') return '英文'
  try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code) ?? code } catch { return code }
}
function entryFor(feed: CatalogFeed): FeedDiscoveryEntry {
  return { providerId: 'rss-catalog', entryId: feed.id, type: 'direct', title: feed.title, feedUrl: feed.url, categories: [feed.category], description: [feed.region, ...feed.tags].join(' · '), statusNote: '目录收录不代表当前可用，订阅前请检测并预览。' }
}
interface Props { onSelect(entry: FeedDiscoveryEntry): void; duplicateLabel(entry: FeedDiscoveryEntry): string | null | undefined; service?: CatalogService }
export function RssCatalogBrowser({ onSelect, duplicateLabel, service = rssCatalogService }: Props) {
  const state = useSyncExternalStore((listener) => service.subscribe(listener), () => service.snapshot, () => null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [language, setLanguage] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [status, setStatus] = useState('正在打开本地目录…')
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const update = () => {
      void service.refresh().then(() => { if (active) setStatus('本地目录已就绪 · 可离线查找') }, () => { if (active) setStatus('已保留本地目录，稍后自动重试更新') })
    }
    void service.load().then(() => {
      if (!active) return
      setLoading(false)
      setStatus('本地目录可用，自动检查更新')
      update()
    }, () => { if (active) { setLoading(false); setFailed(true); setStatus('本地目录暂时无法打开，请重试') } })
    return () => { active = false }
  }, [service, attempt])
  const feeds = state?.catalog.feeds
  const index = useMemo(() => createCatalogIndex(feeds ?? []), [feeds])
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feed of feeds ?? []) counts.set(feed.category, (counts.get(feed.category) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
  }, [feeds])
  const languages = useMemo(() => [...new Set(feeds?.map((feed) => feed.language))].sort(), [feeds])
  const results = useMemo(() => searchCatalog(index, { query, category, language }), [index, query, category, language])
  const reset = () => { setQuery(''); setCategory(''); setLanguage(''); setLimit(PAGE_SIZE) }
  return <section aria-label="RSS 目录" className="space-y-5">
    <header className="relative overflow-hidden rounded-2xl border border-haze bg-ink-raised px-5 py-6">
      <BookOpen aria-hidden="true" size={100} strokeWidth={0.6} className="pointer-events-none absolute -right-3 -top-2 rotate-12 text-cinnabar/15" />
      <p className="mb-3 font-mono text-[10px] tracking-[0.2em] text-cinnabar-soft">RSS · 自己选择，慢慢阅读</p>
      <h2 className="font-display text-[27px] leading-tight text-paper">从好奇，找到好内容。</h2>
      <p className="relative mt-3 max-w-72 text-[12px] leading-relaxed text-paper-muted">浏览不同领域的订阅源，建立自己的阅读地图。搜索在本机完成，断网也能发现。</p>
      <dl className="mt-5 flex gap-7 border-t border-haze pt-4 text-paper">
        <div><dt className="text-[10px] text-paper-faint">订阅源</dt><dd className="mt-1 font-mono text-xl">{feeds?.length.toLocaleString() ?? '—'}</dd></div>
        <div><dt className="text-[10px] text-paper-faint">专题</dt><dd className="mt-1 font-mono text-xl">{categories.length || '—'}</dd></div>
        <div><dt className="text-[10px] text-paper-faint">语言</dt><dd className="mt-1 font-mono text-xl">{languages.length || '—'}</dd></div>
      </dl>
    </header>
    <div className="space-y-2">
      <label htmlFor="rss-catalog-query" className="text-xs text-paper-muted">搜索目录</label>
      <div className="flex min-h-12 items-center gap-2 rounded-xl border border-haze bg-ink-raised px-3 focus-within:border-cinnabar">
        <Search aria-hidden="true" size={17} className="shrink-0 text-paper-faint" />
        <input id="rss-catalog-query" type="text" inputMode="search" role="searchbox" value={query} maxLength={300} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }} placeholder="名称、领域、关键词或域名" autoComplete="off" className="min-w-0 flex-1 bg-transparent py-3 text-[13px] text-paper outline-none placeholder:text-paper-faint" />
        {query ? <button type="button" aria-label="清除目录搜索" onClick={() => { setQuery(''); setLimit(PAGE_SIZE) }} className="grid size-11 place-items-center text-paper-muted"><X size={16} /></button> : null}
      </div>
    </div>
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium text-paper">按兴趣探索</h3>
      <div className="min-w-0 max-w-[55%]">
        <FeedStorePicker title="目录语言" value={language} options={[{ id: '', label: '全部语言' }, ...languages.map((code) => ({ id: code, label: languageName(code) }))]} onChange={(value) => { setLanguage(value); setLimit(PAGE_SIZE) }} />
      </div>
    </div>
    <div role="group" aria-label="目录专题" className="flex max-h-48 flex-wrap gap-2 overflow-y-auto p-0.5">
      <button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setLimit(PAGE_SIZE) }} className={`min-h-11 rounded-full border px-3 text-xs ${!category ? 'border-cinnabar bg-cinnabar/10 text-cinnabar-soft' : 'border-haze text-paper-muted'}`}>全部专题</button>
      {categories.map(([name, count]) => <button key={name} type="button" aria-pressed={category === name} onClick={() => { setCategory(category === name ? '' : name); setLimit(PAGE_SIZE) }} className={`min-h-11 rounded-full border px-3 text-xs ${category === name ? 'border-cinnabar bg-cinnabar/10 text-cinnabar-soft' : 'border-haze text-paper-muted hover:border-cinnabar/40'}`}><span>{name}</span><span aria-hidden="true" className="ml-2 font-mono text-[10px] opacity-60">{count}</span></button>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-haze pb-3">
      <p role="status" className="text-[11px] text-paper-faint">{status}</p>
      {failed ? <button type="button" onClick={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1) }} className="min-h-11 text-xs text-cinnabar-soft">重试</button> : <span aria-live="polite" className="text-[11px] text-paper-muted">{results.length} 个结果</span>}
    </div>
    {!loading && !results.length && !failed ? <div className="py-8 text-center"><p className="text-sm text-paper">没有找到匹配的订阅源</p><p className="mt-2 text-xs text-paper-faint">试试更短的关键词，或放宽专题与语言。</p><button type="button" onClick={reset} className="mt-3 min-h-11 text-xs text-cinnabar-soft">重置筛选</button></div> : null}
    <div className="divide-y divide-haze border-b border-haze">
      {results.slice(0, limit).map((feed) => {
        const entry = entryFor(feed)
        const duplicate = duplicateLabel(entry)
        return <button data-catalog-feed key={feed.id} type="button" onClick={() => onSelect(entry)} className="group flex min-h-24 w-full gap-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-cinnabar">
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl border border-haze bg-ink-raised font-display text-lg text-cinnabar-soft">{feed.title.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium leading-snug text-paper group-hover:text-cinnabar-soft">{feed.title}</span><span className="mt-1.5 flex items-center gap-1 text-[11px] text-paper-faint"><Globe2 size={11} /><span className="truncate">{new URL(feed.url).hostname}</span></span><span className="mt-2 block text-[10px] text-paper-muted">{feed.category} · {languageName(feed.language)}{feed.region !== 'Global' && feed.region !== '未标注' ? ' · ' + feed.region : ''}</span></span>
          <span className="flex shrink-0 flex-col items-end justify-between gap-2">{duplicate ? <span className="flex items-center gap-1 text-[10px] text-cinnabar-soft"><Check size={12} />{duplicate}</span> : null}<ArrowUpRight aria-hidden="true" size={16} className="text-paper-faint group-hover:text-cinnabar-soft" /><span className="text-[10px] text-paper-faint">预览订阅</span></span>
        </button>
      })}
    </div>
    {results.length > limit ? <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="min-h-12 w-full rounded-xl border border-haze text-xs text-paper-muted hover:border-cinnabar/40">加载更多</button> : null}
    <p className="pb-3 text-[10px] leading-relaxed text-paper-faint">目录收录不代表当前可用。选择后可检测并预览，确认内容再订阅。</p>
  </section>
}
