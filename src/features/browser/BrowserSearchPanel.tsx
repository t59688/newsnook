import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, ArrowUpLeft, Check, Clock3, Copy, LoaderCircle, Search, X } from 'lucide-react'
import { browserSearchDestination, browserSearchProviders, type BrowserSearchCategory } from './browserSearchCatalog'
import { BROWSER_ENGINES, browserHostLabel, type BrowserSearchChoice } from './browserPreferences'
import type { BrowserVisit } from './browserHistory'
import { BrowserIconButton, BrowserPrivateNotice, BrowserSiteIcon, BrowserStatusBanner } from './BrowserPrimitives'
import { useBrowserDialogFocus } from './useBrowserDialogFocus'

const categories = ['常用', '搜索', 'AI', '学术'] as const

export function BrowserSearchPanel({
  current, initialValue, engine, history, pending, error, onClose, onOpen, onCopy, privateMode = false,
}: {
  current: string; initialValue: string; engine: BrowserSearchChoice; history: BrowserVisit[]
  pending: boolean; error: string; onClose: () => void
  onOpen: (value: string) => Promise<boolean>; onCopy: (value: string) => void; privateMode?: boolean
}) {
  const section = useBrowserDialogFocus<HTMLElement>()
  const [value, setValue] = useState(initialValue)
  const [category, setCategory] = useState<BrowserSearchCategory>('常用')
  const [opening, setOpening] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(false)
  const draftRevision = useRef(0)
  const submitting = useRef(false)
  const id = useId()
  const busy = pending || opening
  useEffect(() => {
    mounted.current = true
    return () => {mounted.current = false}
  }, [])
  const changeValue = (next: string) => {
    draftRevision.current++
    setValue(next)
    if (submitError) setSubmitError('')
  }
  const query = value.trim()
  const results = useMemo(() => {
    if (privateMode) return []
    const needle = query.toLocaleLowerCase()
    return history.filter(item => !needle || (item.title + ' ' + item.url).toLocaleLowerCase().includes(needle)).slice(0, 5)
  }, [history, query, privateMode])
  useEffect(() => {
    input.current?.focus()
    if (initialValue) input.current?.select()
  }, [initialValue])

  const submit = async (destination: string) => {
    if (pending || submitting.current) return
    submitting.current = true
    setOpening(true)
    setSubmitError('')
    const revision = draftRevision.current
    try {
      const opened = await onOpen(destination)
      if (opened && mounted.current && draftRevision.current === revision) {
        input.current?.blur()
        onClose()
      }
    } catch (cause) {
      if (mounted.current) setSubmitError(cause instanceof Error ? cause.message : '无法打开网页，请重试')
    } finally {
      submitting.current = false
      if (mounted.current) setOpening(false)
    }
  }

  function moveCategory(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % categories.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + categories.length) % categories.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = categories.length - 1
    else return
    event.preventDefault()
    setCategory(categories[next])
    event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return <section ref={section} tabIndex={-1} role="dialog" aria-modal="true" aria-label="搜索与地址" aria-busy={busy}
    className="browser-search browser-panel" style={{paddingTop:'var(--sat)', paddingBottom:'var(--sab)'}}>
    <form className="browser-search-form" onSubmit={event => {event.preventDefault(); if (query) void submit(value)}}>
      <div className="browser-input-field">
        <Search size={19} strokeWidth={1.8} aria-hidden="true"/>
        <input ref={input} aria-label="搜索或输入网址" value={value} onInput={event => changeValue(event.currentTarget.value)}
          placeholder="搜索或输入网址" enterKeyHint="go" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}/>
        {value && <BrowserIconButton label="清空搜索" onClick={() => {changeValue(''); input.current?.focus()}}><X size={18}/></BrowserIconButton>}
      </div>
      <button type="button" onClick={onClose} className="browser-text-button">取消</button>
    </form>
    <div className="browser-panel-scroll">
      <div className="browser-search-content">
        {privateMode && <BrowserPrivateNotice compact/>}
        {(error || submitError) && <BrowserStatusBanner error>{error || submitError}</BrowserStatusBanner>}
        {current && <div className="browser-current-address">
          <button type="button" onClick={() => {changeValue(current); input.current?.focus(); input.current?.select()}}>
            <span className="browser-list-detail">当前网址</span>
            <span className="browser-list-title" title={current}>{current}</span>
          </button>
          <BrowserIconButton label="复制当前网址" onClick={() => onCopy(current)}><Copy size={19}/></BrowserIconButton>
        </div>}
        {query && <button type="button" disabled={busy} onClick={() => void submit(value)}
          aria-label={'搜索或打开：' + query} className="browser-search-submit">
          {busy ? <LoaderCircle size={20} className="browser-loading-icon" aria-hidden="true"/> : <Search size={20} strokeWidth={1.8} aria-hidden="true"/>}
          <span><span className="browser-list-title">{value}</span><span className="browser-list-detail">{busy ? '正在打开…' : '打开网址或使用 ' + BROWSER_ENGINES[engine].name + ' 搜索'}</span></span>
          <ArrowRight size={20} strokeWidth={1.8} aria-hidden="true"/>
        </button>}
        <div role="tablist" aria-label="搜索分类" className="browser-search-categories">
          {categories.map((item, index) => <button key={item} id={id + '-tab-' + index} role="tab" type="button"
            aria-selected={category === item} tabIndex={category === item ? 0 : -1} aria-controls={id + '-providers'}
            onClick={() => setCategory(item)} onKeyDown={event => moveCategory(event, index)}>{item}</button>)}
        </div>
        <div id={id + '-providers'} role="tabpanel" aria-labelledby={id + '-tab-' + categories.indexOf(category)}
          className="browser-provider-grid">
          {browserSearchProviders(category).map(provider => <button key={provider.id} type="button" disabled={busy}
            onClick={() => void submit(browserSearchDestination(provider, value))}
            className="browser-provider" data-default={provider.id === engine ? 'true' : undefined}>
            <BrowserSiteIcon url={provider.home} name={provider.name} size="small" allowRemote={!privateMode}/>
            <span>{provider.name}</span>
            {provider.id === engine && <Check size={15} strokeWidth={1.8} aria-label="默认搜索"/>}
          </button>)}
        </div>
        {results.length > 0 && <section className="browser-search-history" aria-labelledby={id + '-history'}>
          <h3 id={id + '-history'}>{query ? '匹配的历史' : '最近访问'}</h3>
          <ul className="browser-recent-list">
            {results.map(item => <li key={item.url}>
              <button type="button" onClick={() => void submit(item.url)} disabled={busy} className="browser-search-history-link">
                <Clock3 size={18} strokeWidth={1.7} aria-hidden="true"/>
                <span><span className="browser-list-title">{item.title || browserHostLabel(item.url)}</span>
                  <span className="browser-list-detail">{browserHostLabel(item.url)}</span></span>
              </button>
              <BrowserIconButton label={'填入网址 ' + browserHostLabel(item.url)} onClick={() => {changeValue(item.url); input.current?.focus()}}><ArrowUpLeft size={19}/></BrowserIconButton>
            </li>)}
          </ul>
        </section>}
        {!query && !results.length && <p className="browser-search-hint">默认使用 {BROWSER_ENGINES[engine].name} 搜索</p>}
      </div>
    </div>
  </section>
}
