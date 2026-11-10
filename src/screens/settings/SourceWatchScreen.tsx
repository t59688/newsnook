import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bell, BellOff, Check, ChevronRight, Clock3, Radio, Search, Settings2, Wifi } from 'lucide-react'
import type { Article } from '../../lib/types'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import type { NewsSource } from '../../sources/registry'
import { checkWatchedSources } from '../../features/sourceWatch/runtime'
import { requestWatchNotificationPermission, syncNativeWatchRules } from '../../features/sourceWatch/native'
import { loadWatchState, saveWatchState, type WatchMode, type WatchState } from '../../features/sourceWatch/store'

interface Props { sources: NewsSource[]; onBack: () => void; onOpenArticle: (article: Article) => void }
const modes: { id: WatchMode; title: string; detail: string }[] = [
  { id: 'instant', title: '发现后提醒', detail: '收到新内容时显示通知' },
  { id: 'inbox', title: '仅收件箱', detail: '静默记录，不发送提醒' },
]
export function SourceWatchScreen({ sources, onBack, onOpenArticle }: Props) {
  const [state, setState] = useState(loadWatchState)
  const [tab, setTab] = useState<'inbox' | 'sources' | 'settings'>('inbox')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [showUnread, setShowUnread] = useState(false)
  useHardwareBackLayer(Boolean(selected), () => { setSelected(null); return true })
  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources])
  const watchedIds = useMemo(() => new Set(state.rules.filter(rule => rule.enabled).map(rule => rule.sourceId)), [state.rules])
  const count = watchedIds.size
  const unread = state.events.filter(event => !event.read).length
  const available = useMemo(() => sources.filter(source => !source.workspaceOnly && source.url && !source.paused && (source.name.toLowerCase().includes(query.toLowerCase()) || source.label.toLowerCase().includes(query.toLowerCase()))).sort((a,b) => Number(watchedIds.has(b.id))-Number(watchedIds.has(a.id)) || a.name.localeCompare(b.name)).slice(0, query ? 150 : 70), [sources, query, watchedIds])
  const commit = (next: WatchState) => {
    setState(next)
    saveWatchState(next)
    const active = next.rules.filter(rule => rule.enabled).map(rule => sourceMap.get(rule.sourceId)).filter((source): source is NewsSource => Boolean(source))
    // Only RSS/Atom XML can be safely parsed by the native background worker.
    void syncNativeWatchRules(active.filter(source => (source.kind === 'feed' || source.kind === 'google-news') && source.url.startsWith('https://') && source.requestMethod !== 'POST' && source.discovery?.generator !== 'rsshub').map(source => ({ id: source.id, name: source.name, url: source.url, mode: next.rules.find(rule => rule.sourceId === source.id)?.mode || 'inbox', seen: (next.cursors[source.id] || []).map(key => key.slice(source.id.length + 1)) })), next.intervalMinutes, next.quietHours, next.wifiOnly).catch(() => {})
  }
  useEffect(() => {
    const update = () => setState(loadWatchState())
    window.addEventListener('newsnook:source-watch-changed', update)
    return () => window.removeEventListener('newsnook:source-watch-changed', update)
  }, [])
  const toggle = (id: string) => {
    const existing = state.rules.filter(rule => rule.sourceId !== id)
    const active = !watchedIds.has(id)
    const cursors = { ...state.cursors }
    delete cursors[id]
    commit({ ...state, cursors, rules: active ? [...existing, { sourceId: id, mode: 'instant', enabled: true }] : existing })
    if (active) { setSelected(id); void requestWatchNotificationPermission().catch(() => {}) }
  }
  const setMode = (id: string, mode: WatchMode) => commit({ ...state, rules: state.rules.map(rule => rule.sourceId === id ? { ...rule, mode } : rule) })
  const refresh = async () => {
    if (checking) return
    setChecking(true)
    try { await checkWatchedSources(sources, true) } finally { setState(loadWatchState()); setChecking(false) }
  }
  const section = 'mt-5 text-[12px] font-semibold tracking-wide text-paper-muted'
  return <section className="paper-settings-root flex min-h-0 flex-1 flex-col">
    <header className="paper-settings-header"><div className="paper-settings-container">
      <button type="button" aria-label="返回" className="paper-settings-back" onClick={onBack}><ArrowLeft size={21}/></button>
      <h1 className="!mt-1">关注动态</h1><p className="paper-settings-reading-count">只留意你真正关心的信息</p>
    </div></header>
    <div className="mx-4 flex shrink-0 border-b border-haze">
      {([['inbox','新动态'], ['sources','关注信源'], ['settings','提醒设置']] as const).map(([id,title]) =>
        <button key={id} type="button" onClick={() => { setTab(id); setSelected(null) }} className={'flex-1 py-3 text-sm transition-colors '+ (tab === id ? 'border-b-2 border-cinnabar font-semibold text-paper' : 'text-paper-muted')}>{title}{id === 'inbox' && unread > 0 ? ' · '+unread : ''}</button>)}
    </div>
    <div className="paper-settings-scroller scroll-hidden"><div className="paper-settings-container pb-12">
      {tab === 'inbox' && <>
        <div className="flex items-center justify-between mt-6 gap-2"><div><p className="text-2xl font-semibold text-paper">{unread} <span className="text-sm font-normal text-paper-muted">篇未读</span></p><p className="text-xs text-paper-muted mt-1">{count} 个关注来源 · 与预设无关</p></div><button type="button" onClick={() => { setTab('sources'); setSelected(null) }} className="rounded-xl border border-haze px-3 py-2 text-sm text-paper"><Settings2 size={14} className="inline mr-1"/>管理</button></div>
        <div className="flex gap-2 mt-6"><button type="button" className={'px-3 py-2 text-sm rounded-xl '+(!showUnread?'bg-cinnabar/15 text-cinnabar':'text-paper-muted')} onClick={() => setShowUnread(false)}>全部动态</button><button type="button" className={'px-3 py-2 text-sm rounded-xl '+(showUnread?'bg-cinnabar/15 text-cinnabar':'text-paper-muted')} onClick={() => setShowUnread(true)}>仅未读</button><button type="button" className="ml-auto text-xs text-paper-muted" onClick={() => commit({ ...state, events: state.events.map(event => ({ ...event, read: true })) })}>全部已读</button></div>
        {state.events.filter(event => !showUnread || !event.read).length === 0 ? <div className="py-20 text-center"><Bell size={34} strokeWidth={1.2} className="mx-auto mb-4 text-cinnabar"/><h2 className="text-lg font-semibold">{count ? '暂时没有新动态' : '留意值得关注的事'}</h2><p className="mt-2 text-sm text-paper-muted">{count ? '检测到更新后，文章会出现在这里。' : '先选择几个喜欢的来源，不再错过其他预设的更新。'}</p><button className="mt-6 rounded-xl bg-cinnabar px-5 py-3 text-white text-sm" onClick={() => setTab('sources')}>{count ? '管理关注' : '去选择信源'}</button></div> : <div className="mt-4 border-t border-haze">{state.events.filter(event => !showUnread || !event.read).map(event => <button key={event.key} type="button" className="block w-full border-b border-haze py-4 text-left" onClick={() => { commit({ ...state, events: state.events.map(item => item.key === event.key ? { ...item, read: true } : item) }); onOpenArticle(event.article) }}><div className="mb-2 flex items-center gap-2 text-xs text-paper-muted">{!event.read && <span className="h-1.5 w-1.5 rounded-full bg-cinnabar"/>}{sourceMap.get(event.sourceId)?.name || event.article.sourceName}<span className="ml-auto">{new Date(event.discoveredAt).toLocaleString()}</span></div><h3 className={'text-[16px] leading-relaxed '+(!event.read?'font-semibold text-paper':'text-paper-muted')}>{event.article.title}</h3></button>)}</div>}
      </>}
      {tab === 'sources' && <>
        <h2 className={section}>已关注 {count} 个信源</h2>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-haze bg-ink-raised px-3 py-2"><Search size={17} className="text-paper-muted"/><input aria-label="搜索信源" className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-paper-muted" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索所有预设中的来源"/></div>
        <p className="mt-3 text-xs leading-relaxed text-paper-muted">只有开启铃铛的来源会加入检测队列，多个预设共用同一份关注状态。</p>
        <div className="mt-3 border-y border-haze">{available.map(source => <div key={source.id} className="flex items-center gap-3 border-b border-haze/60 py-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-deep text-cinnabar text-sm font-semibold">{source.name.slice(0,1)}</span><button className="min-w-0 flex-1 text-left" onClick={() => watchedIds.has(source.id) ? setSelected(source.id) : toggle(source.id)}><span className="block truncate text-sm font-semibold text-paper">{source.name}</span><span className="block truncate text-xs text-paper-muted mt-1">{source.label} · {watchedIds.has(source.id) ? modes.find(mode => mode.id === state.rules.find(rule => rule.sourceId === source.id)?.mode)?.title : '未关注'}</span></button>{watchedIds.has(source.id) && <button type="button" aria-label={'设置'+source.name} className="p-2 text-paper-muted" onClick={() => setSelected(source.id)}><ChevronRight size={18}/></button>}<button type="button" aria-label={(watchedIds.has(source.id)?'取消关注':'关注')+source.name} className={'h-10 w-10 rounded-full grid place-items-center '+(watchedIds.has(source.id)?'bg-cinnabar/15 text-cinnabar':'bg-ink-deep text-paper-muted')} onClick={() => toggle(source.id)}>{watchedIds.has(source.id)?<Bell size={19}/>:<BellOff size={19}/>}</button></div>)}</div>
      </>}
      {tab === 'settings' && <>
        <h2 className={section}>后台检测</h2>
        <div className="mt-3 rounded-2xl border border-haze bg-ink-raised px-4"><div className="flex items-center gap-3 py-4"><Clock3 size={19} className="text-cinnabar"/><div className="flex-1"><strong className="text-sm">检查间隔</strong><p className="text-xs text-paper-muted mt-1">Android 后台执行时间由系统决定</p></div><select aria-label="检查间隔" value={state.intervalMinutes} className="rounded-lg bg-ink-deep px-2 py-2 text-sm" onChange={e => commit({ ...state, intervalMinutes: Number(e.target.value) })}><option value={30}>30 分钟</option><option value={60}>60 分钟</option><option value={120}>2 小时</option></select></div>
        <div className="flex items-center gap-3 border-t border-haze py-4"><BellOff size={19} className="text-cinnabar"/><div className="flex-1"><strong className="text-sm">夜间免打扰</strong><p className="text-xs text-paper-muted mt-1">23:00—08:00 静音，不丢失文章</p></div><input aria-label="夜间免打扰" type="checkbox" checked={state.quietHours} onChange={e => commit({ ...state, quietHours: e.target.checked })} className="h-5 w-5 accent-cinnabar"/></div>
        <div className="flex items-center gap-3 border-t border-haze py-4"><Wifi size={19} className="text-cinnabar"/><div className="flex-1"><strong className="text-sm">仅 Wi-Fi 后台检测</strong><p className="text-xs text-paper-muted mt-1">减少移动网络流量</p></div><input aria-label="仅 Wi-Fi" type="checkbox" checked={state.wifiOnly} onChange={e => commit({ ...state, wifiOnly: e.target.checked })} className="h-5 w-5 accent-cinnabar"/></div></div>
        <h2 className={section}>检测状态</h2><div className="mt-3 rounded-2xl border border-haze bg-ink-raised p-4"><div className="flex items-center gap-2"><Radio size={18} className="text-cinnabar"/><strong className="text-sm">{count ? '本地检测已开启' : '未开启任何检测'}</strong></div><p className="mt-2 text-xs leading-relaxed text-paper-muted">{count ? '已关注的信源会在前台定期检查，支持直接 HTTPS RSS 的信源可在 Android 后台周期检查，特殊网页仅前台检查。' : '关注至少一个信源后才会安排后台任务，零关注时不产生检测请求。'}</p><button disabled={!count || checking} onClick={refresh} className="mt-4 w-full rounded-xl border border-cinnabar/50 py-3 text-sm font-medium text-cinnabar disabled:opacity-40">{checking?'正在检查…':'立即检查关注来源'}</button></div>
      </>}
    </div></div>
    {selected && watchedIds.has(selected) && <div className="fixed inset-0 z-[80] flex items-end justify-center" role="presentation"><button type="button" aria-label="关闭弹窗" className="absolute inset-0 bg-black/55" onClick={() => setSelected(null)}/><div role="dialog" aria-modal="true" aria-label="提醒方式" className="relative w-full max-w-lg rounded-t-3xl border border-haze bg-ink-raised px-5 pb-8 pt-3 shadow-xl"><div className="mx-auto mb-5 h-1 w-10 rounded-full bg-haze"/><h2 className="text-xl font-semibold text-paper">{sourceMap.get(selected)?.name}</h2><p className="mt-1 text-sm text-paper-muted">选择这个来源的更新提醒方式</p><div className="mt-5">{modes.map(mode => <button key={mode.id} className="flex w-full items-center gap-3 border-t border-haze py-4 text-left" onClick={() => { setMode(selected, mode.id); setSelected(null) }}><span className="flex-1"><strong className="block text-sm">{mode.title}</strong><small className="mt-1 block text-xs text-paper-muted">{mode.detail}</small></span>{state.rules.find(rule => rule.sourceId === selected)?.mode === mode.id && <Check size={20} className="text-cinnabar"/>}</button>)}</div><button type="button" className="mt-3 w-full rounded-xl bg-ink-deep py-3 text-sm" onClick={() => setSelected(null)}>完成</button></div></div>}
  </section>
}
