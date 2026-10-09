import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver, DOMParser: window.DOMParser, React, IS_REACT_ACT_ENVIRONMENT: true })
const memory = new Map<string, string>()
memory.set('newsnook:feed-discovery-config', '{"catalogs":[]}')
let deletedDatabases = 0
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
  open: () => { throw new Error('must not open a catalog database') },
  deleteDatabase: (name: string) => { assert.equal(name, 'newsnook:feed-discovery'); deletedDatabases++; const request: { onsuccess?: () => void } = {}; queueMicrotask(() => request.onsuccess?.()); return request },
} })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value), removeItem: (key: string) => memory.delete(key) } })
const { createRoot } = await import('react-dom/client')
const { FeedStoreScreen } = await import('../src/screens/settings/FeedStoreScreen')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const root = createRoot(document.getElementById('root')!)
let subscription: unknown[] | undefined
let requests = 0
const originalFetch = globalThis.fetch
const props = {
  prefs: DEFAULT_PREFERENCES, currentCategoryId: 'cn-headlines', currentPresetId: 'test', currentPresetName: '测试预设', enabledIds: [],
  onSubscribe: (...args: unknown[]) => { subscription = args; return { ok: true } },
  onAddBuiltinToCategory: () => ({ ok: true }), onUpdateSubscription: () => ({ ok: true }), onPause: () => ({ ok: true }), onDelete: () => ({ ok: true }), onOpenSource() {}, onBack() {},
  initialQuery: 'OpenAI',
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)
  assert.ok(found, 'button: ' + text)
  return found as HTMLButtonElement
}
async function click(item: HTMLButtonElement) { await act(async () => item.click()) }
try {
  globalThis.fetch = async () => { requests++; return new Response('{"results":[{"id":"feed/https://example.com/test.xml","title":"Test direct"}]}') }
  await act(async () => root.render(<FeedStoreScreen {...props} />))
  assert.equal(requests, 0, 'opening store must not download a catalog')
  assert.equal(deletedDatabases, 1, 'retired catalog database is deleted without reading it')
  assert.equal(memory.has('newsnook:feed-discovery-config'), false)
  assert.equal(document.body.textContent?.includes('目录管理'), false)
  assert.ok(document.body.textContent?.includes('按名称搜索'))
  assert.ok(document.body.textContent?.includes('通过网站订阅'))
  assert.equal([...document.querySelectorAll('button[aria-pressed]')].find((item) => item.textContent?.includes('按名称搜索'))?.getAttribute('aria-pressed'), 'true')
  assert.equal(document.body.textContent?.includes('RSSHub · 4 个已启用实例'), false, 'service settings only belong in URL discovery')
  await click(button('搜索 RSS'))
  assert.equal(requests, 1)
  assert.ok(document.body.textContent?.includes('想订阅某个 UP 主或作者？'), 'keyword results show the website flow')
  assert.ok(document.body.textContent?.includes('example.com'), 'result displays a readable site domain')
  assert.equal(document.body.textContent?.includes('https://example.com/test.xml'), false, 'result list does not expose long raw feed URLs')
  await click(button('粘贴网址'))
  assert.equal([...document.querySelectorAll('button[aria-pressed]')].find((item) => item.textContent?.includes('通过网站订阅'))?.getAttribute('aria-pressed'), 'true')
  assert.equal((document.querySelector('#feed-store-search') as HTMLInputElement).value, '', 'switching search intent clears old keyword')
  assert.equal(requests, 1, 'mode switching never triggers an unsolicited request')
  assert.ok(button('B 站 UP 主'))
  await click(button('B 站 UP 主'))
  assert.equal((document.querySelector('#feed-store-search') as HTMLInputElement).value, 'https://space.bilibili.com/1161918898')
  assert.equal(requests, 1, 'example chips fill the URL without prefetching')
  const keywordCard = [...document.querySelectorAll('button[aria-pressed]')].find((node) => node.textContent?.includes('按名称搜索')) as HTMLButtonElement
  await click(keywordCard)
  await click(button('人工智能'))
  await click(button('搜索 RSS'))
  await click([...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Test direct')) as HTMLButtonElement)
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  await click([...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Test direct')) as HTMLButtonElement)
  assert.ok(document.body.textContent?.includes('测试预设'))
  await click(document.querySelector('button[aria-label="加入分类"]') as HTMLButtonElement)
  await click(button('仅保存，暂不加入信息流'))
  globalThis.fetch = async () => new Response('{"version":"https://jsonfeed.org/version/1.1","title":"Empty","items":[]}')
  await click(button('检测与预览'))
  assert.ok(document.body.textContent?.includes('当前暂无条目'))
  await click(button('订阅'))
  assert.ok(subscription)
  assert.equal(subscription[1], undefined)
  assert.equal(subscription[2], false)
  assert.equal(subscription[3], 'test')
  assert.ok(document.body.textContent?.includes('订阅已保存'))
  assert.ok(button('查看订阅'))
  assert.ok(button('继续发现'))
  assert.equal([...memory.keys()].some((key) => key.includes('feed-discovery')), false, 'results never enter persistent storage')
  await click(button('已订阅'))
  const source = { id: 'custom-test', name: 'OpenAI saved', label: 'Test', kind: 'feed' as const, url: 'https://example.com/test.xml' }
  await act(async () => root.render(<FeedStoreScreen {...props} prefs={{ ...DEFAULT_PREFERENCES, customSources: [source] }} onPause={() => ({ ok: false, message: '暂停保存失败' })} onDelete={() => ({ ok: false, message: '删除保存失败' })} />))
  await click(document.querySelector('button[aria-label="暂停 OpenAI saved"]') as HTMLButtonElement)
  assert.ok(document.body.textContent?.includes('暂停保存失败'))
  await click(document.querySelector('button[aria-label="删除 OpenAI saved"]') as HTMLButtonElement)
  await click(button('删除'))
  assert.ok(document.body.textContent?.includes('删除保存失败'))
  assert.ok(document.body.textContent?.includes('删除订阅？'))
} finally {
  globalThis.fetch = originalFetch
  await act(async () => root.unmount())
}
console.log('feed discovery UI: ok')
