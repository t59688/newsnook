import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Capacitor } from '@capacitor/core'
import {
  Bell, BellRing, Check, CheckCheck, ChevronRight, Clock3, Info,
  LoaderCircle, Plus, Radio, Search, Send, ShieldCheck, Wifi, X, Eye,
} from 'lucide-react'

import { SettingsShell } from '../../components/SettingsShell'
import { OptionPickerDialog } from '../../components/ConfirmDialog'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'
import { haptics } from '../../lib/haptics'
import type { Article } from '../../lib/types'
import { checkWatchedSources } from '../../features/sourceWatch/runtime'
import { WatchArticleFeed } from '../../features/sourceWatch/WatchArticleFeed'
import { supportsNativeSourceWatch } from '../../features/sourceWatch/eligibility'
import { getNativeWatchStatus, openWatchNotificationSettings, requestWatchNotificationPermission, sendWatchTestNotification, type NativeWatchStatus } from '../../features/sourceWatch/native'
import { loadWatchState, saveWatchState, watchArticleKey, type WatchMode, type WatchState } from '../../features/sourceWatch/store'
import type { NewsSource, SourceGroup } from '../../sources/registry'
import type { HomeFeedLayout } from '../../sources/preferences'
import type { TranslationPrefs } from '../../features/translation/types'

interface Props {
  sources: NewsSource[]
  homeFeedLayout?: HomeFeedLayout
  readIds?: ReadonlySet<string>
  savedIds?: ReadonlySet<string>
  prestoredIds?: ReadonlySet<string>
  translationPrefs?: TranslationPrefs
  onBack: () => void
  onOpenArticle: (article: Article) => void
}

const EMPTY_IDS: ReadonlySet<string> = new Set()

type WatchTab = 'inbox' | 'sources' | 'settings'
type GroupFilter = 'all' | SourceGroup

const TABS: { id: WatchTab; label: string }[] = [
  { id: 'inbox', label: '新动态' },
  { id: 'sources', label: '关注信源' },
  { id: 'settings', label: '提醒设置' },
]
const GROUPS: { id: GroupFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'ai', label: 'AI' },
  { id: 'tech', label: '科技' },
  { id: 'intl', label: '国际' },
  { id: 'cn', label: '国内' },
  { id: 'special', label: '其他' },
  { id: 'custom', label: '自定义' },
]
const MODES: { id: WatchMode; title: string; detail: string }[] = [
  { id: 'instant', title: '有更新就提醒', detail: '前台横幅或 Android 系统通知' },
  { id: 'inbox', title: '只存入收件箱', detail: '静默收集，阅读时再来看' },
]

const fmtTime = (at: number): string => {
  if (Date.now() - at < 60_000) return '刚刚'
  if (Date.now() - at < 3_600_000) return Math.max(1, Math.floor((Date.now() - at) / 60_000)) + ' 分钟前'
  if (Date.now() - at < 86_400_000) return Math.max(1, Math.floor((Date.now() - at) / 3_600_000)) + ' 小时前'
  return new Date(at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function QuietIllustration() {
  return (
    <svg viewBox="0 0 180 156" fill="none" className="sw-quiet-art" aria-hidden="true">
      <rect x="36" y="17" width="110" height="122" rx="14" className="sw-art-back" />
      <path d="M55 17V10a8 8 0 0 1 8-8h73" className="sw-art-muted" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="26" y="30" width="108" height="116" rx="13" className="sw-art-page" />
      <path d="M49 65h48M49 79h60M49 93h40" className="sw-art-lines" strokeWidth="3" strokeLinecap="round" />
      <circle cx="117" cy="42" r="23" className="sw-art-seal" />
      <path d="M117 29v15m0 6v1" className="sw-art-signal" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M10 118h19M147 111h23M151 124h12" className="sw-art-muted" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function SourceRow({
  source, watched, mode, onToggle, onConfigure,
}: {
  source: NewsSource
  watched: boolean
  mode: WatchMode
  onToggle: () => void
  onConfigure: () => void
}) {
  const backgroundReady = supportsNativeSourceWatch(source)
  return (
    <div className={'sw-source-row' + (watched ? ' sw-source-row--on' : '')}>
      <span className="sw-source-monogram" aria-hidden="true">{source.name.trim().slice(0, 1).toUpperCase()}</span>
      <button
        type="button"
        className="sw-source-copy"
        onClick={watched ? onConfigure : onToggle}
        aria-label={watched ? '设置 ' + source.name + ' 的提醒方式' : '关注 ' + source.name}
      >
        <span className="sw-source-name">{source.name}</span>
        <span className="sw-source-description">
          {watched ? (mode === 'inbox' ? '静默收集' : '更新提醒') + ' · ' : ''}
          {source.paused ? '信源已暂停' : backgroundReady ? '支持后台检测' : '打开应用时检测'}
        </span>
      </button>
      {watched && (
        <button type="button" onClick={onConfigure} className="sw-configure" aria-label={'调整 ' + source.name + ' 提醒设置'}>
          <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="sw-watch-toggle"
        aria-label={(watched ? '取消关注 ' : '关注 ') + source.name}
        aria-pressed={watched}
        onClick={onToggle}
      >
        {watched ? <BellRing size={19} strokeWidth={1.8} aria-hidden="true" /> : <Bell size={19} strokeWidth={1.7} aria-hidden="true" />}
      </button>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" className="sw-switch" role="switch" aria-label={label} aria-checked={checked} data-checked={checked} onClick={onChange}>
      <span className="sw-switch-thumb" />
    </button>
  )
}

function WatchSourceSheet({
  source, mode, onMode, onRemove, onClose, initialPermissionHint,
}: {
  source: NewsSource
  mode: WatchMode
  onMode: (mode: WatchMode) => void
  onRemove: () => void
  onClose: () => void
  initialPermissionHint?: string | null
}) {
  const [permissionHint, setPermissionHint] = useState<string | null>(null)
  useHardwareBackLayer(true, () => { onClose(); return true })

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="sw-modal-layer" role="presentation" onClick={onClose}>
      <div
        className="sw-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sw-source-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sw-modal-grip" aria-hidden="true" />
        <div className="sw-modal-heading">
          <div>
            <h2 id="sw-source-title" className="sw-modal-title">{source.name}</h2>
            <p className="sw-modal-subtitle">{supportsNativeSourceWatch(source) ? '可在 Android 后台检查更新' : '应用打开时检查更新'}</p>
          </div>
          <button type="button" aria-label="关闭提醒设置" className="sw-icon-button" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="sw-modal-options" role="radiogroup" aria-label="提醒方式">
          {MODES.map(item => (
            <button
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              className={'sw-mode-option' + (mode === item.id ? ' sw-mode-option--active' : '')}
              key={item.id}
              onClick={() => {
                onMode(item.id)
                void haptics.tick()
                if (item.id === 'instant') {
                  void requestWatchNotificationPermission().then(granted => {
                    setPermissionHint(granted ? '系统通知已开启' : '系统通知未授权，更新仍会保留在收件箱')
                  }).catch(() => setPermissionHint('暂时无法申请通知权限'))
                } else setPermissionHint(null)
              }}
            >
              <span className="sw-mode-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
              <span className="sw-radio-dot">{mode === item.id && <Check size={13} strokeWidth={2.3} aria-hidden="true" />}</span>
            </button>
          ))}
        </div>
        {mode === 'instant' && (permissionHint || initialPermissionHint) && <p className="sw-permission-hint" role="status">{permissionHint || initialPermissionHint}</p>}
        <div className="sw-modal-footer">
          <button type="button" className="sw-text-destructive" onClick={onRemove}>取消关注</button>
          <button type="button" className="sw-primary sw-modal-done" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function SourceWatchScreen({
  sources,
  homeFeedLayout = 'classic',
  readIds = EMPTY_IDS,
  savedIds = EMPTY_IDS,
  prestoredIds = EMPTY_IDS,
  translationPrefs,
  onBack,
  onOpenArticle,
}: Props) {
  const [state, setState] = useState(loadWatchState)
  const [tab, setTab] = useState<WatchTab>('inbox')
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<GroupFilter>('all')
  const [visibleLimit, setVisibleLimit] = useState(40)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [intervalPicker, setIntervalPicker] = useState(false)
  const [showUnread, setShowUnread] = useState(false)
  const [inboxLimit, setInboxLimit] = useState(40)
  const [checking, setChecking] = useState(false)
  const [checkResult, setCheckResult] = useState<string | null>(null)
  const [notificationHint, setNotificationHint] = useState<string | null>(null)
  const [notificationEnabled, setNotificationEnabled] = useState<boolean | null>(null)
  const [nativeStatus, setNativeStatus] = useState<NativeWatchStatus | null>(null)
  const [testingNotification, setTestingNotification] = useState(false)
  const android = Capacitor.getPlatform() === 'android'

  const sourceMap = useMemo(() => new Map(sources.map(source => [source.id, source])), [sources])
  const ruleMap = useMemo(() => new Map(state.rules.filter(rule => rule.enabled).map(rule => [rule.sourceId, rule])), [state.rules])
  const followed = useMemo(() => sources.filter(source => ruleMap.has(source.id)), [sources, ruleMap])
  const count = followed.length
  const unread = state.events.reduce((total, event) => total + (event.read ? 0 : 1), 0)
  const nativeCount = followed.filter(supportsNativeSourceWatch).length
  const lastChecked = Math.max(0, ...followed.map(source => state.lastChecked[source.id] || 0))
  const selectedSource = selectedId ? sourceMap.get(selectedId) : undefined

  const commit = useCallback((next: WatchState) => {
    setState(next)
    saveWatchState(next)
  }, [])

  useEffect(() => {
    const reload = () => setState(loadWatchState())
    window.addEventListener('newsnook:source-watch-changed', reload)
    return () => window.removeEventListener('newsnook:source-watch-changed', reload)
  }, [])

  useEffect(() => {
    const openInbox = () => {
      setSelectedId(null)
      setShowUnread(false)
      setTab('inbox')
    }
    window.addEventListener('newsnook:source-watch-open-inbox', openInbox)
    return () => window.removeEventListener('newsnook:source-watch-open-inbox', openInbox)
  }, [])

  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('.sw-shell [data-settings-scroll]')
    if (scroller) scroller.scrollTop = 0
  }, [tab])


  useEffect(() => {
    if (tab !== 'settings' || !android) return
    let alive = true
    const updateStatus = () => {
      void getNativeWatchStatus().then(status => {
        if (alive) {
          setNativeStatus(status)
          setNotificationEnabled(status?.enabled ?? false)
        }
      }).catch(() => { if (alive) setNotificationEnabled(false) })
    }
    updateStatus()
    document.addEventListener('visibilitychange', updateStatus)
    window.addEventListener('newsnook:source-watch-native-synced', updateStatus)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', updateStatus)
      window.removeEventListener('newsnook:source-watch-native-synced', updateStatus)
    }
  }, [tab, android])

  const requestNotifications = async (): Promise<void> => {
    if (!android) return
    try {
      const granted = await requestWatchNotificationPermission()
      setNotificationEnabled(granted)
      setNotificationHint(granted ? '系统通知已开启' : '系统通知尚未开启；更新仍会保留在收件箱')
    } catch { setNotificationHint('通知权限检查失败，请在系统设置中确认') }
  }

  const sendTestNotification = async (): Promise<void> => {
    if (!android || testingNotification) return
    setTestingNotification(true)
    try {
      const allowed = await requestWatchNotificationPermission()
      setNotificationEnabled(allowed)
      if (!allowed) {
        setNotificationHint('未获得系统通知权限，请在 Android 设置中开启后重试')
        return
      }
      const delivered = await sendWatchTestNotification()
      setNotificationHint(delivered ? '已交给 Android 通知栏；如果未显示，请检查系统通知渠道或免打扰设置' : '系统拒绝了通知，请检查系统通知设置')
    } catch { setNotificationHint('发送测试通知失败，请检查系统通知设置') }
    finally { setTestingNotification(false) }
  }


  const toggleWatch = (sourceId: string) => {
    const enabled = ruleMap.has(sourceId)
    const cursors = { ...state.cursors }
    delete cursors[sourceId]
    const rules = state.rules.filter(rule => rule.sourceId !== sourceId)
    commit({ ...state, cursors, rules: enabled ? rules : [...rules, { sourceId, enabled: true, mode: 'instant' }] })
    void haptics.tick()
    if (enabled) setSelectedId(null)
    else {
      setSelectedId(sourceId)
      setNotificationHint(null)
      // Selecting a bell is an explicit opt-in; request Android 13+ permission
      // here, not only when the user re-selects the default "instant" mode.
      if (android) void requestNotifications()
    }
  }

  const changeMode = (sourceId: string, mode: WatchMode) => {
    commit({
      ...state,
      rules: state.rules.map(rule => rule.sourceId === sourceId ? { ...rule, mode } : rule),
    })
  }

  const refresh = async () => {
    if (checking || count === 0) return
    setChecking(true)
    setCheckResult(null)
    try {
      const added = await checkWatchedSources(sources, true)
      setCheckResult(added ? '本轮发现 ' + added + ' 篇新内容' : '本轮没有发现新内容')
    } catch {
      setCheckResult('本轮检测未完成，请稍后重试')
    } finally {
      setState(loadWatchState())
      setChecking(false)
    }
  }

  const filteredSources = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return sources.filter(source => !source.workspaceOnly
      && (ruleMap.has(source.id) || !source.paused)
      && Boolean(source.url)
      && (group === 'all' || source.group === group)
      && (!term || [source.name, source.label, source.url].join(' ').toLocaleLowerCase().includes(term)))
  }, [sources, query, group, ruleMap])
  const matchedFollowed = useMemo(() => filteredSources.filter(source => ruleMap.has(source.id)), [filteredSources, ruleMap])
  const unmatched = useMemo(() => filteredSources.filter(source => !ruleMap.has(source.id)).sort((a, b) => a.name.localeCompare(b.name)), [filteredSources, ruleMap])
  const shownAvailable = unmatched.slice(0, visibleLimit)
  const displayedEvents = useMemo(() =>
    state.events
      .filter(event => !showUnread || !event.read)
      .sort((a, b) => b.discoveredAt - a.discoveredAt),
  [state.events, showUnread])

  const visibleEvents = useMemo(() => displayedEvents.slice(0, inboxLimit), [displayedEvents, inboxLimit])

  const openWatchedArticle = (article: Article) => {
    const key = watchArticleKey(article)
    if (state.events.some(event => event.key === key && !event.read)) {
      commit({ ...state, events: state.events.map(event =>
        event.key === key ? { ...event, read: true } : event) })
    }
    onOpenArticle(article)
  }

  const chooseTab = (next: WatchTab) => {
    if (tab === next) return
    setTab(next)
    setSelectedId(null)
    void haptics.tick()
  }

  const toolbar = (
    <nav className="sw-tabs-wrap" aria-label="关注动态页面">
      <div className="sw-tabs" role="tablist" aria-label="关注动态分区">
        <span className="sw-tab-slider" style={{ transform: 'translateX(' + TABS.findIndex(item => item.id === tab) * 100 + '%)' }} aria-hidden="true" />
        {TABS.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={'sw-tab' + (tab === item.id ? ' sw-tab--active' : '')} onClick={() => chooseTab(item.id)}>
            {item.label}{item.id === 'inbox' && unread > 0 && <span className="sw-tab-count">{unread > 99 ? '99+' : unread}</span>}
          </button>
        ))}
      </div>
    </nav>
  )

  return (
    <>
      <SettingsShell title="关注动态" caption="跨预设收集你关心的更新" toolbar={toolbar} onBack={onBack} className="sw-shell">
        <div className="sw-page" key={tab}>
          {tab === 'inbox' && (
            <section className="sw-inbox-view">
              <div className="sw-masthead">
                <div>
                  <h2 className="sw-headline">{count ? '新动态' : '关注，从少而精开始'}{count > 0 && <span className="sw-headline-number">{unread}</span>}</h2>
                  <p className="sw-lead">{count ? '正在留意 ' + count + ' 个信源，与你当前浏览的预设无关。' : '只追踪你选择的来源，其他信源不会在后台检测。'}</p>
                </div>
                {count > 0 && (
                  <button type="button" className="sw-masthead-link" onClick={() => chooseTab('sources')}>管理关注 <ChevronRight size={16} aria-hidden="true" /></button>
                )}
              </div>

              {!count ? (
                <div className="sw-quiet-state">
                  <QuietIllustration />
                  <h3>让重要消息自己抵达</h3>
                  <p>从所有预设里挑选几个关心的来源。它们有更新时，文章就会出现在这里。</p>
                  <button type="button" className="sw-primary" onClick={() => chooseTab('sources')}><Plus size={18} strokeWidth={2} aria-hidden="true" />选择关注信源</button>
                  <div className="sw-quiet-note"><ShieldCheck size={16} strokeWidth={1.7} aria-hidden="true" />默认不监控任何信源</div>
                </div>
              ) : state.events.length === 0 ? (
                <div className="sw-no-news">
                  <div className="sw-no-news-icon"><Check size={30} strokeWidth={1.4} aria-hidden="true" /></div>
                  <h3>暂时没有新动态</h3>
                  <p>第一次检查只记录当前文章；之后有新内容时才会提醒。</p>
                  <button type="button" disabled={checking} className="sw-secondary" onClick={() => void refresh()}>
                    <Radio size={16} aria-hidden="true" />{checking ? '正在检查…' : '立即检查'}
                  </button>
                  {checkResult && <p className="sw-check-note" role="status">{checkResult}</p>}
                </div>
              ) : (
                <>
                  <div className="sw-inbox-tools">
                    <div className="sw-filter-pair" role="group" aria-label="动态筛选">
                      <button type="button" aria-pressed={!showUnread} className={!showUnread ? 'sw-filter-selected' : ''} onClick={() => { setShowUnread(false); setInboxLimit(40) }}>全部动态</button>
                      <button type="button" aria-pressed={showUnread} className={showUnread ? 'sw-filter-selected' : ''} onClick={() => { setShowUnread(true); setInboxLimit(40) }}>仅未读</button>
                    </div>
                    {unread > 0 && <button type="button" className="sw-mark-all" onClick={() => { commit({ ...state, events: state.events.map(event => ({ ...event, read: true })) }); void haptics.tick() }}><CheckCheck size={16} aria-hidden="true" />全部已读</button>}
                  </div>
                  {displayedEvents.length === 0 ? (
                    <div className="sw-filter-empty">所有新动态都已读完。<button type="button" onClick={() => { setShowUnread(false); setInboxLimit(40) }}>查看全部</button></div>
                  ) : (
                    <div className="sw-feed-bleed">
                      <WatchArticleFeed
                        events={visibleEvents}
                        layout={homeFeedLayout}
                        readIds={readIds}
                        savedIds={savedIds}
                        prestoredIds={prestoredIds}
                        translationPrefs={translationPrefs}
                        onOpen={openWatchedArticle}
                      />
                      {displayedEvents.length > visibleEvents.length && (
                        <button type="button" className="sw-more sw-inbox-more" onClick={() => setInboxLimit(limit => limit + 40)}>
                          加载更多动态 · 剩余 {displayedEvents.length - visibleEvents.length} 篇
                          <ChevronRight size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {tab === 'sources' && (
            <section className="sw-sources-view">
              <div className="sw-masthead">
                <div>
                  <h2 className="sw-headline">{count}<span className="sw-headline-unit"> 个关注信源</span></h2>
                  <p className="sw-lead">只有开启提醒的信源会进入检测队列。</p>
                </div>
                {count > 0 && <span className="sw-active-indicator"><span />按需检测</span>}
              </div>
              <label className="sw-search">
                <Search size={19} strokeWidth={1.8} aria-hidden="true" />
                <input type="search" aria-label="搜索关注信源" value={query} placeholder="搜索信源名称或地址" autoComplete="off"
                  onChange={event => { setQuery(event.target.value); setVisibleLimit(40) }} />
                {query && <button type="button" aria-label="清除搜索" onClick={() => { setQuery(''); setVisibleLimit(40) }}><X size={18} /></button>}
              </label>
              <div className="sw-groups" role="group" aria-label="筛选信源分类">
                {GROUPS.map(item => (
                  <button type="button" key={item.id} aria-pressed={group === item.id}
                    className={group === item.id ? 'sw-group-active' : ''}
                    onClick={() => { setGroup(item.id); setVisibleLimit(40) }}>{item.label}</button>
                ))}
              </div>
              {matchedFollowed.length > 0 && (
                <div className="sw-source-section">
                  <div className="sw-section-heading"><h3>已关注</h3><span>{matchedFollowed.length}</span></div>
                  <div className="sw-source-list">
                    {matchedFollowed.map(source => (
                      <SourceRow key={source.id} source={source} watched mode={ruleMap.get(source.id)?.mode || 'instant'} onToggle={() => toggleWatch(source.id)} onConfigure={() => setSelectedId(source.id)} />
                    ))}
                  </div>
                </div>
              )}
              {unmatched.length > 0 && (
                <div className="sw-source-section">
                  <div className="sw-section-heading"><h3>{matchedFollowed.length ? '发现更多信源' : '从这里开始关注'}</h3><span>{unmatched.length}</span></div>
                  <div className="sw-source-list">
                    {shownAvailable.map(source => (
                      <SourceRow key={source.id} source={source} watched={false} mode="instant" onToggle={() => toggleWatch(source.id)} onConfigure={() => setSelectedId(source.id)} />
                    ))}
                  </div>
                  {unmatched.length > shownAvailable.length && <button type="button" className="sw-more" onClick={() => setVisibleLimit(limit => limit + 40)}>显示更多来源 · 剩余 {unmatched.length - shownAvailable.length} 个 <ChevronRight size={15} aria-hidden="true" /></button>}
                </div>
              )}
              {filteredSources.length === 0 && <div className="sw-list-empty"><Search size={26} strokeWidth={1.4} /><p>没有找到匹配的信源</p><button type="button" onClick={() => { setQuery(''); setGroup('all') }}>清除筛选</button></div>}
              <p className="sw-catalog-note">多个预设中的同一个信源只会监控一次。直接 RSS 支持 Android 后台检测，特殊网页在打开应用时检查。</p>
            </section>
          )}

          {tab === 'settings' && (
            <section className="sw-settings-view">
              <div className="sw-masthead">
                <div>
                  <h2 className="sw-headline">安静地留意更新</h2>
                  <p className="sw-lead">关注由你决定，提醒也由你决定。</p>
                </div>
              </div>
              <div className="sw-monitor-summary">
                <span className="sw-summary-emblem"><Radio size={23} strokeWidth={1.5} aria-hidden="true" /></span>
                <div><strong>{count ? '正在关注 ' + count + ' 个信源' : '监控尚未开启'}</strong><p>{count ? nativeCount + ' 个支持后台检测 · ' + (count - nativeCount) + ' 个前台检测' : '关注信源后，才会安排相应检查任务'}</p></div>
                <button type="button" aria-label="管理关注列表" onClick={() => chooseTab('sources')}><ChevronRight size={19} /></button>
              </div>

              <div className="sw-settings-section">
                <h3>检测计划</h3>
                <div className="sw-settings-list">
                  <button type="button" className="sw-setting-row" onClick={() => setIntervalPicker(true)}>
                    <span className="sw-setting-icon"><Clock3 size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>检查频率</strong><small>Android 会按系统调度执行</small></span>
                    <span className="sw-setting-value">{state.intervalMinutes === 120 ? '每 2 小时' : '每 ' + state.intervalMinutes + ' 分钟'}</span>
                    <ChevronRight size={17} className="sw-setting-chevron" aria-hidden="true" />
                  </button>
                  <div className="sw-setting-row">
                    <span className="sw-setting-icon"><Bell size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>夜间免打扰</strong><small>23:00—08:00 静音，仍保留新文章</small></span>
                    <Toggle label="夜间免打扰" checked={state.quietHours} onChange={() => commit({ ...state, quietHours: !state.quietHours })} />
                  </div>
                  <div className="sw-setting-row">
                    <span className="sw-setting-icon"><Wifi size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>仅在 Wi-Fi 后台检测</strong><small>避免在移动网络中主动检查</small></span>
                    <Toggle label="仅在 Wi-Fi 后台检测" checked={state.wifiOnly} onChange={() => commit({ ...state, wifiOnly: !state.wifiOnly })} />
                  </div>
                </div>
              </div>

              <div className="sw-settings-section">
                <h3>通知与状态</h3>
                <div className="sw-settings-list">
                  <button type="button" className="sw-setting-row" onClick={() => {
                    window.dispatchEvent(new Event('newsnook:source-watch-preview'))
                  }}>
                    <span className="sw-setting-icon"><Eye size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>预览应用内横幅</strong><small>在当前页面顶部查看提醒效果，不新增文章</small></span>
                    <ChevronRight size={17} className="sw-setting-chevron" aria-hidden="true" />
                  </button>
                  <button type="button" className="sw-setting-row" onClick={() => void requestNotifications()} disabled={!android}>
                    <span className="sw-setting-icon"><BellRing size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>Android 系统通知</strong><small>关注信源发现新文章时显示在通知栏</small></span>
                    <span className="sw-setting-value">{android ? notificationEnabled === true ? '已开启' : notificationEnabled === false ? '未开启' : '检查中' : '仅 Android'}</span>
                    {android && <ChevronRight size={17} className="sw-setting-chevron" aria-hidden="true" />}
                  </button>
                  {android && nativeCount > 0 && (
                    <div className="sw-setting-row" role="status">
                      <span className="sw-setting-icon"><Radio size={19} strokeWidth={1.7}/></span>
                      <span className="sw-setting-copy">
                        <strong>Android 后台检测任务</strong>
                        <small>{nativeStatus?.lastJobAt
                          ? `上次 ${new Date(nativeStatus.lastJobAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 已检查 ${nativeStatus.lastJobChecked} 源 · 发现 ${nativeStatus.lastJobNew} 篇 · 已通知 ${nativeStatus.lastJobNotified} 次${nativeStatus.lastJobErrors ? ' · 失败 ' + nativeStatus.lastJobErrors + ' 源' : ''}`
                          : '尚未完成首次后台轮询，具体时间由 Android 决定'}</small>
                      </span>
                      <span className="sw-setting-value">{nativeStatus?.scheduled ? '已调度' : '未调度'}</span>
                    </div>
                  )}
                  {android && <button type="button" className="sw-setting-row" onClick={() => void sendTestNotification()} disabled={testingNotification}>
                    <span className="sw-setting-icon"><Send size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>发送测试通知</strong><small>验证权限、通知渠道与锁屏通知入口</small></span>
                    {testingNotification ? <LoaderCircle size={17} className="sw-spinning sw-setting-chevron" aria-hidden="true" /> : <ChevronRight size={17} className="sw-setting-chevron" aria-hidden="true" />}
                  </button>}
                  {notificationHint && <p className="sw-inline-status" role="status">{notificationHint}</p>}
                  {android && notificationEnabled === false && <button type="button" className="sw-notification-settings-link" onClick={() => void openWatchNotificationSettings().catch(() => setNotificationHint('无法打开系统通知设置'))}>打开 Android 通知设置 <ChevronRight size={15} aria-hidden="true" /></button>}
                  <div className="sw-setting-row sw-setting-row--info">
                    <span className="sw-setting-icon"><Info size={19} strokeWidth={1.7}/></span>
                    <span className="sw-setting-copy"><strong>最近检查</strong><small>{lastChecked ? fmtTime(lastChecked) : '尚未执行过检测'} · 由设备独立完成</small></span>
                  </div>
                </div>
              </div>

              <button type="button" disabled={checking || count === 0} className="sw-check-now" onClick={() => void refresh()}>
                {checking ? <LoaderCircle size={18} className="sw-spinning" aria-hidden="true" /> : <Radio size={18} aria-hidden="true" />}
                {checking ? '正在检查已关注信源' : '立即检查关注来源'}
              </button>
              {checkResult && <p className="sw-check-status" role="status">{checkResult}</p>}
              <p className="sw-settings-footnote"><ShieldCheck size={16} strokeWidth={1.7} aria-hidden="true" />所有关注记录与更新列表仅保存在本机。没有关注信源时不会发出检测请求。</p>
            </section>
          )}
        </div>
      </SettingsShell>
      <OptionPickerDialog
        open={intervalPicker}
        title="检查频率"
        value={String(state.intervalMinutes)}
        options={[
          { id: '30', label: '每 30 分钟', description: '更新更快，检查次数更多' },
          { id: '60', label: '每 60 分钟', description: '推荐，兼顾及时性与电量' },
          { id: '120', label: '每 2 小时', description: '更节省流量与电量' },
        ]}
        onChange={value => { commit({ ...state, intervalMinutes: Number(value) }); setIntervalPicker(false) }}
        onCancel={() => setIntervalPicker(false)}
      />
      {selectedSource && ruleMap.has(selectedSource.id) && <WatchSourceSheet
        source={selectedSource} mode={ruleMap.get(selectedSource.id)?.mode || 'instant'}
        onMode={mode => changeMode(selectedSource.id, mode)}
        onRemove={() => toggleWatch(selectedSource.id)}
        initialPermissionHint={notificationHint}
        onClose={() => setSelectedId(null)}
      />}
    </>
  )
}
