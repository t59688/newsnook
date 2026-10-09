import { memo, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react'
import type { FrameworkHint } from '../features/frameworkDetect/types'
import type { NewsSource } from '../sources/registry'
import type { Article } from '../lib/types'
import { useCatalogSession } from '../features/siteCatalog/useCatalogSession'
import { catalogProfileFor } from '../features/siteCatalog/profile'
import { catalogSearchRequest } from '../features/siteCatalog/requests'

interface Props {
  sites: { source: NewsSource; hint?: FrameworkHint }[]
  readIds: Set<string>
  onOpen: (article: Article) => void
  onBack?: () => void
}

export const SiteScreen = memo(function SiteScreen({ sites, readIds, onOpen, onBack }: Props) {
  const [selectedId, setSelectedId] = useState(sites[0]?.source.id)
  const source = (sites.find((site) => site.source.id === selectedId) ?? sites[0])?.source
  const { session, state } = useCatalogSession(source)
  const [query, setQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [selectedUrl, setSelectedUrl] = useState('')
  const profile = state.page?.profile ?? (source ? catalogProfileFor(source) : undefined)
  useEffect(() => {
    setQuery('')
    setSearchActive(false)
    setSelectedUrl(source?.url ?? '')
    if (source) void session?.open({ method: 'GET', url: source.url })
  }, [session, source])
  const open = (url: string) => { setSelectedUrl(url); setQuery(''); setSearchActive(false); void session?.open({ method: 'GET', url }) }
  const search = () => {
    const request = profile && catalogSearchRequest(profile, query.trim())
    if (request) { setSearchActive(true); void session?.open(request) }
  }
  const chip = (url: string, title: string) => (
    <button key={url} type="button" onClick={() => open(url)} className={`shrink-0 rounded-full px-3.5 py-1 text-[12px] ${selectedUrl === url ? 'bg-cinnabar text-white' : 'bg-paper/8 text-paper-muted'}`}>{title}</button>
  )
  if (!source) return <div className="p-8 text-center text-paper-muted">暂无网页目录，请在自定义订阅中添加列表或栏目地址</div>
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="sticky top-0 z-10 border-b border-haze/50 bg-ink/95 backdrop-blur-xl">
        <div className="page-x flex items-center gap-2 overflow-x-auto py-2.5">
          {onBack && <button type="button" onClick={onBack} aria-label="返回"><ChevronLeft size={18} /></button>}
          {sites.map(({ source: site }) => <button key={site.id} type="button" onClick={() => { if (site.id === source.id) open(source.url); else setSelectedId(site.id) }} className={`shrink-0 rounded-full px-4 py-1.5 text-[13px] ${site.id === source.id ? 'bg-cinnabar text-white' : 'bg-paper/8 text-paper-muted'}`}>{site.label || site.name}</button>)}
        </div>
        {profile?.search && <form className="page-x flex gap-2 pb-2" onSubmit={(event) => { event.preventDefault(); search() }}>
          <input aria-label="站内搜索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索此站点" className="min-w-0 flex-1 rounded-xl border border-haze bg-paper/5 px-3 py-2 text-[13px]" />
          <button type="submit" disabled={!query.trim() || state.loading} className="rounded-xl bg-cinnabar px-4 text-white disabled:opacity-40"><Search size={16} /></button>
        </form>}
        {searchActive && <div className="page-x pb-2"><button type="button" onClick={() => open(selectedUrl || source.url)} className="text-[12px] text-cinnabar">返回列表</button></div>}
        {!!profile?.categories.length && <div className="page-x flex gap-2 overflow-x-auto pb-2.5">{chip(source.url, '全部')}{profile.categories.map((link) => chip(link.url, link.title))}</div>}
        {!!profile?.sorts?.length && <div className="page-x flex gap-2 overflow-x-auto pb-2">{profile.sorts.map((link) => chip(link.url, link.title))}</div>}
        {profile?.filters?.map((group) => <div key={group.title} className="page-x flex items-center gap-2 overflow-x-auto pb-2"><span className="shrink-0 text-[12px] text-paper-muted">{group.title}</span>{group.options.map((link) => chip(link.url, link.title))}</div>)}
      </div>
      <div className="page-x space-y-3 pt-3 pb-6">
        {state.loading && <div className="flex justify-center py-6"><Loader2 className="animate-spin text-paper-muted" /></div>}
        {state.error && <div role="alert" className="rounded-xl border border-haze p-3 text-[13px] text-paper-muted">{state.error}<button type="button" onClick={() => void session?.retry()} className="ml-3 text-cinnabar">重试</button></div>}
        {state.page?.truncated && <p className="text-[12px] text-paper-muted">本页内容较多，已显示前 200 条</p>}
        <div className="grid grid-cols-2 gap-3">
          {state.page?.articles.map((article) => <button key={article.id} type="button" onClick={() => onOpen(article)} className="overflow-hidden rounded-xl border border-haze/50 bg-paper/5 text-left hover:border-cinnabar/30">
            {article.image && <img src={article.image} alt="" loading="lazy" className="aspect-16/10 w-full object-cover" />}
            <div className="p-2.5"><h3 className={`line-clamp-2 text-[13px] font-medium ${readIds.has(article.id) ? 'text-paper-faint' : 'text-paper'}`}>{article.title}</h3><p className="mt-1 text-[10px] text-paper-muted">{article.sourceLabel}</p></div>
          </button>)}
        </div>
        {!state.loading && !state.error && !state.page?.articles.length && <p className="py-12 text-center text-[13px] text-paper-faint">暂无内容</p>}
        {state.page && <div className="flex items-center justify-center gap-3 pt-4 text-[12px] text-paper-muted">
          <button type="button" disabled={state.loading || state.index <= 0} onClick={() => session?.previous()} className="flex items-center disabled:opacity-30"><ChevronLeft size={14} />上一页</button>
          <span>第 {state.index + 1} 页</span>
          <button type="button" disabled={state.loading || (state.exhausted && !state.history[state.index + 1])} onClick={() => void session?.next()} className="flex items-center disabled:opacity-30">下一页<ChevronRight size={14} /></button>
        </div>}
      </div>
    </div>
  )
})
