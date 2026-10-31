import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
// React initializes controlled textareas through defaultValue; linkedom lacks its DOM setter.
Object.defineProperty(window.HTMLTextAreaElement.prototype, 'defaultValue', {
  configurable: true,
  get(this: HTMLTextAreaElement) { return this.textContent ?? '' },
  set(this: HTMLTextAreaElement, value: string) { this.textContent = value },
})
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})
const { createRoot } = await import('react-dom/client')
const { BrowserPlacesPanel } = await import('../src/features/browser/BrowserPlacesPanel')
const { BrowserTabsPanel } = await import('../src/features/browser/BrowserTabsPanel')
const { BrowserSettingsPanel } = await import('../src/features/browser/BrowserSettingsPanel')
const { BrowserStartPage } = await import('../src/features/browser/BrowserStartPage')
const { BrowserSearchPanel } = await import('../src/features/browser/BrowserSearchPanel')
const { BROWSER_KEYS, loadBrowserPreferences, saveBrowserPreferences, resolveBrowserAddress } = await import('../src/features/browser/browserPreferences')
import type { BrowserSearchChoice } from '../src/features/browser/browserPreferences'
const root = createRoot(window.document.getElementById('root')!)

function button(label: string) {
  const control = [...window.document.querySelectorAll('button')].find(item =>
    item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
  assert.ok(control, `缺少按钮：${label}`)
  return control
}

async function click(control: Element) {
  await act(async () => {
    control.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))
  })
}

async function pressKey(control: Element, key: string) {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'key', { value: key })
  await act(async () => { control.dispatchEvent(event) })
}

async function search(value: string) {
  const input = window.document.querySelector('input[type="search"]') as HTMLInputElement | null
  assert.ok(input, '历史和书签提供搜索')
  await act(async () => {
    input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }))
  })
}

const now = new Date(2026, 9, 17, 15, 30).getTime()
const entries = [
  { title: '构建可读的网页', url: 'https://developer.mozilla.org/zh-CN/docs/Web', time: now },
  { title: '设计记录', url: 'https://design.example.com/notes', time: now - 86_400_000 },
]
const calls = {
  back: 0,
  clear: 0,
  restore: 0,
  opened: [] as string[],
  removed: [] as string[],
  options: [] as string[],
  selected: [] as number[],
  closed: [] as number[],
  newTab: 0,
  engines: [] as string[],
  positions: [] as boolean[],
  desktop: 0,
}
const placesProps = {
  entries,
  hiddenHostCount: 2,
  onBack: () => { calls.back++ },
  onOpen: (url: string) => { calls.opened.push(url) },
  onRemove: (url: string) => { calls.removed.push(url) },
  onClear: () => { calls.clear++ },
  onRestoreHidden: () => { calls.restore++ },
  onHistoryOptions: (entry: typeof entries[number]) => { calls.options.push(entry.url) },
}
const tabs = [
  { index: 0, id: 42, title: 'Mozilla 开发者网络', url: entries[0].url, active: true, loading: false },
  { index: 1, id: 77, title: '设计记录', url: entries[1].url, active: false, loading: true },
]
const tabProps = {
  pending: false,
  onBack: () => { calls.back++ },
  onSelect: (tab: typeof tabs[number]) => { calls.selected.push(tab.id) },
  onRemove: (tab: typeof tabs[number]) => { calls.closed.push(tab.id) },
  onNew: () => { calls.newTab++ },
}
const settingsProps = {
  search: 'bing' as const,
  bottomAddress: false,
  desktop: false,
  hasPage: false,
  historyCount: 2,
  onBack: () => { calls.back++ },
  onSearchChange: (id: string) => { calls.engines.push(id) },
  onAddressPositionChange: (bottom: boolean) => { calls.positions.push(bottom) },
  onDesktopChange: () => { calls.desktop++ },
  onClearHistory: () => { calls.clear++ },
}

const preferenceStorage = new Map<string, string>()
let preferenceWriteFailure = false
let preferenceWriteCount = 0
let delayedPreferenceSave: Promise<void> | null = null
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => preferenceStorage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (preferenceWriteFailure) throw new Error('Quota exceeded')
    preferenceStorage.set(key, String(value))
  },
} })

function FullSettingsHarness() {
  const [preferences, setPreferences] = React.useState(loadBrowserPreferences)
  return <BrowserSettingsPanel {...settingsProps} hasPage preferences={preferences} onPreferencesChange={async next => {
    preferenceWriteCount++
    if (delayedPreferenceSave) await delayedPreferenceSave
    const saved = saveBrowserPreferences(next)
    setPreferences(saved)
    return true
  }}/>
}

async function enterField(label: string, value: string) {
  const field = window.document.querySelector('[aria-label="' + label + '"]') as HTMLInputElement | HTMLTextAreaElement | null
  assert.ok(field, '缺少输入框：' + label)
  await act(async () => {
    field.value = value
    field.dispatchEvent(new window.Event('input', {bubbles: true, cancelable: true}))
  })
}

async function chooseSearchDefault(value: BrowserSearchChoice) {
  const select = window.document.querySelector('select[aria-label="默认搜索引擎"]') as HTMLSelectElement | null
  assert.ok(select, '设置提供原生搜索引擎选择器')
  await act(async () => {
    // Linkedom incorrectly clears a sibling selection even when selected=false.
    for (const option of select.querySelectorAll('option')) option.removeAttribute('selected')
    select.querySelector<HTMLOptionElement>('option[value="' + value + '"]')!.selected = true
    select.dispatchEvent(new window.Event('change', {bubbles: true, cancelable: true}))
  })
}

const engineChanges: BrowserSearchChoice[] = []
const searchDestinations: string[] = []
let engineSaveFailure = false
let delayedEngineSave: Promise<void> | null = null
let selectedSearchClosed = 0
function SearchChoiceHarness() {
  const [engine, setEngine] = React.useState<BrowserSearchChoice>('bing')
  return <BrowserSearchPanel current="" initialValue="" engine={engine} history={[]} pending={false} error=""
    onClose={() => {selectedSearchClosed++}} onCopy={() => {}} onOpen={async value => {
      searchDestinations.push(resolveBrowserAddress(value, engine) ?? '')
      return true
    }} onEngineChange={async next => {
      engineChanges.push(next)
      if (delayedEngineSave) await delayedEngineSave
      if (engineSaveFailure) return false
      setEngine(next)
      return true
    }}/>
}

try {
  await act(async () => root.render(<SearchChoiceHarness/>))
  await click(button('Google'))
  assert.deepEqual(engineChanges, ['google'], 'clicking a provider changes the selected engine')
  assert.equal(searchDestinations.length, 0, 'an empty query never opens the engine home page')
  assert.equal(selectedSearchClosed, 0, 'engine selection keeps the search panel open')
  assert.equal(button('Google').getAttribute('aria-checked'), 'true')
  await enterField('搜索或输入网址', '保留 query & 内容')
  await click(button('百度'))
  await click(button('Bing'))
  assert.equal(searchDestinations.length, 0, 'engine changes never submit a typed query')
  assert.equal((window.document.querySelector('input') as HTMLInputElement).value, '保留 query & 内容')
  engineSaveFailure = true
  await click(button('Google'))
  assert.equal(button('Bing').getAttribute('aria-checked'), 'true', 'failed persistence preserves the selected engine')
  assert.ok(window.document.body.textContent?.includes('搜索引擎未保存'))
  engineSaveFailure = false
  await click(button('AI'))
  await click(button('Perplexity'))
  assert.equal(searchDestinations.length, 0, 'other search providers use the same selection-only interaction')
  assert.equal(button('Perplexity').getAttribute('aria-checked'), 'true')
  await click(button('搜索或打开：保留 query & 内容'))
  assert.deepEqual(searchDestinations, ['https://www.perplexity.ai/search?q=' + encodeURIComponent('保留 query & 内容')])
  assert.equal(selectedSearchClosed, 1, 'only explicit submission closes the search panel')

  await act(async () => root.render(<SearchChoiceHarness key="pending-engine"/>))
  let finishEngineSave!: () => void
  delayedEngineSave = new Promise<void>(resolve => {finishEngineSave = resolve})
  await click(button('Google'))
  assert.equal(button('Bing').getAttribute('aria-checked'), 'true', 'pending saves do not publish the new choice')
  assert.ok(button('百度').hasAttribute('disabled'))
  await enterField('搜索或输入网址', '待保存的引擎')
  assert.ok(window.document.body.textContent?.includes('正在保存搜索引擎'), 'saving an engine does not claim to be opening a page')
  await click(button('搜索或打开：待保存的引擎'))
  assert.equal(searchDestinations.length, 1, 'submission waits for the selected engine to be saved')
  await act(async () => {finishEngineSave(); await delayedEngineSave})
  delayedEngineSave = null
  assert.equal(button('Google').getAttribute('aria-checked'), 'true')
  await pressKey(button('Google'), 'ArrowRight')
  assert.equal(button('百度').getAttribute('aria-checked'), 'true', 'radio keyboard navigation changes engines without opening a page')
  assert.equal(searchDestinations.length, 1)

  await act(async () => root.render(<BrowserPlacesPanel kind="history" {...placesProps} />))
  assert.equal(window.document.querySelectorAll('header button[aria-label="返回浏览器"]').length, 1)
  assert.equal(window.document.querySelectorAll('time').length, 2, '历史展示每条记录的真实访问时间')
  assert.equal(window.document.querySelectorAll('[data-date-group]').length, 2, '历史按日期分组')
  await click(button('打开：构建可读的网页'))
  assert.deepEqual(calls.opened, [entries[0].url])
  await click(button('更多操作：构建可读的网页'))
  assert.deepEqual(calls.options, [entries[0].url])
  assert.equal(calls.opened.length, 1, '更多入口不会打开网页')
  await click(button('删除：设计记录'))
  assert.deepEqual(calls.removed, [entries[1].url])
  await click(button('恢复首页隐藏的网站'))
  assert.equal(calls.restore, 1)
  await search('设计')
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  assert.ok(!window.document.body.textContent?.includes('构建可读的网页'), '按标题即时过滤')
  await search('MDN不存在')
  assert.ok(window.document.body.textContent?.includes('没有找到相关记录'))
  await search('DEVELOPER.MOZILLA')
  assert.ok(window.document.body.textContent?.includes('构建可读的网页'), '网址搜索不区分大小写')
  assert.ok(!window.document.body.textContent?.includes('设计记录'))
  await click(button('清空搜索'))
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  await click(button('清空浏览历史'))
  assert.equal(calls.clear, 1, '清空交由父级确认和执行')
  await click(button('返回浏览器'))
  assert.equal(calls.back, 1)
  await act(async () => root.render(<BrowserPlacesPanel key="bookmarks" kind="bookmarks" {...placesProps} />))
  assert.ok(!window.document.querySelector('button[aria-label^="更多操作："]'), '书签不混入历史选项')
  assert.ok(!window.document.querySelector('button[aria-label="恢复首页隐藏的网站"]'))
  await search('设计')
  assert.ok(window.document.body.textContent?.includes('设计记录'))
  assert.ok(!window.document.body.textContent?.includes('构建可读的网页'), '书签支持搜索')
  await click(button('删除：设计记录'))
  assert.equal(calls.removed.length, 2)
  await click(button('清空书签'))
  assert.equal(calls.clear, 2)

  // Explicitly saved private bookmarks have an independent disclosure gate.
  // Ordinary bookmarks remain visible; private entries cannot leak through search,
  // counts, favicons or rendered DOM until five consecutive title activations.
  const secret = [{url:'https://hidden.example/private/path?token=example',title:'私密收藏',time:now + 1}]
  let privateRemovals: string[] = []
  let privateClears = 0
  const privateProps = { ...placesProps, kind: 'bookmarks' as const, privateMode: true,
    privateEntries: secret, onPrivateRemove: (url: string) => {privateRemovals.push(url)},
    onPrivateClear: () => {privateClears++},
  }
  await act(async () => root.render(<BrowserPlacesPanel key="private-bookmarks" {...privateProps} />))
  const secretTitle = () => window.document.querySelector('section[aria-label="书签"] h2 button') as HTMLButtonElement | null
  assert.ok(secretTitle(), 'only private-mode bookmark headings accept the hidden tap gesture')
  assert.ok(window.document.body.textContent?.includes('构建可读的网页'), 'normal bookmarks remain visible in private mode')
  assert.ok(!window.document.body.textContent?.includes('私密收藏'), 'private item title is never visible before unlock')
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'locked bookmark URL never reaches the DOM')
  assert.ok(window.document.body.textContent?.includes('共 2 个书签'), 'locked counts exclude hidden entries')
  await search('hidden.example')
  assert.ok(window.document.body.textContent?.includes('没有找到相关记录'), 'locked search must not reveal private results')
  await click(button('清空搜索'))
  for (let i = 0; i < 4; i++) await click(secretTitle()!)
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'four title taps cannot reveal entries')
  await click(button('打开：构建可读的网页'))
  await click(secretTitle()!)
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'a different control interrupts the streak')
  for (let i = 0; i < 3; i++) await click(secretTitle()!)
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'))
  await click(secretTitle()!)
  assert.ok(button('打开：私密收藏'), 'five consecutive title taps reveal private bookmarks')
  assert.ok(window.document.body.textContent?.includes('隐私书签'), 'revealed items remain distinguished from normal')
  assert.ok(window.document.body.textContent?.includes('共 3 个书签'))
  for (let i = 0; i < 5; i++) await click(secretTitle()!)
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'another five taps hide the private section')
  for (let i = 0; i < 5; i++) await click(secretTitle()!)
  assert.ok(button('打开：私密收藏'), 'hidden bookmarks can be deliberately reopened')
  await search('hidden.example')
  assert.ok(button('打开：私密收藏'), 'only an unlocked collection can be searched')
  await click(button('清空搜索'))
  await click(button('删除：私密收藏'))
  assert.deepEqual(privateRemovals, [secret[0].url], 'private removal cannot use normal bookmark mutation')
  await click(button('清空隐私书签'))
  assert.equal(privateClears, 1, 'private bulk deletion is separate from normal clear')
  assert.equal(calls.clear, 2, 'normal bookmark clear is unaffected')
  await act(async () => root.render(<BrowserPlacesPanel key="private-bookmarks" {...privateProps} privateMode={false} />))
  assert.equal(secretTitle(), null, 'normal mode title is not an unlock control')
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'normal mode cannot see private bookmarks')
  await act(async () => root.render(<BrowserPlacesPanel key="private-bookmarks" {...privateProps} />))
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'switching mode on the same mounted panel resets temporary unlock')
  await act(async () => root.render(<BrowserPlacesPanel key="private-again" {...privateProps} />))
  assert.ok(!window.document.documentElement.outerHTML.includes('hidden.example'), 'reopening the page resets temporary unlock')

  await act(async () => root.render(<BrowserPlacesPanel key="empty-history" kind="history" {...placesProps} entries={[]} hiddenHostCount={0} />))
  assert.ok(window.document.body.textContent?.includes('暂无浏览历史'))
  assert.ok(!window.document.querySelector('button[aria-label="清空浏览历史"]'))
  await act(async () => root.render(<BrowserPlacesPanel key="empty-bookmarks" kind="bookmarks" {...placesProps} entries={[]} />))
  assert.ok(window.document.body.textContent?.includes('暂无书签'))

  await act(async () => root.render(<BrowserTabsPanel tabs={tabs} {...tabProps} />))
  assert.equal(window.document.querySelector('h2')?.textContent, '标签页')
  assert.equal(window.document.querySelectorAll('button[aria-current="page"]').length, 1)
  assert.ok(window.document.body.textContent?.includes('developer.mozilla.org'))
  await click(button('打开标签页：设计记录'))
  assert.deepEqual(calls.selected, [77])
  await click(button('关闭标签页：设计记录'))
  assert.deepEqual(calls.closed, [77])
  assert.deepEqual(calls.selected, [77], '关闭卡片不会触发切换')
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 1)
  const sixTabs = Array.from({ length: 6 }, (_, index) => ({
    ...tabs[0], index, id: index + 100, active: index === 0, title: `标签 ${index + 1}`,
  }))
  await act(async () => root.render(<BrowserTabsPanel tabs={sixTabs} {...tabProps} />))
  assert.ok(button('新建标签页').hasAttribute('disabled'))
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 1, '六标签上限不触发新建')
  assert.ok(window.document.body.textContent?.includes('最多同时打开 6 个标签页'))
  await act(async () => root.render(<BrowserTabsPanel tabs={tabs} {...tabProps} pending />))
  assert.ok(button('打开标签页：设计记录').hasAttribute('disabled'))
  assert.ok(button('关闭标签页：设计记录').hasAttribute('disabled'))
  assert.ok(button('新建标签页').hasAttribute('disabled'))
  await act(async () => root.render(<BrowserTabsPanel tabs={[]} {...tabProps} />))
  assert.ok(window.document.body.textContent?.includes('主页'), '没有原生标签时显示当前主页')
  assert.equal(window.document.querySelectorAll('button[aria-label^="关闭标签页："]').length, 0)
  await click(button('返回主页'))
  assert.equal(calls.back, 2)
  await click(button('新建标签页'))
  assert.equal(calls.newTab, 2, '主页仍可新建标签')

  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} />))
  assert.equal(window.document.querySelectorAll('[role="radio"]').length, 2)
  assert.equal(window.document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 1)
  assert.equal(window.document.querySelectorAll('select[aria-label="默认搜索引擎"] option').length, 11, 'all existing search providers are available as defaults')
  await chooseSearchDefault('google')
  assert.deepEqual(calls.engines, ['google'])
  const searchPickerButton = window.document.querySelector('#browser-default-search-button') as HTMLButtonElement | null
  assert.ok(searchPickerButton, '提供自定义应用内搜索引擎弹窗触发按钮')
  assert.equal(window.document.querySelectorAll('.browser-search-picker-sheet').length, 0, '未点击前不展示底部弹窗')
  await click(searchPickerButton)
  assert.equal(window.document.querySelectorAll('.browser-search-picker-sheet').length, 1, '点击打开自定义应用内底部弹窗')
  assert.equal(window.document.querySelectorAll('.browser-search-picker-item').length, 11, '底部弹窗提供全部 11 个搜索引擎')
  const duckduckgoButton = window.document.querySelector('button[role="option"][aria-selected="false"]') as HTMLButtonElement | null
  assert.ok(duckduckgoButton)
  await click(duckduckgoButton)
  assert.equal(window.document.querySelectorAll('.browser-search-picker-sheet').length, 0, '选中后自动关闭自定义弹层')
  await click(button('底部'))
  assert.deepEqual(calls.positions, [true])
  const desktop = window.document.querySelector('[role="switch"]')
  assert.ok(desktop)
  assert.equal(desktop.getAttribute('aria-label'), '桌面版网页')
  assert.ok(desktop.hasAttribute('disabled'))
  await click(desktop)
  assert.equal(calls.desktop, 0, '没有网页时禁用桌面模式')
  await click(button('清除浏览历史'))
  assert.equal(calls.clear, 3)
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} search="google" bottomAddress hasPage desktop />))
  assert.equal((window.document.querySelector('select[aria-label="默认搜索引擎"]') as HTMLSelectElement).value, 'google')
  assert.equal(button('底部').getAttribute('aria-checked'), 'true')
  const activeSwitch = window.document.querySelector('[role="switch"]')!
  assert.equal(activeSwitch.getAttribute('aria-checked'), 'true')
  await click(activeSwitch)
  assert.equal(calls.desktop, 1)
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} hasPage pending />))
  const pendingSwitch = window.document.querySelector('[role="switch"]')!
  assert.ok(pendingSwitch.hasAttribute('disabled'), '原生操作等待时禁用桌面模式')
  await click(pendingSwitch)
  assert.equal(calls.desktop, 1, '等待状态不会再次提交桌面模式切换')
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} historyCount={0} />))
  assert.ok(button('清除浏览历史').hasAttribute('disabled'))
  await click(button('清除浏览历史'))
  assert.equal(calls.clear, 3, '空历史没有可执行的清除操作')
  await act(async () => root.render(<FullSettingsHarness key="full-settings"/>))
  assert.equal(window.document.querySelectorAll('[role="radio"]').length, 6)
  assert.ok(button('Android'))
  assert.ok(button('iOS'))
  assert.equal(button('系统默认').getAttribute('aria-checked'), 'true')
  assert.ok(!window.document.querySelector('[aria-label="清除当前站点数据"]'), 'unsupported site-data clearing has no inert control')
  await click(button('自定义'))
  assert.equal(button('系统默认').getAttribute('aria-checked'), 'true', 'opening the custom editor does not publish an unsaved mode')
  await enterField('自定义浏览器标识', 'Mozilla/5.0' + String.fromCharCode(10) + 'Unexpected: header')
  await act(async () => {
    window.document.querySelector('.browser-user-agent-editor')!.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}))
  })
  assert.equal(preferenceWriteCount, 0, 'invalid UA never reaches persistence')
  assert.equal(window.document.querySelector('textarea')?.getAttribute('aria-invalid'), 'true')
  const customAgent = 'Mozilla/5.0 (X11; Linux x86_64) NewsNookPanelTest/1.0'
  await enterField('自定义浏览器标识', customAgent)
  preferenceWriteFailure = true
  await act(async () => {
    window.document.querySelector('.browser-user-agent-editor')!.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}))
  })
  assert.equal(button('系统默认').getAttribute('aria-checked'), 'true')
  assert.equal((window.document.querySelector('textarea') as HTMLTextAreaElement).value, customAgent, 'failed saves retain the UA draft')
  assert.ok(window.document.body.textContent?.includes('保存失败'), 'failed persistence is visible')
  assert.equal(preferenceStorage.has(BROWSER_KEYS.preferences), false)
  preferenceWriteFailure = false
  await act(async () => {
    window.document.querySelector('.browser-user-agent-editor')!.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}))
  })
  assert.equal(button('自定义').getAttribute('aria-checked'), 'true')
  assert.equal(loadBrowserPreferences().customUserAgent, customAgent)
  await act(async () => root.render(<FullSettingsHarness key="reopened-settings"/>))
  assert.equal(button('自定义').getAttribute('aria-checked'), 'true', 'reopening reads the saved UA mode')
  assert.equal((window.document.querySelector('textarea') as HTMLTextAreaElement).value, customAgent)
  await click(button('桌面版网页'))
  assert.equal(loadBrowserPreferences().userAgentMode, 'desktop')
  assert.equal(loadBrowserPreferences().lastNonDesktopUserAgentMode, 'custom')
  assert.ok(button('自定义').hasAttribute('disabled'), 'desktop mode identifies the active desktop profile instead of silently applying a mobile identity')
  await act(async () => root.render(<FullSettingsHarness key="reopened-desktop"/>))
  await click(button('桌面版网页'))
  assert.equal(loadBrowserPreferences().userAgentMode, 'custom', 'turning desktop off after reopening restores the saved custom identity')
  assert.equal(loadBrowserPreferences().customUserAgent, customAgent)
  for (const [label, mode] of [['Android', 'android'], ['iOS', 'ios']] as const) {
    await click(button(label))
    assert.equal(loadBrowserPreferences().userAgentMode, mode)
    assert.equal(loadBrowserPreferences().lastNonDesktopUserAgentMode, mode)
  }
  assert.ok(window.document.body.textContent?.includes('iPhone 兼容标识'))
  await click(button('自定义'))
  await click(button('隐私浏览'))
  assert.equal(loadBrowserPreferences().privateMode, true)
  assert.equal(button('隐私浏览').getAttribute('aria-checked'), 'true')
  assert.ok(window.document.body.textContent?.includes('开启后不保存搜索和浏览记录'))
  await click(button('隐私浏览'))
  assert.equal(loadBrowserPreferences().privateMode, false)
  preferenceWriteFailure = true
  await click(button('隐私浏览'))
  assert.equal(button('隐私浏览').getAttribute('aria-checked'), 'false', 'failed privacy saves do not publish an enabled state')
  assert.equal(loadBrowserPreferences().privateMode, false)
  preferenceWriteFailure = false
  await click(button('第三方 Cookie'))
  assert.equal(loadBrowserPreferences().thirdPartyCookiesEnabled, true)
  assert.equal(button('第三方 Cookie').getAttribute('aria-checked'), 'true')

  let finishSave!: () => void
  delayedPreferenceSave = new Promise<void>(resolve => {finishSave = resolve})
  await click(button('放大网页文字'))
  assert.equal(loadBrowserPreferences().textZoom, 100, 'in-flight changes leave the stored value intact')
  assert.equal(window.document.querySelector('output')?.textContent, '100%', 'in-flight values are not published to the UI')
  assert.ok(button('JavaScript').hasAttribute('disabled'))
  assert.ok(window.document.querySelector('textarea')?.hasAttribute('disabled'), 'pending saves cannot replace a newer UA draft')
  assert.ok(window.document.querySelector('select[aria-label="默认搜索引擎"]')?.hasAttribute('disabled'), 'other settings cannot race the pending write')
  const writesBeforeDisabled = preferenceWriteCount
  await click(button('JavaScript'))
  assert.equal(preferenceWriteCount, writesBeforeDisabled)
  await act(async () => {finishSave(); await delayedPreferenceSave})
  delayedPreferenceSave = null
  assert.equal(loadBrowserPreferences().textZoom, 110)
  assert.equal(window.document.querySelector('output')?.textContent, '110%')
  await act(async () => root.render(<FullSettingsHarness key="reopened-zoom"/>))
  assert.equal(window.document.querySelector('output')?.textContent, '110%')
  await click(button('恢复默认文字大小'))
  assert.equal(loadBrowserPreferences().textZoom, 100)

  await act(async () => root.render(<BrowserPlacesPanel key="private-history" kind="history" {...placesProps} privateMode/>))
  assert.ok(window.document.body.textContent?.includes(entries[0].title), 'privacy pauses recording without hiding explicit access to prior history')
  assert.ok(window.document.querySelector('[aria-label="清空浏览历史"]'))
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} privateMode/>))
  assert.ok(!button('清除浏览历史').hasAttribute('disabled'))
  assert.ok(window.document.body.textContent?.includes('2 条记录'), 'prior records can still be managed while recording is paused')

  await act(async () => root.render(<BrowserStartPage privateMode shortcuts={[{name:'MDN', url:entries[0].url}]} recent={entries}
    onSearch={() => {}} onOpen={() => {}} onAddShortcut={() => {}} onShortcutOptions={() => {}}
    onHistoryOptions={() => {}} onPanel={() => {}}/>))
  assert.ok(window.document.body.textContent?.includes('隐私浏览'))
  assert.ok(!window.document.body.textContent?.includes('最近访问'))
  assert.ok(!window.document.body.textContent?.includes(entries[0].title))
  assert.ok(window.document.querySelector('[aria-label="添加快捷方式"]'))
  for (const label of ['历史', '书签', '用户脚本']) assert.ok(button(label), 'privacy keeps explicit browser tools available')
  assert.equal(window.document.querySelectorAll('img[src^="https:"]').length, 0, 'private start does not fetch favicons')

  // Normal start page recent-visit eye visibility toggle & persistence
  let normalHideRecent = false
  const renderNormalStart = async () => {
    await act(async () => root.render(<BrowserStartPage
      shortcuts={[{name:'GitHub', url:'https://github.com/'}]}
      recent={entries}
      hideRecent={normalHideRecent}
      onToggleHideRecent={() => { normalHideRecent = !normalHideRecent }}
      onSearch={() => {}} onOpen={() => {}} onAddShortcut={() => {}} onShortcutOptions={() => {}}
      onHistoryOptions={() => {}} onPanel={() => {}}/>))
  }
  await renderNormalStart()
  assert.ok(window.document.body.textContent?.includes('最近访问'))
  assert.ok(window.document.body.textContent?.includes(entries[0].title), 'recent visits are visible by default')
  const eyeBtn = window.document.querySelector('button[aria-label="隐藏最近访问"]') as HTMLButtonElement
  assert.ok(eyeBtn, 'eye toggle button is rendered beside recent visits title')
  await click(eyeBtn)
  await renderNormalStart()
  assert.ok(!window.document.body.textContent?.includes(entries[0].title), 'recent visits are hidden after eye click')
  assert.ok(window.document.querySelector('button[aria-label="显示最近访问"]'), 'eye button toggles label to show recent visits')
  const collapsedCard = window.document.querySelector('button.browser-recent-collapsed') as HTMLButtonElement
  assert.ok(collapsedCard, 'collapsed placeholder card is rendered when recent visits are hidden')
  await click(collapsedCard)
  await renderNormalStart()
  assert.ok(window.document.body.textContent?.includes(entries[0].title), 'recent visits are restored when clicking collapsed card')

  let searchClosed = 0
  await act(async () => root.render(<BrowserSearchPanel current="" initialValue="" engine="bing" history={entries}
    privateMode pending={false} error="" onClose={() => {searchClosed++}}
    onOpen={async () => {throw new Error('网页暂时无法打开')}} onCopy={() => {}} onEngineChange={() => true}/>))
  assert.ok(!window.document.body.textContent?.includes(entries[0].title))
  assert.equal(window.document.querySelectorAll('img[src^="https:"]').length, 0, 'private provider choices do not fetch favicons')
  await pressKey(button('常用'), 'ArrowLeft')
  assert.equal(button('学术').getAttribute('aria-selected'), 'true', 'search category tabs support wrapping keyboard navigation')
  await enterField('搜索或输入网址', 'preserve this search')
  await click(button('搜索或打开：preserve this search'))
  assert.equal(searchClosed, 0)
  assert.equal((window.document.querySelector('input') as HTMLInputElement).value, 'preserve this search')
  assert.ok(window.document.body.textContent?.includes('网页暂时无法打开'), 'rejected navigation retains the draft and shows the failure')

  let copiedUrl = ''
  await act(async () => root.render(<BrowserSearchPanel
    key="active-url"
    current="https://www.google.com/search?q=423423"
    initialValue="https://www.google.com/search?q=423423"
    engine="google" history={entries} pending={false} error=""
    onClose={() => {}} onOpen={async () => true} onCopy={url => {copiedUrl = url}} onEngineChange={() => true}/>))
  assert.equal((window.document.querySelector('input[aria-label="搜索或输入网址"]') as HTMLInputElement).value, 'https://www.google.com/search?q=423423', 'active url pre-fills address input for immediate editing')
  assert.ok(window.document.querySelector('button[aria-label="编辑当前网址"]'), 'provides explicit edit button for current url')
  await click(button('复制当前网址'))
  assert.equal(copiedUrl, 'https://www.google.com/search?q=423423', 'copy button copies current url')
  await enterField('搜索或输入网址', 'new search query')
  assert.equal((window.document.querySelector('input[aria-label="搜索或输入网址"]') as HTMLInputElement).value, 'new search query')
  await click(button('编辑当前网址'))
  assert.equal((window.document.querySelector('input[aria-label="搜索或输入网址"]') as HTMLInputElement).value, 'https://www.google.com/search?q=423423', 'edit button re-fills current url into input')

  console.log('browser product panels: selection-only search, preserved query, provider defaults, saved UA/desktop/privacy, failure recovery, pending races and explicit history access OK')
} finally {
  await act(async () => root.unmount())
}
