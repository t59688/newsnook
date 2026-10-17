import { AlertCircle, Home, LoaderCircle, Plus, X } from 'lucide-react'
import { BrowserPageHeader, BrowserSiteIcon } from './BrowserPrimitives'
import { browserHostLabel } from './browserPreferences'

export interface BrowserTabItem {
  index: number
  id: number
  title: string
  url: string
  active: boolean
  loading: boolean
  error?: string
}

interface BrowserTabsPanelProps {
  tabs: BrowserTabItem[]
  pending: boolean
  onBack: () => void
  onSelect: (tab: BrowserTabItem) => void
  onRemove: (tab: BrowserTabItem) => void
  onNew: () => void
  privateMode?: boolean
}

export function BrowserTabsPanel({tabs, pending, onBack, onSelect, onRemove, onNew, privateMode = false}: BrowserTabsPanelProps) {
  const atLimit = tabs.length >= 6
  return <section aria-label="标签页" aria-busy={pending} className="browser-panel browser-tabs"
    style={{paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)'}}>
    <BrowserPageHeader title="标签页" subtitle={privateMode ? '隐私会话' : undefined} onBack={onBack}>
      <span className="browser-count-label" aria-label={'已打开 ' + (tabs.length || 1) + ' 个标签页'}>{tabs.length || 1}</span>
    </BrowserPageHeader>

    <div className="browser-panel-scroll">
      <div className="browser-tab-grid">
        {tabs.length === 0 ? <button type="button" aria-label="返回主页" aria-current="page" disabled={pending} onClick={onBack}
          className="browser-tab-card browser-home-tab">
          <span className="browser-tab-top"><Home size={23} strokeWidth={1.7} aria-hidden="true"/><span className="browser-tab-current">当前</span></span>
          <span className="browser-tab-title">{privateMode ? '隐私主页' : '主页'}</span>
          <span className="browser-list-detail">搜索或输入网址</span>
        </button> : tabs.map(tab => {
          const tabTitle = tab.title || browserHostLabel(tab.url)
          return <article key={tab.id} className="browser-tab-card" data-active={tab.active ? 'true' : undefined}>
            <button type="button" aria-label={'打开标签页：' + tabTitle} aria-current={tab.active ? 'page' : undefined}
              disabled={pending} onClick={() => onSelect(tab)} className="browser-tab-open">
              <span className="browser-tab-top">
                <BrowserSiteIcon url={tab.url} name={tabTitle} size="small" allowRemote={!privateMode}/>
                {tab.active && <span className="browser-tab-current">当前</span>}
              </span>
              <span className="browser-tab-title" title={tabTitle}>{tabTitle}</span>
              <span className="browser-tab-host">{browserHostLabel(tab.url)}</span>
              {(tab.loading || tab.error) && <span className="browser-tab-status" title={tab.error}>
                {tab.loading ? <LoaderCircle size={15} className="browser-loading-icon" aria-hidden="true"/> : <AlertCircle size={15} aria-hidden="true"/>}
                <span>{tab.loading ? '正在加载' : '加载失败'}</span>
              </span>}
            </button>
            <button type="button" aria-label={'关闭标签页：' + tabTitle} disabled={pending} onClick={() => onRemove(tab)}
              className="browser-icon-button browser-tab-close"><X size={19} strokeWidth={1.8} aria-hidden="true"/></button>
          </article>
        })}
      </div>
    </div>

    <footer className="browser-panel-footer">
      {(atLimit || pending) && <p id="browser-tabs-status" role="status" className="browser-footer-status">
        {pending ? '正在更新标签页…' : '最多同时打开 6 个标签页'}
      </p>}
      <button type="button" aria-label="新建标签页" aria-describedby={atLimit || pending ? 'browser-tabs-status' : undefined}
        disabled={atLimit || pending} onClick={onNew} className="browser-action-button browser-action-primary browser-new-tab">
        <Plus size={20} strokeWidth={1.8} aria-hidden="true"/>新建标签页
      </button>
    </footer>
  </section>
}
