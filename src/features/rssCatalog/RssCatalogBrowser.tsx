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
  return <section aria-label="RSS 目录" className="space-y-4">
    {/* 紧凑精致的概览卡片 */}
    <header className="relative overflow-hidden rounded-2xl border border-haze/80 bg-ink-raised/60 p-4 shadow-sm">
      <BookOpen aria-hidden="true" size={80} strokeWidth={0.5} className="pointer-events-none absolute -right-3 -top-2 rotate-12 text-cinnabar/10" />
      <div className="relative flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">RSS · 独立阅读与精选</p>
          <h2 className="mt-0.5 font-display text-[15px] font-medium text-paper">从好奇，找到好内容。</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-paper-faint">精选各领域优质源 · 本机离线即搜</p>
        </div>
        <dl className="flex shrink-0 gap-4 border-l border-haze/70 pl-3.5 text-right font-mono text-paper">
          <div><dt className="text-[9.5px] text-paper-faint">订阅源</dt><dd className="mt-0.5 text-sm font-semibold">{feeds?.length.toLocaleString() ?? '—'}</dd></div>
          <div><dt className="text-[9.5px] text-paper-faint">专题</dt><dd className="mt-0.5 text-sm font-semibold">{categories.length || '—'}</dd></div>
          <div><dt className="text-[9.5px] text-paper-faint">语言</dt><dd className="mt-0.5 text-sm font-semibold">{languages.length || '—'}</dd></div>
        </dl>
      </div>
    </header>

    {/* 搜索框 */}
    <div className="space-y-1.5">
      <label htmlFor="rss-catalog-query" className="block font-mono text-[10px] tracking-[0.12em] text-paper-faint">搜索目录</label>
      <div className="flex min-h-12 items-center gap-2.5 rounded-2xl border border-haze bg-ink-raised/80 px-3.5 shadow-sm transition-colors focus-within:border-cinnabar/45 focus-within:ring-1 focus-within:ring-cinnabar/20">
        <Search aria-hidden="true" size={16} className="shrink-0 text-paper-faint" />
        <input id="rss-catalog-query" type="text" inputMode="search" role="searchbox" value={query} maxLength={300} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE) }} placeholder="名称、领域、关键词或域名" autoComplete="off" className="min-w-0 flex-1 bg-transparent py-3 text-[13.5px] text-paper outline-none placeholder:text-paper-faint/65" />
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
      <p role="status" className="text-[11px] text-paper-faint">{status}</p>
      {failed ? <button type="button" onClick={() => { setFailed(false); setLoading(true); setAttempt((value) => value + 1) }} className="min-h-8 text-[11.5px] text-cinnabar-soft hover:underline">重试</button> : <span aria-live="polite" className="font-mono text-[11px] text-paper-muted">{results.length} 个结果</span>}
    </div>

    {/* 空状态 */}
    {!loading && !results.length && !failed ? <div className="rounded-2xl border border-haze/70 bg-ink-raised/35 px-4 py-10 text-center"><p className="text-[13.5px] font-medium text-paper">没有找到匹配的订阅源</p><p className="mt-1 text-[11.5px] text-paper-faint">试试更短的关键词，或放宽专题与语言限制。</p><button type="button" onClick={reset} className="mt-3.5 inline-flex min-h-9 items-center rounded-full border border-cinnabar/35 bg-cinnabar/10 px-3.5 text-[11.5px] text-cinnabar-soft transition-colors hover:bg-cinnabar/16">重置筛选</button></div> : null}

    {/* 列表 */}
    <div className="divide-y divide-haze/70 border-b border-haze/70">
      {results.slice(0, limit).map((feed) => {
        const entry = entryFor(feed)
        const duplicate = duplicateLabel(entry)
        let hostname = ''
        try { hostname = new URL(feed.url).hostname } catch {}
        return <button data-catalog-feed key={feed.id} type="button" onClick={() => onSelect(entry)} className="group flex min-h-[76px] w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-paper/3 focus-visible:outline-2 focus-visible:outline-cinnabar">
          <span aria-hidden="true" className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-cinnabar/20 bg-cinnabar/8 font-display text-base font-medium text-cinnabar-soft transition-colors group-hover:border-cinnabar/40 group-hover:bg-cinnabar/12">{feed.title.slice(0, 1)}</span>
          <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-medium leading-snug text-paper transition-colors group-hover:text-cinnabar-soft">{feed.title}</span><span className="mt-1 flex items-center gap-1.5 text-[11px] text-paper-faint"><Globe2 size={11} className="shrink-0" /><span className="truncate">{hostname}</span></span><span className="mt-1.5 block text-[10.5px] text-paper-muted">{feed.category} · {languageName(feed.language)}{feed.region !== 'Global' && feed.region !== '未标注' ? ' · ' + feed.region : ''}</span></span>
          <span className="flex shrink-0 flex-col items-end justify-between gap-2.5 self-stretch pt-0.5">{duplicate ? <span className="flex items-center gap-1 rounded-full bg-cinnabar/10 px-2 py-0.5 text-[10px] text-cinnabar-soft"><Check size={11} strokeWidth={2} />{duplicate}</span> : <span className="inline-flex items-center gap-0.5 text-[10.5px] text-paper-faint transition-colors group-hover:text-cinnabar-soft">预览订阅<ArrowUpRight aria-hidden="true" size={13} className="shrink-0 text-paper-faint group-hover:text-cinnabar-soft" /></span>}</span>
        </button>
      })}
    </div>
    {results.length > limit ? <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="min-h-11 w-full rounded-2xl border border-haze/80 bg-ink-raised/50 text-[12px] text-paper-muted transition-colors hover:border-cinnabar/40 hover:text-paper">加载更多</button> : null}
    <p className="pb-3 text-center text-[10.5px] leading-relaxed text-paper-faint">目录收录不代表当前可用。选择后可检测并预览，确认内容再订阅。</p>
  </section>
}
