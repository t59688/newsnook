import { useEffect } from 'react'
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
  preview?: string
}

interface BrowserTabsPanelProps {
  tabs: BrowserTabItem[]
  pending: boolean
  onBack: () => void
  onSelect: (tab: BrowserTabItem) => void
  onRemove: (tab: BrowserTabItem) => void
  onNew: () => void
  onRefresh?: () => void
  privateMode?: boolean
}

export function BrowserTabsPanel({
  tabs,
  pending,
  onBack,
  onSelect,
  onRemove,
  onNew,
  onRefresh,
  privateMode = false,
}: BrowserTabsPanelProps) {
  const atLimit = tabs.length >= 6

  useEffect(() => {
    onRefresh?.()
  }, [onRefresh])

  return (
    <section
      aria-label="标签页"
      aria-busy={pending}
      className="browser-panel browser-tabs"
      style={{ paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)' }}
    >
      <BrowserPageHeader title="标签页" subtitle={privateMode ? '不记录浏览' : undefined} onBack={onBack}>
        <span className="browser-count-label" aria-label={'已打开 ' + (tabs.length || 1) + ' 个标签页'}>
          {tabs.length || 1}
        </span>
      </BrowserPageHeader>

      <div className="browser-panel-scroll">
        <div className="browser-tab-grid">
          {tabs.length === 0 ? (
            <button
              type="button"
              aria-label="返回主页"
              aria-current="page"
              disabled={pending}
              onClick={onBack}
              className="browser-tab-card browser-home-tab"
            >
              <div className="browser-tab-card-header">
                <Home size={19} strokeWidth={1.7} aria-hidden="true" className="shrink-0 text-paper-muted" />
                <div className="browser-tab-card-info">
                  <span className="browser-tab-title">主页</span>
                  <span className="browser-tab-host">搜索或输入网址</span>
                </div>
                <span className="browser-tab-current">当前</span>
              </div>
              <div className="browser-tab-preview">
                <div className="browser-tab-preview-placeholder">
                  <div className="browser-tab-preview-blank">
                    <Home size={34} strokeWidth={1.4} aria-hidden="true" className="mb-1 text-paper-muted" />
                    <span className="browser-tab-preview-blank-text">搜索或输入网址</span>
                  </div>
                </div>
              </div>
            </button>
          ) : (
            tabs.map((tab) => {
              const tabTitle = tab.title || browserHostLabel(tab.url)
              const hostLabel = browserHostLabel(tab.url)
              return (
                <article key={tab.id} className="browser-tab-card" data-active={tab.active ? 'true' : undefined}>
                  <button
                    type="button"
                    aria-label={'打开标签页：' + tabTitle}
                    aria-current={tab.active ? 'page' : undefined}
                    disabled={pending}
                    onClick={() => onSelect(tab)}
                    className="browser-tab-open"
                  >
                    <div className="browser-tab-card-header">
                      <BrowserSiteIcon url={tab.url} name={tabTitle} size="small" allowRemote={!privateMode} />
                      <div className="browser-tab-card-info">
                        <span className="browser-tab-title" title={tabTitle}>
                          {tabTitle}
                        </span>
                        <span className="browser-tab-host">{hostLabel}</span>
                      </div>
                      {tab.active && <span className="browser-tab-current">当前</span>}
                    </div>

                    <div className="browser-tab-preview">
                      {tab.preview ? (
                        <img
                          src={tab.preview}
                          alt={tabTitle}
                          className="browser-tab-preview-img"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="browser-tab-preview-placeholder">
                          {tab.loading ? (
                            <div className="browser-tab-preview-loading">
                              <LoaderCircle size={22} className="browser-loading-icon" aria-hidden="true" />
                              <span>正在加载…</span>
                            </div>
                          ) : tab.error ? (
                            <div className="browser-tab-preview-error" title={tab.error}>
                              <AlertCircle size={22} aria-hidden="true" />
                              <span>加载失败</span>
                            </div>
                          ) : (
                            <div className="browser-tab-preview-blank">
                              <BrowserSiteIcon url={tab.url} name={tabTitle} size="normal" allowRemote={!privateMode} />
                              <span className="browser-tab-preview-blank-text">新标签页</span>
                            </div>
                          )}
                        </div>
                      )}

                      {tab.loading && tab.preview && (
                        <div className="browser-tab-preview-progress" aria-hidden="true">
                          <div className="browser-tab-preview-progress-bar" />
                        </div>
                      )}

                      {tab.error && tab.preview && (
                        <div className="browser-tab-preview-error-badge" title={tab.error}>
                          <AlertCircle size={14} aria-hidden="true" />
                          <span>加载失败</span>
                        </div>
                      )}
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-label={'关闭标签页：' + tabTitle}
                    disabled={pending}
                    onClick={() => onRemove(tab)}
                    className="browser-icon-button browser-tab-close"
                  >
                    <X size={18} strokeWidth={1.8} aria-hidden="true" />
                  </button>
                </article>
              )
            })
          )}
        </div>
      </div>

      <footer className="browser-panel-footer">
        {(atLimit || pending) && (
          <p id="browser-tabs-status" role="status" className="browser-footer-status">
            {pending ? '正在更新标签页…' : '最多同时打开 6 个标签页'}
          </p>
        )}
        <button
          type="button"
          aria-label="新建标签页"
          aria-describedby={atLimit || pending ? 'browser-tabs-status' : undefined}
          disabled={atLimit || pending}
          onClick={onNew}
          className="browser-action-button browser-action-primary browser-new-tab"
        >
          <Plus size={20} strokeWidth={1.8} aria-hidden="true" />
          新建标签页
        </button>
      </footer>
    </section>
  )
}
