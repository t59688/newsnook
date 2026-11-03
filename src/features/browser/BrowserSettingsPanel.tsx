import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronDown, Circle, Minus, PanelBottom, PanelTop, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { BrowserPageHeader, BrowserPrivateNotice, BrowserSheet, BrowserSiteIcon, BrowserStatusBanner } from './BrowserPrimitives'
import { browserHostLabel, normalizeBrowserPreferences, toggleBrowserDesktopMode, validateBrowserUserAgent, type BrowserPreferences, type BrowserSearchChoice, type BrowserMobileUserAgentMode } from './browserPreferences'
import { BROWSER_SEARCH_PROVIDERS } from './browserSearchCatalog'
import { ToggleSwitch } from '../../components/ToggleSwitch'
import { useHardwareBackLayer } from '../../hooks/useHardwareBackLayer'

export type { BrowserSearchChoice } from './browserPreferences'

interface BrowserSettingsPanelProps {
  search: BrowserSearchChoice
  bottomAddress: boolean
  desktop: boolean
  hasPage: boolean
  pending?: boolean
  historyCount: number
  onBack: () => void
  onSearchChange: (id: BrowserSearchChoice) => void | boolean | Promise<boolean>
  onAddressPositionChange: (bottom: boolean) => void
  onDesktopChange: () => void
  onClearHistory: () => void
  preferences?: BrowserPreferences
  onPreferencesChange?: (next: BrowserPreferences) => boolean | Promise<boolean>
  privateMode?: boolean
  isolatedProfiles?: boolean
  onPrivateModeChange?: (enabled: boolean) => void | boolean | Promise<boolean>
  currentSite?: string
  onClearSiteData?: () => void
  error?: string
}

interface Choice<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
}

const addressChoices: Choice<'top' | 'bottom'>[] = [
  { id: 'top', label: '顶部', icon: PanelTop },
  { id: 'bottom', label: '底部', icon: PanelBottom },
]
const userAgentChoices: Choice<BrowserMobileUserAgentMode>[] = [
  { id: 'system', label: '系统默认' },
  { id: 'android', label: 'Android' },
  { id: 'ios', label: 'iOS' },
  { id: 'custom', label: '自定义' },
]

function ChoiceGroup<T extends string>({label, choices, value, onChange, disabled = false, columns = 2}: {
  label: string; choices: Choice<T>[]; value: T; onChange: (id: T) => void
  disabled?: boolean; columns?: 2 | 3
}) {
  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return
    let nextIndex: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % choices.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + choices.length) % choices.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = choices.length - 1
    else return
    event.preventDefault()
    const next = choices[nextIndex]
    if (value !== next.id) onChange(next.id)
    event.currentTarget.closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus()
  }
  return <div role="radiogroup" aria-label={label}
    className={'browser-choice-grid' + (columns === 3 ? ' browser-choice-grid-three' : '')}>
    {choices.map((choice, index) => {
      const selected = value === choice.id
      const Icon = choice.icon
      return <button key={choice.id} type="button" role="radio" aria-label={choice.label}
        aria-checked={selected} tabIndex={selected ? 0 : -1} disabled={disabled}
        onClick={() => {if (!selected && !disabled) onChange(choice.id)}}
        onKeyDown={event => moveSelection(event, index)}
        className="browser-choice">
        {Icon && <Icon size={18} strokeWidth={1.8} aria-hidden="true"/>}
        <span>{choice.label}</span>
        {selected ? <Check size={18} strokeWidth={1.9} aria-hidden="true"/> : <Circle size={17} strokeWidth={1.6} aria-hidden="true"/>}
      </button>
    })}
  </div>
}

function SettingsSection({id, title, children}: {id: string; title: string; children: ReactNode}) {
  return <section className="browser-settings-section" aria-labelledby={id}>
    <h3 id={id}>{title}</h3>
    {children}
  </section>
}

function SettingsToggle({label, description, checked, disabled, onChange}: {
  label: string; description?: string; checked: boolean; disabled: boolean; onChange: () => void
}) {
  return <div className="browser-setting-row">
    <div className="browser-setting-label">
      <p>{label}</p>
      {description && <span>{description}</span>}
    </div>
    <div className="browser-setting-toggle">
      <ToggleSwitch label={label} checked={checked} disabled={disabled} onChange={onChange}/>
    </div>
  </div>
}

export function BrowserSettingsPanel({
  search, bottomAddress, desktop, hasPage, pending = false, historyCount,
  onBack, onSearchChange, onAddressPositionChange, onDesktopChange, onClearHistory,
  preferences, onPreferencesChange, privateMode = false, isolatedProfiles, onPrivateModeChange,
  currentSite, onClearSiteData, error = '',
}: BrowserSettingsPanelProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [customExpanded, setCustomExpanded] = useState(false)
  const [userAgentDraft, setUserAgentDraft] = useState(preferences?.customUserAgent ?? '')
  const [userAgentError, setUserAgentError] = useState('')
  const [searchPickerOpen, setSearchPickerOpen] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const userAgentInput = useRef<HTMLTextAreaElement>(null)
  const busy = pending || saving
  const hasPreferences = Boolean(preferences && onPreferencesChange)
  const effectivePrivateMode = preferences?.privateMode ?? privateMode
  const desktopEnabled = preferences?.userAgentMode === 'desktop'
  const currentProvider = BROWSER_SEARCH_PROVIDERS.find(provider => provider.id === search)

  useHardwareBackLayer(searchPickerOpen, () => {
    setSearchPickerOpen(false)
    return true
  })
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { setUserAgentDraft(preferences?.customUserAgent ?? '') }, [preferences?.customUserAgent])
  useEffect(() => { if (customExpanded) userAgentInput.current?.focus() }, [customExpanded])

  async function saveAction(action: () => void | boolean | Promise<boolean>): Promise<boolean> {
    if (busy || inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    setSaveError('')
    try {
      const saved = await action()
      if (saved === false && mounted.current) setSaveError('设置未保存，请重试')
      return saved !== false
    } catch (cause) {
      if (mounted.current) setSaveError(cause instanceof Error ? cause.message : '设置未保存，请重试')
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  function savePatch(patch: Partial<BrowserPreferences>): Promise<boolean> {
    if (!preferences || !onPreferencesChange) return Promise.resolve(false)
    return saveAction(() => onPreferencesChange(normalizeBrowserPreferences({...preferences, ...patch})))
  }

  function chooseUserAgent(mode: BrowserMobileUserAgentMode) {
    if (mode === 'custom') {
      setCustomExpanded(true)
      if (preferences?.customUserAgent && !validateBrowserUserAgent(preferences.customUserAgent)) {
        void savePatch({userAgentMode: 'custom'})
      }
    } else {
      void savePatch({userAgentMode: mode}).then(saved => {
        if (saved && mounted.current) setCustomExpanded(false)
      })
    }
  }

  async function applyUserAgent() {
    const validation = validateBrowserUserAgent(userAgentDraft)
    setUserAgentError(validation ?? '')
    if (validation) { userAgentInput.current?.focus(); return }
    await savePatch({userAgentMode: 'custom', customUserAgent: userAgentDraft.trim()})
  }

  return <section aria-label="浏览器设置" aria-busy={busy} className="browser-panel browser-settings"
    style={{paddingTop: 'var(--sat)', paddingBottom: 'var(--sab)'}}>
    <BrowserPageHeader title="浏览器设置" onBack={onBack}/>
    <div className="browser-panel-scroll">
      <div className="browser-settings-content">
        {(error || saveError) && <BrowserStatusBanner error>{error || saveError}</BrowserStatusBanner>}
        {isolatedProfiles === false && <BrowserStatusBanner error>当前系统 WebView 不支持独立浏览会话。请更新 Android System WebView 后开启无痕或隐私模式。</BrowserStatusBanner>}
        {effectivePrivateMode && <BrowserPrivateNotice/>}
        {preferences?.incognitoMode && <BrowserStatusBanner>无痕模式：使用独立临时会话，不保存浏览历史，退出后清除网站数据和登录状态。</BrowserStatusBanner>}
        {saving && <p className="browser-save-status" role="status">正在保存设置…</p>}

        <SettingsSection id="browser-settings-search" title="搜索与布局">
          <label className="browser-setting-caption" htmlFor="browser-default-search-button">默认搜索引擎</label>
          <div className="browser-setting-select">
            <button type="button" id="browser-default-search-button"
              aria-label={'默认搜索引擎：' + (currentProvider?.name || search)}
              disabled={busy} onClick={() => setSearchPickerOpen(true)}
              className="browser-setting-select-btn">
              <div className="browser-setting-select-value">
                <BrowserSiteIcon url={currentProvider?.home || ''} name={currentProvider?.name} size="small" allowRemote={!effectivePrivateMode}/>
                <span className="browser-setting-select-name">{currentProvider?.name || search}</span>
                <span className="browser-setting-select-category">{currentProvider?.category}</span>
              </div>
              <ChevronDown size={18} strokeWidth={1.8} aria-hidden="true"/>
            </button>
            <select id="browser-default-search" aria-label="默认搜索引擎" value={search} disabled={busy}
              tabIndex={-1} aria-hidden="true" className="browser-setting-hidden-select"
              onChange={event => {const next = event.currentTarget.value as BrowserSearchChoice; if (next !== search) void saveAction(() => onSearchChange(next))}}>
              {(['搜索', 'AI', '学术'] as const).map(category => <optgroup key={category} label={category}>
                {BROWSER_SEARCH_PROVIDERS.filter(provider => provider.category === category)
                  .map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </optgroup>)}
            </select>
          </div>
          <p className="browser-setting-caption browser-setting-caption-spaced">地址栏位置</p>
          <ChoiceGroup label="地址栏位置" choices={addressChoices} value={bottomAddress ? 'bottom' : 'top'}
            disabled={busy} onChange={value => onAddressPositionChange(value === 'bottom')}/>
        </SettingsSection>

        <SettingsSection id="browser-settings-display" title="网页显示">
          {hasPreferences && preferences ? <>
            <div className="browser-setting-group">
              <SettingsToggle label="桌面版网页" description="请求电脑布局，更改后会重新加载当前网页"
                checked={desktopEnabled} disabled={busy}
                onChange={() => {void savePatch(toggleBrowserDesktopMode(preferences))}}/>
            </div>
            <p className="browser-setting-caption browser-setting-caption-spaced">浏览器标识（UA）</p>
            <ChoiceGroup label="浏览器标识" choices={userAgentChoices}
              value={desktopEnabled ? preferences.lastNonDesktopUserAgentMode : preferences.userAgentMode as BrowserMobileUserAgentMode}
              disabled={busy || desktopEnabled} onChange={chooseUserAgent}/>
            <p className="browser-setting-help">{desktopEnabled
              ? '桌面版使用电脑标识，关闭后恢复所选标识。'
              : preferences.userAgentMode === 'ios' ? '使用 iPhone 兼容标识，浏览内核保持不变。'
              : '更改后重新加载当前网页，浏览内核保持不变。'}</p>
            {!desktopEnabled && (customExpanded || preferences.userAgentMode === 'custom') && <form className="browser-user-agent-editor"
              onSubmit={event => {event.preventDefault(); if (!busy) void applyUserAgent()}}>
              <label htmlFor="browser-custom-user-agent">自定义浏览器标识</label>
              <textarea id="browser-custom-user-agent" ref={userAgentInput} aria-label="自定义浏览器标识"
                aria-invalid={Boolean(userAgentError)} aria-describedby={userAgentError ? 'browser-user-agent-error' : 'browser-user-agent-help'}
                value={userAgentDraft} disabled={busy} rows={3} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}
                placeholder="Mozilla/5.0 …" onInput={event => {
                  setUserAgentDraft(event.currentTarget.value)
                  if (userAgentError) setUserAgentError('')
                }}/>
              <p id="browser-user-agent-help" className="browser-setting-help">最多 512 个英文字符，保存后用于网页请求。</p>
              {userAgentError && <p id="browser-user-agent-error" className="browser-field-error" role="alert">{userAgentError}</p>}
              <button type="submit" disabled={busy} className="browser-action-button browser-action-primary">应用自定义标识</button>
            </form>}
            <div className="browser-setting-group browser-setting-group-spaced">
              <div className="browser-setting-row">
                <div className="browser-setting-label"><p>网页文字大小</p><span>仅调整网页文字</span></div>
                <div className="browser-text-size-control" aria-label="网页文字大小">
                  <button type="button" aria-label="缩小网页文字" disabled={busy || preferences.textZoom <= 75}
                    onClick={() => {void savePatch({textZoom: Math.max(75, preferences.textZoom - 10)})}}><Minus size={18}/></button>
                  <button type="button" aria-label="恢复默认文字大小" title="恢复为 100%" disabled={busy || preferences.textZoom === 100}
                    onClick={() => {void savePatch({textZoom: 100})}}><output aria-live="polite">{preferences.textZoom}%</output></button>
                  <button type="button" aria-label="放大网页文字" disabled={busy || preferences.textZoom >= 200}
                    onClick={() => {void savePatch({textZoom: Math.min(200, preferences.textZoom + 10)})}}><Plus size={18}/></button>
                </div>
              </div>
              <SettingsToggle label="JavaScript" description="关闭后，部分网页功能将无法使用" checked={preferences.javaScriptEnabled}
                disabled={busy} onChange={() => {void savePatch({javaScriptEnabled: !preferences.javaScriptEnabled})}}/>
              <SettingsToggle label="自动加载图片" description="关闭后可减少网页流量" checked={preferences.loadsImagesAutomatically}
                disabled={busy} onChange={() => {void savePatch({loadsImagesAutomatically: !preferences.loadsImagesAutomatically})}}/>
            </div>
          </> : <div className="browser-setting-group">
            <SettingsToggle label="桌面版网页" description={!hasPage ? '打开网页后可设置' : undefined}
              checked={desktop} disabled={!hasPage || busy}
              onChange={() => {if (hasPage && !busy) onDesktopChange()}}/>
          </div>}
        </SettingsSection>

        {(hasPreferences || onPrivateModeChange) && <SettingsSection id="browser-settings-privacy" title="隐私与权限">
          <div className="browser-setting-group">
            {(hasPreferences || onPrivateModeChange) && <SettingsToggle label="隐私浏览"
              description="独立临时会话，不保存浏览记录；停用网页资源缓存"
              checked={effectivePrivateMode} disabled={busy || (isolatedProfiles === false && !effectivePrivateMode)} onChange={() => {
                if (onPrivateModeChange) void saveAction(() => onPrivateModeChange(!effectivePrivateMode))
                else void savePatch({privateMode: !effectivePrivateMode, incognitoMode: false})
              }}/>}
            {hasPreferences && preferences && <>
              <SettingsToggle label="无痕模式" description="不保存浏览记录；本次会话结束即清除 Cookie 和登录状态"
                checked={preferences.incognitoMode} disabled={busy || (isolatedProfiles === false && !preferences.incognitoMode)}
                onChange={() => {void savePatch({incognitoMode: !preferences.incognitoMode, privateMode: false})}}/>
              <p className="browser-setting-help">切换正常、无痕或隐私模式时，将关闭当前所有网页标签并打开空白页；普通历史和登录数据不会被删除。</p>
              <SettingsToggle label="第三方 Cookie" description="部分跨站登录可能需要开启"
                checked={preferences.thirdPartyCookiesEnabled} disabled={busy}
                onChange={() => {void savePatch({thirdPartyCookiesEnabled: !preferences.thirdPartyCookiesEnabled})}}/>
              <SettingsToggle label="媒体播放前需点按" description="阻止网页自动播放音视频"
                checked={preferences.mediaPlaybackRequiresUserGesture} disabled={busy}
                onChange={() => {void savePatch({mediaPlaybackRequiresUserGesture: !preferences.mediaPlaybackRequiresUserGesture})}}/>
              <SettingsToggle label="打开外部应用前确认" description="网站尝试跳转其他应用时先询问"
                checked={preferences.confirmExternalApps} disabled={busy}
                onChange={() => {void savePatch({confirmExternalApps: !preferences.confirmExternalApps})}}/>
            </>}
          </div>
        </SettingsSection>}

        <SettingsSection id="browser-settings-data" title="浏览数据">
          <div className="browser-setting-group">
            <button type="button" aria-label="清除浏览历史" disabled={historyCount === 0 || busy}
              onClick={onClearHistory} className="browser-setting-row browser-setting-action">
              <span className="browser-setting-label">
                <span className="browser-setting-title">清除浏览历史</span>
                <span>{historyCount > 0 ? historyCount + ' 条记录' : '暂无浏览历史'}</span>
              </span>
              <Trash2 size={19} strokeWidth={1.8} aria-hidden="true"/>
            </button>
            {onClearSiteData && <button type="button" aria-label="清除当前站点数据"
              disabled={!hasPage || busy} onClick={onClearSiteData} className="browser-setting-row browser-setting-action">
              <span className="browser-setting-label">
                <span className="browser-setting-title">清除当前站点数据</span>
                <span>{hasPage && currentSite ? browserHostLabel(currentSite) + ' · 将退出该站点登录' : '打开网页后可清除'}</span>
              </span>
              <Trash2 size={19} strokeWidth={1.8} aria-hidden="true"/>
            </button>}
          </div>
          {onClearSiteData && <p className="browser-setting-help">清除站点数据会影响此应用内使用同一站点的页面。</p>}
        </SettingsSection>
      </div>
    </div>
    {searchPickerOpen && <BrowserSheet title="选择默认搜索引擎" onClose={() => setSearchPickerOpen(false)}>
      <div className="browser-search-picker-sheet">
        {(['搜索', 'AI', '学术'] as const).map(category => <div key={category} className="browser-search-picker-group">
          <h4 className="browser-search-picker-category">{category}</h4>
          <div className="browser-search-picker-list">
            {BROWSER_SEARCH_PROVIDERS.filter(provider => provider.category === category).map(provider => {
              const selected = provider.id === search
              return <button key={provider.id} type="button" role="option" aria-selected={selected} disabled={busy}
                onClick={() => {
                  setSearchPickerOpen(false)
                  if (provider.id !== search) void saveAction(() => onSearchChange(provider.id))
                }}
                className={'browser-search-picker-item' + (selected ? ' is-selected' : '')}>
                <div className="browser-search-picker-item-main">
                  <BrowserSiteIcon url={provider.home} name={provider.name} size="small" allowRemote={!effectivePrivateMode}/>
                  <span className="browser-search-picker-name">{provider.name}</span>
                </div>
                {selected && <Check size={18} strokeWidth={2} className="browser-search-picker-check" aria-hidden="true"/>}
              </button>
            })}
          </div>
        </div>)}
      </div>
    </BrowserSheet>}
  </section>
}
