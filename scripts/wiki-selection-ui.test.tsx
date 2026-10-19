import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

registerHooks({ load(url, context, next) {
  if (/\.css$/.test(url)) return { format: 'module', source: 'export default ""', shortCircuit: true }
  return next(url, context)
} })
const { window } = parseHTML('<html><body><div id="root"></div><div class="reader-prose"><p id="text">量子纠缠</p><button id="reader-button">正文按钮</button><input id="input" /></div><div id="blank"></div></body></html>')
const memory = new Map<string, string>()
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } })
Object.assign(window, { innerWidth: 390, innerHeight: 844 })
const frameCallbacks = new Map<number, FrameRequestCallback>()
let nextFrameId = 0
Object.assign(globalThis, {
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    const id = ++nextFrameId
    frameCallbacks.set(id, callback)
    return id
  },
  cancelAnimationFrame: (id: number) => { frameCallbacks.delete(id) },
})
function paintFrame() {
  const batch = [...frameCallbacks.values()]
  frameCallbacks.clear()
  batch.forEach(callback => callback(0))
}
let selectionText = '量子纠缠'
let anchor = document.getElementById('text')!.firstChild!
const selection = {
  get isCollapsed() { return !selectionText }, get rangeCount() { return selectionText ? 1 : 0 },
  get anchorNode() { return anchor }, get focusNode() { return anchor },
  toString: () => selectionText,
  getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 100, top: 200, width: 70, height: 24 }) }),
  removeAllRanges: () => { selectionText = '' },
}
Object.assign(window, { getSelection: () => selection })
const { createRoot } = await import('react-dom/client')
const { WikiSelectionLayer } = await import('../src/features/wiki/WikiSelectionLayer')
const { haptics } = await import('../src/lib/haptics')
let snapCount = 0
haptics.snap = async () => { snapCount++ }
const { registerEncyclopediaProvider } = await import('../src/features/wiki/encyclopedia')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
registerEncyclopediaProvider({ id: 'test', name: '测试百科', language: 'zh', async lookup(term) {
  return { query: term, title: term, description: '', summary: '词条摘要', url: 'https://example.test/wiki', providerId: 'test', language: 'zh', related: [] }
} })
registerEncyclopediaProvider({ id: 'persisted-test', name: '持久化测试百科', language: 'zh', async lookup(term) {
  return { query: term, title: term, description: '', summary: '保存后的词条摘要', url: 'https://example.test/persisted', providerId: 'persisted-test', language: 'zh', related: [] }
} })
memory.set('newsnook.wiki.settings.v1', JSON.stringify({ enabled: true, providerId: 'test', directLookup: false, fallbackEnglish: true }))
const root = createRoot(document.getElementById('root')!)
const peek = () => document.querySelector('.wiki-selection-popover')
const wait = () => new Promise(resolve => setTimeout(resolve, 150))
async function event(target: EventTarget, type: string) {
  await act(async () => { target.dispatchEvent(new window.Event(type, { bubbles: true })); await wait() })
}
async function select() {
  selectionText = '量子纠缠'
  anchor = document.getElementById('text')!.firstChild!
  await event(document.getElementById('text')!, 'pointerup')
  assert.ok(peek(), '正文选词显示浮动工具栏')
}
function mockSheetHeight(sheet: Element, halfHeight: number) {
  Object.defineProperty(sheet, 'getBoundingClientRect', { configurable: true, value: () => ({
    height: Number.parseFloat((sheet as HTMLElement).style.height) || (sheet.classList.contains('wiki-sheet-expanded') ? window.innerHeight : halfHeight),
  }) })
}
function pointer(target: EventTarget, type: string, clientY: number, pointerId = 7) {
  const sample = new window.Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(sample, {
    button: { value: 0 }, pointerId: { value: pointerId }, clientY: { value: clientY },
  })
  target.dispatchEvent(sample)
}
async function drag(grabber: Element, fromY: number, toY: number, cancelled = false) {
  await act(async () => pointer(grabber, 'pointerdown', fromY))
  await act(async () => pointer(grabber, 'pointermove', toY))
  await act(async () => pointer(grabber, cancelled ? 'pointercancel' : 'pointerup', toY))
}
try {
  await act(async () => root.render(<WikiSelectionLayer />))
  await select()
  // Keep the browser selection intact to exercise the delayed pointerup/touchend race.
  await event(document.getElementById('blank')!, 'pointerdown')
  assert.ok(peek() === null, '点击空白应立即关闭工具栏')
  await event(document.getElementById('blank')!, 'pointerup')
  await event(document.getElementById('blank')!, 'touchend')
  assert.ok(peek() === null, '外部点击后的延迟选区读取不能重新打开工具栏')

  await select()
  await event(document.querySelector('.wiki-popover-item')!, 'pointerdown')
  assert.ok(peek(), '工具栏内部点击不能关闭工具栏')
  await act(async () => document.querySelector<HTMLButtonElement>('.wiki-popover-item')!.click())
  assert.ok(document.querySelector('.wiki-entry-summary'), '百科按钮仍能查询词条')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="切换查询百科源"]')!.click())
  const persistedOption = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent === '持久化测试百科')!
  await act(async () => persistedOption.click())
  assert.equal(JSON.parse(memory.get('newsnook.wiki.settings.v1')!).providerId, 'persisted-test', '查询面板切源必须持久化，即使随后关闭面板')
  await event(document.getElementById('blank')!, 'pointerdown')
  assert.ok(document.querySelector('.wiki-sheet'), '正文外部点击监听不能错误关闭词条面板')
  await act(async () => { dismissTopHardwareBackLayer() })
  await act(async () => root.render(null))
  await act(async () => root.render(<WikiSelectionLayer />))
  await act(async () => window.dispatchEvent(new window.Event('newsnook:open-wiki-settings')))
  assert.ok(document.querySelector('[aria-label="默认百科源：持久化测试百科"]'), '重新挂载后恢复查询面板选择的提供商')
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭百科"]')!.click())

  let copied = ''
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    clipboard: { async writeText(text: string) { copied = text } },
  } })
  await select()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="复制所选文字"]')!.click())
  assert.equal(copied, '量子纠缠', '复制按钮使用点击前捕获的选中文字')
  assert.ok(peek() === null, '复制后关闭工具栏')

  await select()
  const searchBtn = document.querySelector<HTMLButtonElement>('[title="在浏览器中搜索“量子纠缠”"]')
  assert.ok(searchBtn, '划词工具栏必须包含搜索按钮')
  await act(async () => searchBtn.click())
  const searchSheet = document.querySelector('.wiki-sheet-search')
  assert.ok(searchSheet, '点击搜索按钮弹出内置浏览器搜索半窗')
  assert.equal(searchSheet.classList.contains('wiki-sheet-expanded'), false, '默认呈半窗状态')

  const expandBtn = searchSheet.querySelector<HTMLButtonElement>('[aria-label="展开为全屏"]')
  assert.ok(expandBtn, '包含展开按钮')
  await act(async () => expandBtn.click())
  assert.ok(searchSheet.classList.contains('wiki-sheet-expanded'), '点击展开按钮展开为全屏')

  const collapseBtn = searchSheet.querySelector<HTMLButtonElement>('[aria-label="收起为半窗"]')
  assert.ok(collapseBtn, '全屏下包含收起按钮')
  await act(async () => collapseBtn.click())
  assert.equal(searchSheet.classList.contains('wiki-sheet-expanded'), false, '收起回半窗')

  const baiduPill = searchSheet.querySelector<HTMLButtonElement>('[title="切换为 百度 搜索“量子纠缠”"]')
  assert.ok(baiduPill, '必须包含百度搜索引擎切换标签')
  await act(async () => baiduPill.click())
  assert.ok(baiduPill.classList.contains('is-active'), '切换后百度标签成为激活态')

  const wikiTab = searchSheet.querySelector<HTMLButtonElement>('[title="切换到词条百科"]')
  assert.ok(wikiTab, '搜索半窗包含切换到百科模式标签')
  await act(async () => wikiTab.click())
  const articleSheet = document.querySelector<HTMLElement>('.wiki-sheet:not(.wiki-sheet-search)')!
  assert.ok(articleSheet, '点击百科标签切回词条百科模式')
  mockSheetHeight(articleSheet, 340)
  const articleGrabber = articleSheet.querySelector<HTMLButtonElement>('.wiki-sheet-grabber')!
  await drag(articleGrabber, 740, 450)
  assert.equal(articleSheet.style.height, '630px', '百科半窗拖动时逐帧调整高度，松手后保持中间尺寸')
  assert.equal(articleSheet.style.maxHeight, '844px', '百科面板解除 82dvh 最大高度限制，允许继续拖至屏幕顶部')
  assert.equal(articleSheet.style.minHeight, '0px', '百科面板拖动时也不受全屏 min-height 限制')
  assert.equal(articleSheet.classList.contains('wiki-sheet-expanded'), false, '百科尚未触顶时不强制全屏')
  assert.equal(snapCount, 0, '未触顶的手势不触发马达')

  await act(async () => pointer(articleGrabber, 'pointerdown', 540))
  await act(async () => {
    pointer(articleGrabber, 'pointermove', 510)
    pointer(articleGrabber, 'pointermove', 490)
    pointer(articleGrabber, 'pointermove', 470)
  })
  assert.equal(frameCallbacks.size, 1, '同一刷新帧内的多次手指移动只排入一次布局写入')
  assert.equal(articleSheet.style.height, '630px', 'rAF 提交前保留上帧位置，不同步强迫浏览器重布局')
  await act(async () => paintFrame())
  assert.equal(articleSheet.style.height, '700px', '下一次绘制采用最新指针位置，跳过过时位置')
  assert.equal(articleSheet.style.maxHeight, '844px', '百科浮层越过 82dvh 时仍允许继续拉伸')
  assert.equal(snapCount, 0, '距吸顶区域尚远时无振动')
  await act(async () => pointer(articleGrabber, 'pointermove', 350))
  assert.equal(snapCount, 1, '进入吸顶阈值时立刻发出一次触觉反馈，不等待松手')
  await act(async () => pointer(articleGrabber, 'pointermove', 400))
  await act(async () => pointer(articleGrabber, 'pointermove', 280))
  assert.equal(snapCount, 1, '同一手势重复跨入吸顶阈值不重复震动')
  await act(async () => pointer(articleGrabber, 'pointerup', 280))
  assert.equal(frameCallbacks.size, 0, '抬手时取消尚未执行的拖拽帧')
  assert.ok(articleSheet.classList.contains('wiki-sheet-expanded'), '百科拖动至屏幕顶部自动转全屏')
  await act(async () => articleGrabber.click())
  assert.ok(articleSheet.classList.contains('wiki-sheet-expanded'), '拖动结束产生的 click 不得再次折叠面板')
  await drag(articleGrabber, 200, 540)
  assert.equal(snapCount, 1, '从全屏向下拉不会触发吸顶马达')
  assert.equal(articleSheet.classList.contains('wiki-sheet-expanded'), false, '百科全屏允许从横条向下拖动恢复浮层')
  assert.equal(articleSheet.style.height, '504px', '向下拖动后的中间尺寸保留，不强制跳回半屏')
  await drag(articleGrabber, 540, 600, true)
  assert.equal(articleSheet.style.height, '504px', '系统取消指针手势时回滚至拖动前高度')

  const searchTab = document.querySelector<HTMLButtonElement>('[title="切换到网页搜索“量子纠缠”"]')
  assert.ok(searchTab, '百科半窗包含切换到搜索模式标签')
  await act(async () => searchTab.click())
  const activeSearchSheet = document.querySelector<HTMLElement>('.wiki-sheet-search')
  assert.ok(activeSearchSheet, '点击搜索标签切回网页搜索半窗')

  mockSheetHeight(activeSearchSheet, 506)
  const searchGrabber = activeSearchSheet.querySelector<HTMLButtonElement>('.wiki-sheet-grabber')!
  await drag(searchGrabber, 650, 520)
  assert.equal(activeSearchSheet.style.height, '636px', '搜索半窗也支持连续拉高和保持中间尺寸')
  assert.equal(activeSearchSheet.style.maxHeight, '844px', '搜索面板不得再被原本 75dvh 的 CSS 最大高度卡住')
  assert.equal(activeSearchSheet.style.minHeight, '0px', '搜索面板拖动期间解除 CSS 高度下限')
  await drag(searchGrabber, 520, 680)
  assert.equal(activeSearchSheet.style.height, '', '搜索面板向下拖至最低位置恢复初始高度')
  const closeSearchBtn = activeSearchSheet.querySelector<HTMLButtonElement>('[aria-label="关闭搜索返回阅读"]')
  assert.ok(closeSearchBtn, '包含关闭搜索返回阅读按钮')
  await act(async () => closeSearchBtn.click())
  assert.equal(document.querySelector('.wiki-sheet-search'), null, '关闭搜索面板返回阅读')

  await select()
  await act(async () => document.querySelector<HTMLButtonElement>('[title="在浏览器中搜索“量子纠缠”"]')!.click())
  const fullSearchSheet = document.querySelector<HTMLElement>('.wiki-sheet-search')!
  mockSheetHeight(fullSearchSheet, 506)
  let promotedUrl = ''
  const recordFullBrowser = (event: Event) => { promotedUrl = (event as CustomEvent<{url: string}>).detail.url }
  window.addEventListener('newsnook:open-browser', recordFullBrowser)
  await drag(fullSearchSheet.querySelector('.wiki-sheet-grabber')!, 650, 300)
  assert.equal(snapCount, 2, '搜索半窗使用相同的吸顶触觉反馈')
  await act(async () => { await wait() })
  window.removeEventListener('newsnook:open-browser', recordFullBrowser)
  assert.ok(promotedUrl.startsWith('https://') && promotedUrl.includes(encodeURIComponent('量子纠缠')), '搜索面板触顶后将当前搜索地址交给完整浏览器')
  assert.equal(document.querySelector('.wiki-sheet-search'), null, '进入完整浏览器时退出半屏搜索面板')

  selectionText = '量子纠缠'
  const nativeEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
  await act(async () => { window.dispatchEvent(nativeEvent) })
  assert.ok(nativeEvent.defaultPrevented && peek(), '原生选区创建时通知前端并确认由 App 工具栏接管')
  selectionText = ''
  await event(document, 'selectionchange')
  assert.ok(peek() === null, '系统取消选区时关闭工具栏')

  for (const id of ['input', 'reader-button']) {
    anchor = document.getElementById(id)!
    selectionText = '不可接管'
    const editingEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
    await act(async () => { window.dispatchEvent(editingEvent) })
    assert.equal(editingEvent.defaultPrevented, false, '输入框和按钮选区应保留系统操作')
    assert.ok(peek() === null)
  }
  await act(async () => window.dispatchEvent(new window.Event('newsnook:open-wiki-settings')))
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="默认百科源："]')!.click())
  assert.ok(!Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).some(option => option.textContent === '百度百科'), 'Web 设置不显示不可用的百度百科')
  // The same UI exposes Baike on Android.
  const { Capacitor } = await import('@capacitor/core')
  const getPlatform = Capacitor.getPlatform
  Capacitor.getPlatform = () => 'android'
  await act(async () => root.render(null))
  await act(async () => root.render(<WikiSelectionLayer />))
  await act(async () => window.dispatchEvent(new window.Event('newsnook:open-wiki-settings')))
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="默认百科源："]')!.click())
  const baiduOption = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent === '百度百科')
  assert.ok(baiduOption, '设置中可以选择百度百科')
  await act(async () => baiduOption.click())
  assert.equal(JSON.parse(memory.get('newsnook.wiki.settings.v1')!).providerId, 'baidu-baike', '百度百科偏好保存到本机')
  assert.ok(document.querySelector('[aria-label="默认百科源：百度百科"]'))
  Capacitor.getPlatform = getPlatform
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="启用划词百科"]')!.click())
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭百科"]')!.click())
  anchor = document.getElementById('text')!.firstChild!
  selectionText = '量子纠缠'
  const disabledEvent = new window.Event('newsnook:wiki-selection', { cancelable: true })
  await act(async () => window.dispatchEvent(disabledEvent))
  assert.equal(disabledEvent.defaultPrevented, false, '关闭划词百科后应保留系统选词菜单')
  assert.ok(peek() === null)
  await act(async () => root.unmount())
  await event(document, 'pointerup')
} finally {
  await act(async () => root.unmount())
}
console.log('wiki-selection-ui: ok')

