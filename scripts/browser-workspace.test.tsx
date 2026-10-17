import assert from 'node:assert/strict'
import { mock } from 'node:test'
import React, { act, useState } from 'react'
import { parseHTML } from 'linkedom'
import type { BrowserRecoverySession, BrowserState, BrowserTab } from '../src/features/browser/useBrowserSession'
import type { MediaResourceDescriptor } from '../src/features/mediaSniffer/types'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const document = window.document
Object.defineProperty(document, 'oninput', { configurable: true, value: null })
// LinkeDOM reports an empty type for <input>; browsers expose the default "text".
const inputType = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'type')!
Object.defineProperty(window.HTMLInputElement.prototype, 'type', {
  configurable: true,
  get() { return inputType.get!.call(this) || 'text' },
  set(value: string) { inputType.set!.call(this, value) },
})
Object.assign(globalThis, {
  window, document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: clearTimeout, getComputedStyle: () => ({ getPropertyValue: () => '' }),
})
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
const storage = new Map<string, string>()
let failedStorageKey: string | null = null
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === failedStorageKey) throw new Error('Storage unavailable')
    storage.set(key, String(value))
  },
  removeItem: (key: string) => storage.delete(key),
} })
const HISTORY = 'newsnook:browser:history:v1'
const MARKS = 'newsnook:browser:bookmarks:v1'
const SHORTCUTS = 'newsnook:browser:shortcuts:v1'
const listeners = new Map<string, (event: any) => void>()
const blank = (): BrowserState => ({ url: null, back: false, forward: false, desktop: false, error: null })
let current = blank()
let tabList: (BrowserTab & { desktop?: boolean })[] = []
let nativeGeneration = 0
let nextTabId = 1
let exits = 0
let fixture = 0
type Bounds = { top: number; bottom: number; visible: boolean }
type OpenCall = Bounds & { url: string; embedded: boolean; recoverySession?: BrowserRecoverySession; scripts: unknown[]; palette: Record<string, string> }
const openCalls: OpenCall[] = []
const bounds: Bounds[] = []
const commands: { action: string; url?: string }[] = []
let closeCalls = 0
const appliedSettings: Record<string, unknown>[] = []
let privateLaunches = 0
const findCalls: string[] = []
const clearedSites: string[] = []
let scanGate: ReturnType<typeof deferred> | null = null
const imageCancels: unknown[] = []

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
let nextOpen: ReturnType<typeof deferred> | null = null
let nextNavigation: ReturnType<typeof deferred> | null = null
let nextTabChange: ReturnType<typeof deferred> | null = null
let nextRecoveryRead: ReturnType<typeof deferred> | null = null
let recoverySnapshot: BrowserRecoverySession | null = null
let recoveryReads = 0
const RECOVERY_ERROR = '网页进程已恢复，请重新加载此页'
const titleFor = (url: string) => url === 'about:blank' ? '主页' : new URL(url).hostname === 'linux.do' ? 'Linux.do' : new URL(url).hostname
const emitNavigation = (phase: string) => listeners.get('navigation')?.({ ...current, phase })
function createTab(url: string) {
  for (const tab of tabList) tab.active = false
  const tab: BrowserTab = { index: tabList.length, id: nextTabId++, title: titleFor(url), url, active: true, loading: false }
  tabList.push(tab)
  current = { ...blank(), url, tabId: tab.id, title: tab.title, loading: false, progress: 100 }
}
function changeUrl(url: string, loading = false) {
  const tab = tabList.find(item => item.id === current.tabId)
  assert.ok(tab, 'native adapter requires an open tab')
  const back = current.url !== 'about:blank' && current.url !== url
  tab.url = url
  tab.title = titleFor(url)
  tab.loading = loading
  current = { ...current, url, title: tab.title, back, loading, progress: loading ? 10 : 100, error: null }
  emitNavigation(loading ? 'start' : 'end')
}

// Only the native bridge and video decoder are substituted. Browser controls, state and persistence remain real.
const native = {
  addListener: async (name: string, callback: (event: any) => void) => {
    listeners.set(name, callback)
    return { remove: async () => { if (listeners.get(name) === callback) listeners.delete(name) } }
  },
  takeRecoverySession: async () => {
    recoveryReads++
    const session = recoverySnapshot
    recoverySnapshot = null
    const gate = nextRecoveryRead
    nextRecoveryRead = null
    if (gate) await gate.promise
    return { session }
  },
  open: async (args: OpenCall) => {
    openCalls.push({ ...args })
    const generation = nativeGeneration
    if (args.recoverySession) {
      tabList = args.recoverySession.tabs.map((tab, index) => ({ ...tab, index, id: nextTabId++,
        active: index === args.recoverySession!.activeIndex, loading: false, error: RECOVERY_ERROR }))
      const active = tabList[args.recoverySession.activeIndex]
      current = { ...blank(), url: active.url, title: active.title, desktop: active.desktop ?? false,
        tabId: active.id, loading: false, progress: 0, error: RECOVERY_ERROR }
      emitNavigation('state')
    } else {
      createTab(args.url)
      current = { ...current, loading: true }
      emitNavigation('start')
    }
    const gate = nextOpen
    nextOpen = null
    if (gate) await gate.promise
    // A late bridge acknowledgement may arrive after close; it cannot recreate the native host.
    if (generation !== nativeGeneration) return
    if (!args.recoverySession) changeUrl(args.url)
  },
  state: async () => ({ ...current }),
  tabs: async () => ({ tabs: tabList.map(tab => ({ ...tab })) }),
  setBounds: async (value: Bounds) => { bounds.push({ ...value }) },
  navigate: async (command: { action: string; url?: string }) => {
    commands.push({ ...command })
    if (command.action === 'downloads') return
    if (command.action === 'new') {
      const gate = nextTabChange
      nextTabChange = null
      createTab('about:blank')
      emitNavigation('end')
      if (gate) await gate.promise
      return
    }
    if (command.action === 'url') {
      const generation = nativeGeneration
      const gate = nextNavigation
      nextNavigation = null
      changeUrl(command.url!, true)
      if (gate) await gate.promise
      if (generation !== nativeGeneration) return
      changeUrl(command.url!)
      return
    }
    if (command.action === 'home') changeUrl('about:blank')
    if (command.action === 'reload') {
      const tab = tabList.find(item => item.id === current.tabId)
      if (tab) { tab.error = undefined; tab.loading = false }
      current = { ...current, loading: false, error: null }
      emitNavigation('end')
    }
    if (command.action === 'stop') { current = { ...current, loading: false }; emitNavigation('state') }
    if (command.action === 'desktop') { current = { ...current, desktop: !current.desktop }; emitNavigation('end') }
  },
  activateTab: async ({ index }: { index: number }) => {
    const gate = nextTabChange
    nextTabChange = null
    const target = tabList[index]
    assert.ok(target)
    for (const tab of tabList) tab.active = tab === target
    current = { ...blank(), url: target.url, title: target.title, tabId: target.id,
      desktop: target.desktop ?? false, loading: target.loading, error: target.error ?? null }
    emitNavigation('state')
    if (gate) await gate.promise
  },
  removeTab: async ({ index }: { index: number }) => {
    tabList.splice(index, 1)
    tabList.forEach((tab, position) => { tab.index = position })
    if (!tabList.length) { current = blank(); listeners.get('closed')?.({}); return }
    const target = tabList.find(tab => tab.active) ?? tabList[0]
    await native.activateTab({ index: target.index })
  },
  close: async () => {
    closeCalls++
    nativeGeneration++
    current = blank()
    tabList = []
    listeners.get('closed')?.({})
  },
  updateScripts: async () => {},
  getBrowserContext: async () => ({privateMode: false, privacyCapabilities: {privateMode: true, clearSiteData: true, sharedSiteData: true}}),
  updateSettings: async ({settings}: {settings: Record<string, unknown>}) => {appliedSettings.push({...settings})},
  openPrivate: async () => {privateLaunches++},
  closePrivate: async () => {},
  findInPage: async ({query}: {query: string}) => {findCalls.push(query); listeners.get('findResult')?.({tabId:current.tabId, activeMatch:0, count:query ? 2 : 0, done:true})},
  findNext: async () => {},
  clearFind: async () => {findCalls.push('')},
  clearSiteData: async ({url}: {url: string}) => {clearedSites.push(url)},
  scanImages: async (request: {tabId:number;requestId:string}) => {
    const pageUrl = current.url!
    const gate = scanGate
    scanGate = null
    if (gate) await gate.promise
    return {...request, documentId:'test-document', pageUrl, items:[], truncated:false, inaccessibleFrames:0}
  },
  cancelImageRequests: async (request: unknown) => {imageCancels.push(request)},
}
mock.module('@capacitor/core', { namedExports: {
  WebPlugin: class {}, CapacitorHttp: {}, Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  SystemBars: { setStyle: async () => {} }, SystemBarsStyle: { Light: 'LIGHT', Dark: 'DARK' },
  registerPlugin: () => native,
} })
mock.module('../src/components/InkVideoPlayer.tsx', { namedExports: {
  InkVideoPlayer: ({ src, title, resources }: { src: string; title: string; resources: MediaResourceDescriptor[] }) =>
    <div data-test-player data-src={src} data-title={title} data-resources={JSON.stringify(resources.map(resource => resource.url))}/>,
} })
const { createRoot } = await import('react-dom/client')
const { BrowserWorkspace } = await import('../src/features/browser/BrowserWorkspace')
const { BrowserLauncher } = await import('../src/features/browser/BrowserLauncher')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const root = createRoot(document.getElementById('root')!)
function Harness({ recoverySession, privateMode = false }: { recoverySession?: BrowserRecoverySession; privateMode?: boolean }) {
  const [open, setOpen] = useState(true)
  return open ? <BrowserWorkspace recoverySession={recoverySession} privateContext={privateMode ? {privateMode: true, scripts: []} : undefined} onExit={() => { exits++; setOpen(false) }}/> : <div data-reader>有所闻</div>
}
async function mount(preserveStorage = false, recoverySession?: BrowserRecoverySession, strict = false, privateMode = false) {
  await act(async () => root.render(null))
  if (!preserveStorage) {
    storage.clear()
    storage.set(SHORTCUTS, JSON.stringify([{ name: 'Linux.do', url: 'https://linux.do/' }]))
  }
  failedStorageKey = null
  current = blank()
  tabList = []
  nextTabId = 1
  nextOpen = null
  nextNavigation = null
  nextTabChange = null
  openCalls.length = 0
  bounds.length = 0
  commands.length = 0
  closeCalls = 0
  exits = 0
  const content = <Harness key={++fixture} recoverySession={recoverySession} privateMode={privateMode}/>
  await act(async () => root.render(strict ? <React.StrictMode>{content}</React.StrictMode> : content))
}
const select = (selector: string): Element => {
  const result = document.querySelector(selector)
  assert.ok(result, 'Missing ' + selector)
  return result
}
const button = (label: string, scope: ParentNode = document): Element => {
  const result = [...scope.querySelectorAll('button')].find(control => {
    const text = control.textContent?.trim() ?? ''
    return control.getAttribute('aria-label') === label || text === label
      || (text.endsWith(label) && /^\d+$/.test(text.slice(0, -label.length)))
  })
  assert.ok(result, 'Missing action: ' + label)
  return result
}
async function click(control: Element) {
  await act(async () => { control.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true })) })
}
async function enter(label: string, value: string) {
  const input = select('input[aria-label="' + label + '"]') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }))
    input.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }))
  })
}
async function submit(scope = '[aria-label="搜索与地址"]') {
  const form = select(scope + ' form')
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
}
async function back() {
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true, 'visible browser layer handles back') })
}
async function escape() {
  await act(async () => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'key', { value: 'Escape' })
    window.dispatchEvent(event)
  })
}
async function menu(label: string) {
  await click(button('网页工具'))
  await click(button(label, select('[role="dialog"][aria-label="网页工具"]')))
}
async function visit(url = 'https://linux.do/') {
  await click(button('搜索或输入网址'))
  await enter('搜索或输入网址', url)
  await submit()
  assert.equal(current.url, url)
}
async function observe(tabId: number, pageUrl: string, url: string) {
  await act(async () => {
    listeners.get('mediaEvent')?.({ tabId, type: 'page', pageUrl })
    listeners.get('mediaEvent')?.({ tabId, type: 'observation', observation: {
      source: 'network', pageUrl, url, mimeType: 'video/mp4', mediaKind: 'video', timestamp: Date.now(),
    } })
  })
}
async function playFirst() {
  await menu('媒体资源')
  const play = select('[role="dialog"][aria-label="媒体资源"] button[aria-label^="播放 "]')
  await click(play)
  return select('[data-test-player]')
}

try {
  for (let iteration = 1; iteration <= 3; iteration++) {
    await mount()
    await click(button('Linux.do'))
    assert.equal(current.url, 'https://linux.do/', 'shortcut opens the actual page')
    assert.equal(openCalls[0].visible, false, 'new native hosts start hidden until their React bounds are committed')
    assert.equal(bounds.at(-1)?.visible, true)
    const originalTab = current.tabId
    await click(button('搜索或输入网址'))
    assert.equal(bounds.at(-1)?.visible, false, 'search hides native input interception')
    await back()
    assert.equal(document.querySelector('[aria-label="搜索与地址"]'), null)
    assert.equal(current.tabId, originalTab, 'dismissing search restores the same tab')
    assert.equal(exits, 0)
    assert.equal(bounds.at(-1)?.visible, true)

    await menu('浏览历史')
    await click(button('清空浏览历史'))
    assert.ok(document.querySelector('[role="dialog"][aria-label="清空浏览历史"]'))
    const commandCount = commands.length
    await back()
    assert.equal(document.querySelector('[role="dialog"][aria-label="清空浏览历史"]'), null, 'back dismisses only the top confirmation')
    assert.ok(document.querySelector('[aria-label="浏览历史"]'), 'history remains under its confirmation')
    assert.equal(commands.length, commandCount, 'confirmation back cannot navigate the webpage')
    assert.equal(bounds.at(-1)?.visible, false)
    await back()
    assert.equal(bounds.at(-1)?.visible, true)
    assert.equal(JSON.parse(storage.get(HISTORY)!).length, 1, 'canceling a clear preserves history')

    await mount()
    await click(button('Linux.do'))
    await menu('用户脚本')
    const scriptSource = '// ==UserScript==\n// @name Escape draft\n// @match https://linux.do/*\n// ==/UserScript==\nvoid 0'
    const scriptFile = select('[aria-label="用户脚本管理"] input[type="file"]')
    Object.defineProperty(scriptFile, 'files', { configurable: true, value: [new File([scriptSource], 'escape.user.js')] })
    await act(async () => { scriptFile.dispatchEvent(new window.Event('change', { bubbles: true })) })
    await click(button('检查并安装'))
    assert.ok(document.querySelector('[role="dialog"][aria-label="脚本权限确认"]'))
    await escape()
    assert.equal(document.querySelector('[role="dialog"][aria-label="脚本权限确认"]'), null, 'Escape dismisses only script permission confirmation')
    assert.ok(document.querySelector('[role="dialog"][aria-label="用户脚本管理"]'), 'one Escape cannot reach the workspace listener and close the script manager')
    assert.equal((select('#userscript-source') as HTMLTextAreaElement).value, scriptSource, 'Escape preserves the script draft')
    assert.equal(exits, 0)
    assert.equal(bounds.at(-1)?.visible, false)
    await escape()
    assert.equal(document.querySelector('[role="dialog"][aria-label="用户脚本管理"]'), null)
    assert.equal(bounds.at(-1)?.visible, true, 'a second Escape restores the same webpage')
    assert.equal(current.url, 'https://linux.do/')

    await mount()
    await menu('下载管理')
    assert.equal(commands.filter(command => command.action === 'downloads').length, 1, 'downloads work before any webpage is opened')
    assert.equal(openCalls.length, 0, 'downloads do not create a spare browser tab')
    await menu('新建标签')
    assert.equal(openCalls.length, 1)
    assert.equal(openCalls[0].url, 'about:blank', 'cold-start new tab creates a blank native tab')
    assert.equal(tabList.length, 1)
    assert.equal(bounds.at(-1)?.visible, false, 'the native blank page cannot cover the React start page')
    assert.ok(document.querySelector('.browser-start'))
    const blankTab = current.tabId
    await click(button('Linux.do'))
    assert.equal(current.tabId, blankTab, 'the first URL reuses the blank tab')
    assert.equal(openCalls.length, 1)
    assert.equal(commands.filter(command => command.action === 'url').length, 1)

    await mount()
    // Preparing a first page's @require dependencies may keep native open unresolved.
    const slowScriptOpen = deferred()
    let openAcknowledged = false
    void slowScriptOpen.promise.then(() => { openAcknowledged = true })
    nextOpen = slowScriptOpen
    await click(button('Linux.do'))
    assert.equal(openCalls.length, 1)
    assert.equal(current.loading, true)
    assert.ok(document.querySelector('[role="progressbar"][aria-label="网页加载进度"]'))
    const stopLoading = button('停止加载') as HTMLButtonElement
    assert.equal(stopLoading.disabled, false, 'a pending first open must leave cancellation available')
    await click(stopLoading)
    assert.equal(openAcknowledged, false, 'the open acknowledgement remains pending during cancellation')
    assert.equal(commands.filter(command => command.action === 'stop').length, 1, 'stop reaches the native host before open completes')
    assert.equal(current.loading, false)
    assert.equal(document.querySelector('[role="progressbar"][aria-label="网页加载进度"]'), null, 'stopping refreshes the loading state immediately')
    await act(async () => slowScriptOpen.resolve())
    assert.equal(openCalls.length, 1, 'cancellation does not create another native page')

    await mount()
    const returningDuringOpen = deferred()
    let returningOpenAcknowledged = false
    void returningDuringOpen.promise.then(() => { returningOpenAcknowledged = true })
    nextOpen = returningDuringOpen
    await click(button('Linux.do'))
    assert.equal(current.url, 'https://linux.do/', 'the pending first open has already published its page address')
    assert.equal(current.loading, true)
    await back()
    assert.equal(returningOpenAcknowledged, false, 'hardware Back does not wait for script preparation or the first native open acknowledgement')
    assert.equal(exits, 1, 'hardware Back exits when the first native open is not ready')
    assert.equal(closeCalls, 1, 'hardware Back immediately closes the pending native host')
    assert.ok(document.querySelector('[data-reader]'))
    const boundsBeforeLateBackOpen = bounds.length
    await act(async () => returningDuringOpen.resolve())
    assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null, 'a canceled first open cannot restore the browser after hardware Back')
    assert.ok(document.querySelector('[data-reader]'))
    assert.equal(exits, 1, 'the late acknowledgement cannot trigger a second exit')
    assert.equal(bounds.length, boundsBeforeLateBackOpen, 'a canceled first open cannot publish visible native bounds')

    await mount()
    const firstOpen = deferred()
    nextOpen = firstOpen
    await click(button('搜索或输入网址'))
    await click(button('Bing'))
    assert.equal(openCalls[0].visible, false, 'pending initial opens never raise native content over the search panel')
    await click(button('取消', select('[aria-label="搜索与地址"]')))
    await click(button('网页工具'))
    await act(async () => firstOpen.resolve())
    assert.ok(document.querySelector('[role="dialog"][aria-label="网页工具"]'), 'finishing an old open cannot dismiss a later menu')
    assert.equal(bounds.at(-1)?.visible, false)
    await back()
    assert.equal(bounds.at(-1)?.visible, true)

    await mount()
    await click(button('Linux.do'))
    const openingA = deferred()
    nextNavigation = openingA
    await click(button('搜索或输入网址'))
    await enter('搜索或输入网址', 'https://example.com/a')
    await submit()
    const submittedCount = commands.filter(command => command.action === 'url').length
    assert.equal(submittedCount, 1)
    await submit()
    assert.equal(commands.filter(command => command.action === 'url').length, 1, 'Enter cannot enqueue a duplicate while pending')
    await click(button('取消', select('[aria-label="搜索与地址"]')))
    await click(button('搜索或输入网址'))
    await enter('搜索或输入网址', 'new draft B')
    await act(async () => openingA.resolve())
    assert.ok(document.querySelector('[aria-label="搜索与地址"]'), 'an unmounted submit cannot close the newly opened search panel')
    assert.equal((select('input[aria-label="搜索或输入网址"]') as HTMLInputElement).value, 'new draft B')
    assert.equal(bounds.at(-1)?.visible, false)
    await back()
    assert.equal(bounds.at(-1)?.visible, true)

    const openingC = deferred()
    nextNavigation = openingC
    await click(button('搜索或输入网址'))
    await enter('搜索或输入网址', 'https://example.com/c')
    await submit()
    await enter('搜索或输入网址', 'keep edited draft')
    await act(async () => openingC.resolve())
    assert.ok(document.querySelector('[aria-label="搜索与地址"]'), 'a submitted draft cannot dismiss later edits in the same panel')
    assert.equal((select('input[aria-label="搜索或输入网址"]') as HTMLInputElement).value, 'keep edited draft')

    await mount()
    await click(button('Linux.do'))
    const tabBeforeSwitch = current.tabId!
    await click(button('标签页'))
    await click(button('新建标签页'))
    await visit('https://other.example/watch')
    await observe(current.tabId!, current.url!, 'https://media.example.com/switching.mp4')
    await playFirst()
    const switchingTab = deferred()
    await click(button('标签页'))
    nextTabChange = switchingTab
    await click(button('打开标签页：Linux.do'))
    await back()
    await click(button('网页工具'))
    await act(async () => switchingTab.resolve())
    assert.equal(current.tabId, tabBeforeSwitch)
    assert.ok(document.querySelector('[role="dialog"][aria-label="网页工具"]'), 'a delayed tab activation must preserve a later menu')
    assert.equal(document.querySelector('[data-test-player]'), null, 'completing a tab change still discards the previous tab player')
    assert.equal(bounds.at(-1)?.visible, false)
    await back()
    assert.equal(bounds.at(-1)?.visible, true)

    await observe(current.tabId!, current.url!, 'https://media.example.com/new-tab.mp4')
    await playFirst()
    const addingTab = deferred()
    await click(button('标签页'))
    nextTabChange = addingTab
    await click(button('新建标签页'))
    await back()
    await click(button('网页工具'))
    await act(async () => addingTab.resolve())
    assert.equal(current.url, 'about:blank')
    assert.equal(tabList.length, 3)
    assert.ok(document.querySelector('[role="dialog"][aria-label="网页工具"]'), 'a delayed new tab must preserve a later menu')
    assert.equal(document.querySelector('[data-test-player]'), null, 'a completed blank tab cannot retain another tab player after a menu opens')
    assert.equal(bounds.at(-1)?.visible, false)
    await back()
    assert.ok(document.querySelector('.browser-start'))
    assert.equal(bounds.at(-1)?.visible, false)

    await mount()
    const closingOpen = deferred()
    nextOpen = closingOpen
    await click(button('Linux.do'))
    await click(button('网页工具'))
    await click(button('返回有所闻', select('[role="dialog"][aria-label="网页工具"]')))
    assert.equal(exits, 1, 'the exit action completes while an open acknowledgement is pending')
    assert.equal(closeCalls, 1)
    assert.ok(document.querySelector('[data-reader]'))
    const finalBoundsCount = bounds.length
    await act(async () => closingOpen.resolve())
    assert.ok(document.querySelector('[data-reader]'), 'late open completion cannot restore the browser UI')
    assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null)
    assert.equal(bounds.length, finalBoundsCount, 'closed sessions cannot publish new native bounds')

    await mount()
    await click(button('添加快捷方式'))
    await enter('快捷方式名称', '保留名称')
    await enter('快捷方式网址', 'example.com')
    failedStorageKey = SHORTCUTS
    await submit('[role="dialog"][aria-label="添加快捷方式"]')
    assert.ok(document.querySelector('[role="dialog"][aria-label="添加快捷方式"]'))
    assert.equal((select('input[aria-label="快捷方式名称"]') as HTMLInputElement).value, '保留名称')
    assert.equal((select('input[aria-label="快捷方式网址"]') as HTMLInputElement).value, 'example.com')
    assert.match(document.body.textContent ?? '', /保存失败/)
    assert.equal(JSON.parse(storage.get(SHORTCUTS)!).length, 1, 'failed writes preserve the existing shortcuts')
    failedStorageKey = null
    await submit('[role="dialog"][aria-label="添加快捷方式"]')
    assert.equal(document.querySelector('[role="dialog"][aria-label="添加快捷方式"]'), null)
    assert.equal(JSON.parse(storage.get(SHORTCUTS)!)[1].url, 'https://example.com/')
    await click(button('Linux.do'))
    failedStorageKey = MARKS
    await menu('添加书签')
    assert.equal(storage.has(MARKS), false, 'bookmark write failures cannot report a saved bookmark')
    assert.ok(button('添加书签', select('[role="dialog"][aria-label="网页工具"]')))
    failedStorageKey = null
    await click(button('添加书签', select('[role="dialog"][aria-label="网页工具"]')))
    assert.equal(JSON.parse(storage.get(MARKS)!).length, 1)
    await mount(true)
    await click(button('书签'))
    assert.ok(button('打开：Linux.do'), 'bookmarks are restored after the browser remounts')
    assert.ok(document.body.textContent?.includes('https://linux.do/'))

    await mount()
    await click(button('Linux.do'))
    const firstTab = current.tabId!
    await observe(firstTab, 'https://linux.do/', 'https://media.example.com/first.mp4')
    const player = await playFirst()
    assert.equal(player.getAttribute('data-src'), 'https://media.example.com/first.mp4')
    assert.equal(bounds.at(-1)?.visible, false)
    await visit('https://example.com/watch')
    assert.equal(document.querySelector('[data-test-player]'), null, 'successful address navigation exits the old page player')
    assert.equal(bounds.at(-1)?.visible, true)
    await observe(firstTab, 'https://example.com/watch', 'https://media.example.com/second.mp4')
    await playFirst()
    await click(button('标签页'))
    await click(button('新建标签页'))
    assert.equal(document.querySelector('[data-test-player]'), null, 'new blank tabs cannot inherit another tab player')
    assert.equal(current.url, 'about:blank')
    assert.equal(bounds.at(-1)?.visible, false)
    await visit('https://other.example/watch')
    const secondTab = current.tabId!
    await click(button('标签页'))
    await click(button('打开标签页：example.com'))
    assert.equal(current.tabId, firstTab)
    const resumed = await playFirst()
    const ownedResources = resumed.getAttribute('data-resources')
    await observe(secondTab, 'https://other.example/watch', 'https://media.example.com/other.mp4')
    assert.equal(select('[data-test-player]').getAttribute('data-resources'), ownedResources, 'background tab media cannot replace a playing tab resource list')
    await click(button('标签页'))
    await click(button('打开标签页：other.example'))
    assert.equal(current.tabId, secondTab)
    assert.equal(document.querySelector('[data-test-player]'), null, 'tab selection exits the previous tab player')
    assert.equal(bounds.at(-1)?.visible, true)

    console.log('Browser workspace lifecycle and product flow iteration ' + iteration + ': OK')
  }

  await mount()
  await visit()
  await menu('浏览设置')
  await click(button('桌面版'))
  assert.equal(JSON.parse(storage.get('newsnook:browser:preferences:v1')!).userAgentMode, 'desktop', 'UA choice persists after native application succeeds')
  assert.equal(appliedSettings.at(-1)?.userAgentMode, 'desktop')
  failedStorageKey = 'newsnook:browser:preferences:v1'
  const beforeFailedSetting = storage.get(failedStorageKey)
  await click(button('JavaScript'))
  assert.equal(storage.get(failedStorageKey), beforeFailedSetting, 'failed settings persistence retains prior preferences')
  assert.equal(appliedSettings.at(-1)?.javaScriptEnabled, true, 'failed persistence rolls native settings back')
  failedStorageKey = null
  await back()
  await menu('桌面网页')
  assert.equal(JSON.parse(storage.get('newsnook:browser:preferences:v1')!).userAgentMode, 'system', 'desktop shortcut updates the same persisted UA setting')
  await menu('桌面网页')
  assert.equal(appliedSettings.at(-1)?.userAgentMode, 'desktop')
  await menu('页内查找')
  assert.ok(document.querySelector('[aria-label="在网页中查找"]'))
  assert.equal(bounds.at(-1)?.visible, true, 'find mode leaves the actual webpage visible')
  await enter('页内查找', '讨论')
  await act(async () => {await new Promise(resolve => setTimeout(resolve, 170))})
  assert.equal(findCalls.at(-1), '讨论')
  assert.equal(button('下一处').hasAttribute('disabled'), false)
  await back()
  assert.equal(document.querySelector('[aria-label="在网页中查找"]'), null, 'back closes only the find toolbar')
  const pendingScan = deferred()
  scanGate = pendingScan
  await menu('看图模式')
  assert.equal(bounds.at(-1)?.visible, false)
  await back()
  await act(async () => pendingScan.resolve())
  assert.equal(document.querySelector('[aria-label="看图模式"]'), null, 'late image scans cannot reopen a closed panel')
  assert.ok(imageCancels.length > 0, 'closing image mode cancels native image work')
  await menu('浏览设置')
  const confirmedSite = current.url!
  await click(button('清除当前站点数据'))
  await act(async () => {changeUrl('https://redirect.example/after-confirm'); emitNavigation('end')})
  await click(button('清除数据'))
  assert.equal(clearedSites.at(-1), confirmedSite, 'a delayed confirmation only clears the site named when the dialog opened')
  await back()
  const normalUrlBeforePrivate = current.url
  await menu('隐私模式')
  assert.equal(privateLaunches, 1)
  assert.equal(current.url, normalUrlBeforePrivate, 'starting private mode preserves the normal session')
  console.log('Browser settings, live find toolbar, image cancellation and private launch: OK')

  await mount(false, undefined, false, true)
  const beforePrivateVisit = [...storage.entries()]
  await visit('https://private.example/account?private_marker=never-persist')
  assert.deepEqual([...storage.entries()], beforePrivateVisit, 'private navigation never writes browsing history or any other storage key')
  await click(button('网页工具'))
  assert.equal([...document.querySelectorAll('button')].some(item => item.textContent?.trim() === '添加书签'), false, 'private URLs cannot be persisted as bookmarks')
  await back()
  await menu('页内查找')
  assert.ok(document.querySelector('[aria-label="在网页中查找"] [aria-label="隐私模式"]'), 'private indicator remains visible in find mode')
  await act(async () => {changeUrl('https://private.example/next'); emitNavigation('end')})
  assert.equal(document.querySelector('[aria-label="在网页中查找"]'), null, 'navigation closes a query whose native results were invalidated')
  await click(button('主页'))
  assert.equal(document.body.textContent?.includes('private.example'), false, 'private visits do not appear in recently visited sites')
  console.log('Private browser: navigation, bookmarks and recent-site storage boundary OK')

  const recovery: BrowserRecoverySession = { activeIndex: 1, tabs: [
    { url: 'https://linux.do/t/retained', title: '保留的讨论', desktop: false },
    { url: 'https://example.com/account?view=retained', title: '保留的当前页', desktop: true },
    { url: 'about:blank', title: '主页', desktop: false },
  ] }
  await mount(false, recovery, true)
  assert.equal(openCalls.length, 1, 'StrictMode restores one native browser session')
  assert.deepEqual(openCalls[0].recoverySession, recovery)
  assert.equal(openCalls[0].url, recovery.tabs[1].url)
  assert.equal(openCalls[0].visible, false)
  assert.equal(openCalls[0].embedded, true)
  assert.ok(Array.isArray(openCalls[0].scripts), 'recovery sends the current installed scripts')
  assert.deepEqual(Object.keys(openCalls[0].palette).sort(), ['accent', 'ink', 'muted', 'outline', 'paper', 'surface'])
  assert.equal(current.url, recovery.tabs[1].url)
  assert.equal(current.title, recovery.tabs[1].title)
  assert.equal(current.desktop, true)
  assert.equal(current.error, RECOVERY_ERROR)
  assert.equal(tabList.length, 3)
  assert.match(document.body.textContent ?? '', /网页进程已恢复，请重新加载此页/)
  assert.equal(bounds.at(-1)?.visible, false, 'recovered error pages leave native content hidden')
  assert.equal(commands.length, 0, 'restoration cannot automatically reload or navigate a recovered page')
  assert.deepEqual([...storage.keys()], [SHORTCUTS], 'the recovery snapshot is not written to local storage or visit history')
  await click(button('标签页'))
  assert.ok(button('打开标签页：保留的讨论'))
  assert.ok(button('打开标签页：保留的当前页'))
  await click(button('打开标签页：保留的讨论'))
  assert.equal(current.url, recovery.tabs[0].url)
  assert.equal(current.error, RECOVERY_ERROR, 'switching a recovered tab does not resubmit its request')
  assert.equal(commands.length, 0)
  await click(button('重新加载'))
  assert.equal(commands.filter(command => command.action === 'reload').length, 1, 'only an explicit reload resumes the recovered page')
  assert.equal(current.error, null)
  assert.equal(bounds.at(-1)?.visible, true)

  await mount()
  const recoveryRead = deferred()
  nextRecoveryRead = recoveryRead
  recoverySnapshot = recovery
  await act(async () => root.render(<React.StrictMode><BrowserLauncher/></React.StrictMode>))
  assert.equal(recoveryReads, 1, 'the launcher takes the native snapshot only once despite StrictMode')
  assert.equal(openCalls.length, 0)
  await act(async () => root.render(null))
  await act(async () => recoveryRead.resolve())
  assert.equal(openCalls.length, 0, 'a late recovery read cannot open an unmounted launcher')
  assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null)
  const recoveryOpening = deferred()
  nextOpen = recoveryOpening
  await act(async () => root.render(<React.StrictMode><BrowserLauncher/></React.StrictMode>))
  assert.equal(recoveryReads, 1, 'the next live launcher reuses the one in-memory result')
  assert.equal(openCalls.length, 1)
  assert.deepEqual(openCalls[0].recoverySession, recovery)
  const closeCountBeforeRecoveryExit = closeCalls
  await menu('返回有所闻')
  assert.equal(closeCalls, closeCountBeforeRecoveryExit + 1, 'exit closes a recovery even before open acknowledges completion')
  assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null)
  const boundsBeforeRecoveryCompletes = bounds.length
  await act(async () => recoveryOpening.resolve())
  assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null, 'a late recovery acknowledgement cannot reopen the exited workspace')
  assert.equal(bounds.length, boundsBeforeRecoveryCompletes)
  await act(async () => { window.dispatchEvent(new window.Event('newsnook:open-browser')) })
  assert.ok(document.querySelector('.browser-start'), 'an ordinary entry after exit starts without replaying recovery')
  assert.equal(openCalls.length, 1)
  assert.equal(recoveryReads, 1)
  await click(button('Linux.do'))
  assert.equal(openCalls.length, 2)
  assert.equal(openCalls[1].recoverySession, undefined)
  await menu('返回有所闻')
  await act(async () => root.render(null))
  await act(async () => root.render(<React.StrictMode><BrowserLauncher/></React.StrictMode>))
  assert.equal(recoveryReads, 1)
  assert.equal(document.querySelector('[aria-label="NewsNook 网页浏览器"]'), null, 'a consumed recovery is not offered again after launcher remount')
  console.log('Browser recovery: one-time launcher handoff, StrictMode, retained error tabs, manual reload and pending exit OK')
} finally {
  await act(async () => root.unmount())
  mock.restoreAll()
}
console.log('Browser workspace: overlays, pending navigation, blank tabs, downloads, confirmations, persistence and media ownership passed 3 iterations')
