import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Circle, Minus, PanelBottom, PanelTop, Plus, Trash2, type LucideIcon } from 'lucide-react'
import { BrowserPageHeader, BrowserPrivateNotice, BrowserStatusBanner } from './BrowserPrimitives'
import { browserHostLabel, validateBrowserUserAgent, type BrowserPreferences, type BrowserSearchChoice, type BrowserUserAgentMode } from './browserPreferences'
import { ToggleSwitch } from '../../components/ToggleSwitch'

export type { BrowserSearchChoice } from './browserPreferences'

interface BrowserSettingsPanelProps {
  search: BrowserSearchChoice
  bottomAddress: boolean
  desktop: boolean
  hasPage: boolean
  pending?: boolean
  historyCount: number
  onBack: () => void
  onSearchChange: (id: BrowserSearchChoice) => void
  onAddressPositionChange: (bottom: boolean) => void
  onDesktopChange: () => void
  onClearHistory: () => void
  preferences?: BrowserPreferences
  onPreferencesChange?: (next: BrowserPreferences) => boolean | Promise<boolean>
  privateMode?: boolean
  onPrivateModeChange?: (enabled: boolean) => void
  currentSite?: string
  onClearSiteData?: () => void
  error?: string
}

interface Choice<T extends string> {
  id: T
  label: string
  icon?: LucideIcon
}

const searchChoices: Choice<BrowserSearchChoice>[] = [
  { id: 'bing', label: 'Bing' },
  { id: 'google', label: 'Google' },
  { id: 'baidu', label: '百度' },
  { id: 'duckduckgo', label: 'DuckDuckGo' },
]
const addressChoices: Choice<'top' | 'bottom'>[] = [
  { id: 'top', label: '顶部', icon: PanelTop },
  { id: 'bottom', label: '底部', icon: PanelBottom },
]
const userAgentChoices: Choice<BrowserUserAgentMode>[] = [
  { id: 'system', label: '系统默认' },
  { id: 'desktop', label: '桌面版' },
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
  preferences, onPreferencesChange, privateMode = false, onPrivateModeChange,
  currentSite, onClearSiteData, error = '',
}: BrowserSettingsPanelProps) {
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [customExpanded, setCustomExpanded] = useState(false)
  const [userAgentDraft, setUserAgentDraft] = useState(preferences?.customUserAgent ?? '')
  const [userAgentError, setUserAgentError] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(false)
  const userAgentInput = useRef<HTMLTextAreaElement>(null)
  const busy = pending || saving
  const hasPreferences = Boolean(preferences && onPreferencesChange)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { setUserAgentDraft(preferences?.customUserAgent ?? '') }, [preferences?.customUserAgent])
  useEffect(() => { if (customExpanded) userAgentInput.current?.focus() }, [customExpanded])

  async function savePatch(patch: Partial<BrowserPreferences>): Promise<boolean> {
    if (!preferences || !onPreferencesChange || busy || inFlight.current) return false
    inFlight.current = true
    setSaving(true)
    setSaveError('')
    try {
      const saved = await onPreferencesChange({...preferences, ...patch})
      if (!saved && mounted.current) setSaveError('设置未保存，请重试')
      return saved
    } catch (cause) {
      if (mounted.current) setSaveError(cause instanceof Error ? cause.message : '设置未保存，请重试')
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) setSaving(false)
    }
  }

  function chooseUserAgent(mode: BrowserUserAgentMode) {
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
        {privateMode && <BrowserPrivateNotice/>}
        {saving && <p className="browser-save-status" role="status">正在保存设置…</p>}

        <SettingsSection id="browser-settings-search" title="搜索与布局">
          <p className="browser-setting-caption">默认搜索引擎</p>
          <ChoiceGroup label="默认搜索引擎" choices={searchChoices} value={search} disabled={busy} onChange={onSearchChange}/>
          <p className="browser-setting-caption browser-setting-caption-spaced">地址栏位置</p>
          <ChoiceGroup label="地址栏位置" choices={addressChoices} value={bottomAddress ? 'bottom' : 'top'}
            disabled={busy} onChange={value => onAddressPositionChange(value === 'bottom')}/>
        </SettingsSection>

        <SettingsSection id="browser-settings-display" title="网页显示">
          {hasPreferences && preferences ? <>
            <p className="browser-setting-caption">浏览器标识（UA）</p>
            <ChoiceGroup label="浏览器标识" choices={userAgentChoices} value={preferences.userAgentMode}
              columns={3} disabled={busy} onChange={chooseUserAgent}/>
            <p className="browser-setting-help">更换标识可影响网站提供的版式，浏览内核保持不变。</p>
            {(customExpanded || preferences.userAgentMode === 'custom') && <form className="browser-user-agent-editor"
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
            {onPrivateModeChange && <SettingsToggle label="隐私浏览"
              description={privateMode ? '关闭后结束此次临时会话' : '打开独立会话，不记录浏览历史'}
              checked={privateMode} disabled={busy} onChange={() => {if (!busy) onPrivateModeChange(!privateMode)}}/>}
            {hasPreferences && preferences && <>
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
            <button type="button" aria-label="清除浏览历史" disabled={historyCount === 0 || busy || privateMode}
              onClick={onClearHistory} className="browser-setting-row browser-setting-action">
              <span className="browser-setting-label">
                <span className="browser-setting-title">清除浏览历史</span>
                <span>{privateMode ? '隐私会话不保存浏览历史' : historyCount > 0 ? historyCount + ' 条记录' : '暂无浏览历史'}</span>
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
          {onClearSiteData && !privateMode && <p className="browser-setting-help">清除站点数据会影响此应用内使用同一站点的页面。</p>}
        </SettingsSection>
      </div>
    </div>
  </section>
}
