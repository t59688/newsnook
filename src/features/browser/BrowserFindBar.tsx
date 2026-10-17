import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Search, Shield, X } from 'lucide-react'
import { BrowserIconButton } from './BrowserPrimitives'
import type { BrowserFindResult } from './useBrowserSession'

/** Replaces the ordinary toolbar while keeping the website visible and scrollable. */
export function BrowserFindBar({result, onFind, onNext, onClose, privateMode = false}: {
  privateMode?: boolean
  result: BrowserFindResult | null
  onFind: (query: string) => Promise<void>
  onNext: (forward: boolean) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => {void onFind(query)}, query ? 140 : 0)
    return () => window.clearTimeout(timer)
  }, [query, onFind])
  const count = query && result ? result.count : 0
  const active = count > 0 && result ? result.activeMatch + 1 : 0
  return <form role="search" aria-label="在网页中查找" onSubmit={event => {event.preventDefault(); void onNext(true)}}
    className="relative z-10 flex h-14 shrink-0 items-center gap-0.5 border-y border-haze bg-ink-raised px-1.5">
    <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-haze/60 px-3">
      {privateMode ? <span aria-label="隐私模式" className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-paper-muted"><Shield size={15}/>隐私</span> : <Search size={17} className="shrink-0 text-paper-muted"/>}
      <input autoFocus aria-label="页内查找" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        value={query} onChange={event => setQuery(event.target.value)} placeholder="在网页中查找"
        className="min-w-0 flex-1 bg-transparent text-[15px] text-paper outline-none"/>
      <span aria-live="polite" aria-label={query && result?.done && !count ? '未找到匹配内容' : '查找结果'}
        className="shrink-0 text-[13px] tabular-nums text-paper-muted">{query && result?.done && !count ? '未找到' : active + '/' + count}</span>
    </label>
    <BrowserIconButton label="上一处" disabled={!count} onClick={() => {void onNext(false)}}><ChevronUp size={21}/></BrowserIconButton>
    <BrowserIconButton label="下一处" disabled={!count} onClick={() => {void onNext(true)}}><ChevronDown size={21}/></BrowserIconButton>
    <BrowserIconButton label="关闭查找" onClick={onClose}><X size={20}/></BrowserIconButton>
  </form>
}
