import { useState } from 'react'
import { ArrowRight, Bookmark, Check, ChevronRight, Clock3, Eye, EyeOff, MoreHorizontal, Plus, Search, ShieldCheck } from 'lucide-react'
import type { BrowserShortcut, BrowserVisit } from './browserHistory'
import { BROWSER_KEYS, browserHostLabel, readHideRecentPreference, writeBrowserPreference } from './browserPreferences'
import { BrowserIconButton, BrowserSiteIcon } from './BrowserPrimitives'

export function BrowserStartPage({
  shortcuts, recent, onSearch, onOpen, onAddShortcut, onShortcutOptions, onHistoryOptions, onPanel,
  privateMode = false, hideRecent, onToggleHideRecent,
}: {
  shortcuts: BrowserShortcut[]; recent: BrowserVisit[]
  onSearch: () => void; onOpen: (url: string) => void; onAddShortcut: () => void
  onShortcutOptions: (index: number) => void; onHistoryOptions: (visit: BrowserVisit) => void
  onPanel: (panel: 'history' | 'bookmarks' | 'scripts') => void
  privateMode?: boolean; hideRecent?: boolean; onToggleHideRecent?: () => void
}) {
  const [managing, setManaging] = useState(false)
  const [internalHide, setInternalHide] = useState(() => readHideRecentPreference())
  const isRecentHidden = hideRecent ?? internalHide

  const handleToggleHide = () => {
    if (onToggleHideRecent) {
      onToggleHideRecent()
    } else {
      const next = !internalHide
      try {
        writeBrowserPreference(BROWSER_KEYS.hideRecent, next ? 'true' : 'false', true)
        setInternalHide(next)
      } catch {
        // fallback
      }
    }
  }

  const canManage = managing
  return <div className="browser-start">
    <div className="browser-start-brand">
      <img src="/favicon.svg" alt=""/>
      <div><h1>{privateMode ? '隐私浏览' : '浏览器'}</h1>{privateMode && <p>不保存搜索和浏览记录</p>}</div>
    </div>
    <button type="button" aria-label="首页搜索或输入网址" onClick={onSearch} className="browser-start-search">
      <Search size={21} strokeWidth={1.8} aria-hidden="true"/>
      <span>搜索或输入网址</span>
      <ArrowRight size={20} strokeWidth={1.8} aria-hidden="true"/>
    </button>
    <div className="browser-start-navigation">
      {([{label:'书签',panel:'bookmarks',icon:Bookmark},{label:'历史',panel:'history',icon:Clock3},{label:'用户脚本',panel:'scripts',icon:ShieldCheck}] as const).map(item =>
        <button key={item.panel} type="button" onClick={() => onPanel(item.panel)}>
          <item.icon size={18} strokeWidth={1.8} aria-hidden="true"/><span>{item.label}</span>
        </button>)}
    </div>

    <section className="browser-start-section" aria-labelledby="browser-shortcuts-title">
      <div className="browser-section-heading">
        <h2 id="browser-shortcuts-title">快捷访问</h2>
        <button type="button" aria-pressed={canManage} onClick={() => setManaging(!managing)}
          className="browser-text-button">{canManage ? '完成' : '管理'}</button>
      </div>
      <div className="browser-shortcut-grid">
        {shortcuts.map((shortcut, index) => <button key={shortcut.url} type="button" title={shortcut.name}
          aria-label={canManage ? '管理快捷方式：' + shortcut.name : shortcut.name}
          onContextMenu={event => {event.preventDefault(); onShortcutOptions(index)}}
          onClick={() => canManage ? onShortcutOptions(index) : onOpen(shortcut.url)} className="browser-shortcut">
          <BrowserSiteIcon url={shortcut.url} name={shortcut.name} allowRemote={!privateMode}/>
          {canManage && <span className="browser-shortcut-edit" aria-hidden="true"><MoreHorizontal size={14}/></span>}
          <span className="browser-shortcut-label">{shortcut.name}</span>
        </button>)}
        {shortcuts.length < 8 && <button type="button" aria-label="添加快捷方式" onClick={onAddShortcut}
          className="browser-shortcut browser-shortcut-add">
          <span className="browser-shortcut-add-icon"><Plus size={23} strokeWidth={1.7} aria-hidden="true"/></span>
          <span className="browser-shortcut-label">添加</span>
        </button>}
      </div>
      {canManage && <p role="status" className="browser-start-help"><Check size={15} aria-hidden="true"/>点按快捷方式进行编辑或排序</p>}
    </section>

    {!privateMode && <section className="browser-start-section" aria-labelledby="browser-recent-title">
      <div className="browser-section-heading">
        <div className="browser-section-title-wrap">
          <h2 id="browser-recent-title">最近访问</h2>
          <button
            type="button"
            className="browser-icon-toggle-button"
            onClick={handleToggleHide}
            aria-label={isRecentHidden ? '显示最近访问' : '隐藏最近访问'}
            aria-pressed={!isRecentHidden}
            title={isRecentHidden ? '显示最近访问' : '隐藏最近访问'}
          >
            {isRecentHidden ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
        <button type="button" onClick={() => onPanel('history')} className="browser-text-button">全部<ChevronRight size={16} aria-hidden="true"/></button>
      </div>
      {isRecentHidden ? (
        <button
          type="button"
          onClick={handleToggleHide}
          className="browser-recent-collapsed"
          aria-label="最近访问已隐藏，点击展开"
        >
          <EyeOff size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>最近访问已隐藏 · 点击展开</span>
        </button>
      ) : recent.length ? (
        <ul className="browser-recent-list">
          {recent.map(item => <li key={item.url}>
            <button type="button" title={item.title || item.url} onClick={() => onOpen(item.url)}
              onContextMenu={event => {event.preventDefault(); onHistoryOptions(item)}} className="browser-recent-link">
              <BrowserSiteIcon url={item.url} name={item.title} size="small"/>
              <span><span className="browser-list-title">{item.title || browserHostLabel(item.url)}</span>
                <span className="browser-list-detail">{browserHostLabel(item.url)}</span></span>
            </button>
            <BrowserIconButton label={'管理历史 ' + browserHostLabel(item.url)} onClick={() => onHistoryOptions(item)}><MoreHorizontal size={19}/></BrowserIconButton>
          </li>)}
        </ul>
      ) : (
        <div className="browser-start-empty">
          <Clock3 size={19} strokeWidth={1.7} aria-hidden="true"/>
          <div><p>暂无浏览记录</p><span>访问过的网页会显示在这里。</span></div>
        </div>
      )}
    </section>}
  </div>
}
