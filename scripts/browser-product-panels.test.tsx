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
const { BROWSER_KEYS, loadBrowserPreferences, saveBrowserPreferences } = await import('../src/features/browser/browserPreferences')
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

try {
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
  assert.equal(window.document.querySelectorAll('[role="radio"]').length, 6)
  assert.equal(window.document.querySelectorAll('[role="radio"][aria-checked="true"]').length, 2)
  await click(button('Google'))
  assert.deepEqual(calls.engines, ['google'])
  await pressKey(button('Bing'), 'ArrowLeft')
  assert.equal(calls.engines.at(-1), 'duckduckgo', '方向键循环选择搜索引擎')
  await pressKey(button('Google'), 'Home')
  assert.equal(calls.engines.at(-1), 'duckduckgo', '已选首项不重复写入')
  await pressKey(button('Bing'), 'End')
  assert.equal(calls.engines.at(-1), 'duckduckgo', 'End 键选择最后的搜索引擎')
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
  assert.equal(button('Google').getAttribute('aria-checked'), 'true')
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
  assert.equal(window.document.querySelectorAll('[role="radio"]').length, 9)
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
  assert.ok(button('Google').hasAttribute('disabled'), 'other settings cannot race the pending write')
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
  assert.ok(!window.document.body.textContent?.includes(entries[0].title), 'private places do not expose ordinary history')
  assert.ok(!window.document.querySelector('[aria-label="清空浏览历史"]'))
  assert.ok(!window.document.querySelector('[aria-label="恢复首页隐藏的网站"]'))
  await act(async () => root.render(<BrowserSettingsPanel {...settingsProps} privateMode/>))
  assert.ok(button('清除浏览历史').hasAttribute('disabled'))
  assert.ok(!window.document.body.textContent?.includes('2 条记录'), 'private settings do not reveal the ordinary history count')

  await act(async () => root.render(<BrowserStartPage privateMode shortcuts={[{name:'MDN', url:entries[0].url}]} recent={entries}
    onSearch={() => {}} onOpen={() => {}} onAddShortcut={() => {}} onShortcutOptions={() => {}}
    onHistoryOptions={() => {}} onPanel={() => {}}/>))
  assert.ok(window.document.body.textContent?.includes('隐私浏览'))
  assert.ok(!window.document.body.textContent?.includes('最近访问'))
  assert.ok(!window.document.body.textContent?.includes(entries[0].title))
  assert.ok(!window.document.querySelector('[aria-label="添加快捷方式"]'))
  assert.ok(![...window.document.querySelectorAll('button')].some(item => ['历史', '书签', '用户脚本', '管理'].includes(item.textContent?.trim() ?? '')))
  assert.equal(window.document.querySelectorAll('img[src^="https:"]').length, 0, 'private start does not fetch favicons')

  let searchClosed = 0
  await act(async () => root.render(<BrowserSearchPanel current="" initialValue="" engine="bing" history={entries}
    privateMode pending={false} error="" onClose={() => {searchClosed++}}
    onOpen={async () => {throw new Error('网页暂时无法打开')}} onCopy={() => {}}/>))
  assert.ok(!window.document.body.textContent?.includes(entries[0].title))
  assert.equal(window.document.querySelectorAll('img[src^="https:"]').length, 0, 'private provider choices do not fetch favicons')
  await pressKey(button('常用'), 'ArrowLeft')
  assert.equal(button('学术').getAttribute('aria-selected'), 'true', 'search category tabs support wrapping keyboard navigation')
  await enterField('搜索或输入网址', 'preserve this search')
  await click(button('搜索或打开：preserve this search'))
  assert.equal(searchClosed, 0)
  assert.equal((window.document.querySelector('input') as HTMLInputElement).value, 'preserve this search')
  assert.ok(window.document.body.textContent?.includes('网页暂时无法打开'), 'rejected navigation retains the draft and shows the failure')
  console.log('browser product panels: existing controls, saved settings round-trip, invalid UA, save failures, pending races, private history/favicon isolation and search recovery OK')
} finally {
  await act(async () => root.unmount())
}
