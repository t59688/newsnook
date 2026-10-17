import { useMemo, useRef, useState } from 'react'
import { Bookmark, Clock3, MoreHorizontal, RotateCcw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { BrowserEmptyState, BrowserIconButton, BrowserPageHeader, BrowserSiteIcon, BrowserStatusBanner } from './BrowserPrimitives'

interface BrowserPlaceEntry {
  url: string
  title: string
  time: number
}

interface BrowserPlacesPanelProps {
  kind: 'history' | 'bookmarks'
  entries: BrowserPlaceEntry[]
  hiddenHostCount: number
  onBack: () => void
  onOpen: (url: string) => void
  onRemove: (url: string) => void
  onClear: () => void
  onRestoreHidden: () => void
  onHistoryOptions: (entry: BrowserPlaceEntry) => void
  privateMode?: boolean
  pending?: boolean
  error?: string
}

function dateGroup(time: number, today: Date) {
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return {key: 'unknown', label: '较早'}
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const label = day.getTime() === today.getTime() ? '今天'
    : day.getTime() === yesterday.getTime() ? '昨天'
    : date.toLocaleDateString('zh-CN', {
      year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric', month: 'long', day: 'numeric',
    })
  return {key: String(day.getTime()), label}
}

export function BrowserPlacesPanel({
  kind, entries, hiddenHostCount, onBack, onOpen, onRemove, onClear, onRestoreHidden, onHistoryOptions,
  privateMode = false, pending = false, error = '',
}: BrowserPlacesPanelProps) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const isHistory = kind === 'history'
  const title = isHistory ? '浏览历史' : '书签'
  const filtered = useMemo(() => {
    if (privateMode) return []
    const needle = query.trim().toLocaleLowerCase()
    return entries.filter(entry => !needle || (entry.title || '').toLocaleLowerCase().includes(needle)
      || entry.url.toLocaleLowerCase().includes(needle)).slice().sort((a, b) => b.time - a.time)
  }, [entries, query, privateMode])
  const groups = useMemo(() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const result: {key: string; label: string; entries: BrowserPlaceEntry[]}[] = []
    for (const entry of filtered) {
      const group = dateGroup(entry.time, today)
      const previous = result[result.length - 1]
      if (previous?.key === group.key) previous.entries.push(entry)
      else result.push({...group, entries: [entry]})
    }
    return result
  }, [filtered])
  const hasQuery = query.trim().length > 0

  return <section aria-label={title} aria-busy={pending} className="browser-panel browser-places"
    style={{paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)'}}>
    <BrowserPageHeader title={title} onBack={onBack}>
      {!privateMode && entries.length > 0 && <button type="button" aria-label={isHistory ? '清空浏览历史' : '清空书签'}
        disabled={pending} onClick={onClear} className="browser-text-button">清空</button>}
    </BrowserPageHeader>
    {!privateMode && <div className="browser-places-filter">
      <div className="browser-input-field">
        <Search size={19} strokeWidth={1.8} aria-hidden="true"/>
        <input ref={input} type="search" aria-label={isHistory ? '搜索浏览历史' : '搜索书签'} placeholder="搜索标题或网址"
          value={query} autoComplete="off" onInput={event => setQuery(event.currentTarget.value)}/>
        {query && <BrowserIconButton label="清空搜索" onClick={() => {setQuery(''); input.current?.focus()}}><X size={18} aria-hidden="true"/></BrowserIconButton>}
      </div>
      <p role="status" aria-live="polite" className="browser-results-count">
        {hasQuery ? '找到 ' + filtered.length + ' 条' : '共 ' + entries.length + (isHistory ? ' 条记录' : ' 个书签')}
      </p>
    </div>}
    <div className="browser-panel-scroll">
      <div className="browser-places-content">
        {error && <BrowserStatusBanner error>{error}</BrowserStatusBanner>}
        {!privateMode && isHistory && hiddenHostCount > 0 && <button type="button" aria-label="恢复首页隐藏的网站"
          disabled={pending} onClick={onRestoreHidden} className="browser-restore-hidden">
          <RotateCcw size={18} strokeWidth={1.8} aria-hidden="true"/>
          <span>恢复首页隐藏的网站</span><span>{hiddenHostCount} 个</span>
        </button>}
        {privateMode ? <BrowserEmptyState icon={ShieldCheck}
          title={isHistory ? '隐私会话不保存浏览记录' : '请在普通浏览中查看书签'} description="返回浏览器继续浏览。"/> : groups.length ? groups.map(group =>
          <section key={group.key} data-date-group={group.key} className="browser-place-group">
            <h3>{group.label}</h3>
            <ul className="browser-place-list">
              {group.entries.map(entry => {
                const entryTitle = entry.title || entry.url
                const date = new Date(entry.time)
                const validTime = !Number.isNaN(date.getTime())
                return <li key={entry.url + ':' + entry.time}>
                  <button type="button" aria-label={'打开：' + entryTitle} disabled={pending} onClick={() => onOpen(entry.url)}
                    onContextMenu={event => {if (isHistory && !pending) {event.preventDefault(); onHistoryOptions(entry)}}}
                    className={'browser-place-open' + (!isHistory ? ' browser-bookmark-open' : '')}>
                    {!isHistory && <BrowserSiteIcon url={entry.url} name={entryTitle} size="small"/>}
                    <span className="browser-place-copy">
                      <span className="browser-place-title" title={entryTitle}>{entryTitle}</span>
                      <span className="browser-place-meta">
                        <span title={entry.url}>{entry.url}</span>
                        {validTime && <time dateTime={date.toISOString()} title={date.toLocaleString('zh-CN')}>
                          {date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false})}
                        </time>}
                      </span>
                    </span>
                  </button>
                  {isHistory && <BrowserIconButton label={'更多操作：' + entryTitle} disabled={pending}
                    onClick={() => onHistoryOptions(entry)}><MoreHorizontal size={20} strokeWidth={1.8} aria-hidden="true"/></BrowserIconButton>}
                  <BrowserIconButton label={'删除：' + entryTitle} disabled={pending} className="browser-delete-button"
                    onClick={() => onRemove(entry.url)}><Trash2 size={18} strokeWidth={1.8} aria-hidden="true"/></BrowserIconButton>
                </li>
              })}
            </ul>
          </section>
        ) : <BrowserEmptyState icon={isHistory ? Clock3 : Bookmark}
          title={hasQuery ? '没有找到相关记录' : isHistory ? '暂无浏览历史' : '暂无书签'}
          description={hasQuery ? '试试其他标题或网址。' : isHistory ? '访问过的网页会显示在这里。' : '在网页菜单中添加书签。'}/>}
      </div>
    </div>
  </section>
}
