import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
import type { NewsSource } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver, DOMParser: window.DOMParser,
  React, IS_REACT_ACT_ENVIRONMENT: true })
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
} })
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
  deleteDatabase: () => { const result: { onsuccess?: () => void } = {}; queueMicrotask(() => result.onsuccess?.()); return result },
} })
const { createRoot } = await import('react-dom/client')
const { FeedStoreScreen } = await import('../src/screens/settings/FeedStoreScreen')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch
let draft: Record<string, unknown> | undefined
let rebound: [string, string, Record<string, unknown>] | undefined
let radarCalls = 0
let rssCalls = 0
const domains = Object.fromEntries(Array.from({ length: 110 }, (_, i) => [
  'fakedomain' + i + '.org', { _name: 'Fake ' + i },
]))
const radar = {
  ...domains,
  'bilibili.com': { _name: 'Bilibili', space: [
    { title: 'UP 主动态', source: ['/:uid'], target: '/bilibili/user/dynamic/:uid' },
  ] },
}
const xml = '<rss version="2.0"><channel><title>UP 主动态</title><item><title>新动态</title><link>https://www.bilibili.com/read/cv111</link><pubDate>Fri, 09 Oct 2026 06:00:00 GMT</pubDate></item></channel></rss>'
const props = {
  prefs: DEFAULT_PREFERENCES,
  currentCategoryId: 'cn-headlines', currentPresetId: 'test-preset', currentPresetName: '测试预设', enabledIds: [],
  onSubscribe: (next: Record<string, unknown>) => { draft = next; return { ok: true } },
  onAddBuiltinToCategory: () => ({ ok: true }), onUpdateSubscription: () => ({ ok: true }),
  onPause: () => ({ ok: true }), onDelete: () => ({ ok: true }), onOpenSource() {}, onBack() {},
  onUpdateRssHubInstances: () => {},
  initialQuery: 'https://space.bilibili.com/12345',
}
function findButton(label: string) {
  const found = [...document.querySelectorAll('button')].find((node) => node.textContent?.trim() === label)
  assert.ok(found, 'missing button ' + label)
  return found as HTMLButtonElement
}
async function click(item: HTMLButtonElement) { await act(async () => { item.click() }) }
try {
  globalThis.fetch = async (input) => {
    const requested = String(input)
    const wrapped = new URL(requested, 'https://news.example.net')
    const target = wrapped.searchParams.get('url') ?? requested
    if (target.includes('raw.githubusercontent.com') && target.includes('radar-rules.json')) {
      radarCalls++
      return new Response(JSON.stringify(radar), { status: 200 })
    }
    if (target.startsWith('https://space.bilibili.com/')) {
      return new Response('<html><head></head><body>普通网页，没有原生订阅</body></html>')
    }
    if (target.includes('origin.feedsearch.dev')) return new Response('[]')
    if (target.includes('/bilibili/user/dynamic/12345')) {
      rssCalls++
      return new Response(xml, { status: 200 })
    }
    throw new Error('Unexpected RSSHub test request: ' + requested)
  }
  await act(async () => { root.render(<FeedStoreScreen {...props} />) })
  assert.equal(radarCalls, 0, 'opening store must not eagerly download Radar catalog')
  assert.equal([...document.querySelectorAll('button[aria-pressed]')].find((item) => item.textContent?.includes('通过网站订阅'))?.getAttribute('aria-pressed'), 'true')
  assert.ok(document.body.textContent?.includes('RSSHub · 4 个已启用实例'))
  assert.equal((document.querySelector('#feed-store-search') as HTMLInputElement)?.getAttribute('inputmode'), 'url')
  assert.ok((document.querySelector('#feed-store-search') as HTMLInputElement).placeholder.includes('https://'), 'URL mode shows a website-specific placeholder')
  await click(findButton('查找订阅'))
  assert.equal(radarCalls, 1)
  assert.ok(document.body.textContent?.includes('UP 主动态'))
  assert.ok(document.body.textContent?.includes('原站订阅与网址检测'))
  assert.ok(document.body.textContent?.includes('RSSHub 转换'))
  const result = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('UP 主动态') && node.textContent?.includes('RSSHub'))
  assert.ok(result, 'RSSHub result must be visibly distinguished from native feed')
  await click(result as HTMLButtonElement)
  assert.ok(document.body.textContent?.includes('RSSHub 路由设置'))
  assert.ok(document.body.textContent?.includes('https://rsshub.isrss.com/bilibili/user/dynamic/12345'))
  await click(findButton('检测与预览'))
  assert.equal(rssCalls, 1)
  assert.ok(document.body.textContent?.includes('本次检测成功'))
  await click(findButton('订阅'))
  assert.ok(draft)
  assert.equal(draft!.url, 'https://rsshub.isrss.com/bilibili/user/dynamic/12345')
  assert.equal((draft!.discovery as Record<string, unknown>).generator, 'rsshub')
  assert.equal((draft!.discovery as Record<string, unknown>).routeKey, '/bilibili/user/dynamic/12345')
  assert.equal((draft!.discovery as Record<string, unknown>).instanceId, 'isrss')
  assert.ok(document.body.textContent?.includes('订阅已保存'))
  await click(findButton('管理服务'))
  assert.ok(document.body.textContent?.includes('RSSHub 服务'))
  assert.ok(document.body.textContent?.includes('自定义实例'))
  assert.ok(document.querySelector('input[aria-label="启用 isRSS"]'))
  assert.ok(findButton('添加服务'))

  // Existing subscriptions can explicitly move instances without changing the source id.
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  const saved = { ...draft!, id: 'custom-rsshub-ui', isCustom: true, group: 'custom' as const,
    enabled: true, createdAt: 1000 }
  await act(async () => root.render(<FeedStoreScreen {...props}
    prefs={{ ...DEFAULT_PREFERENCES, customSources: [saved as NewsSource] }}
    onUpdateSubscription={(id, url, discovery) => { rebound = [id, url, discovery as unknown as Record<string, unknown>]; return { ok: true } }}
  />))
  await click(document.querySelector('button[aria-label="清除搜索"]') as HTMLButtonElement)
  await click(findButton('已订阅'))
  const rebindControl = document.querySelector('button[aria-label="更换 UP 主动态 的 RSSHub 服务"]') as HTMLButtonElement
  assert.ok(rebindControl, 'saved RSSHub subscriptions expose per-source instance selection')
  await click(rebindControl)
  assert.ok(document.body.textContent?.includes('更换 RSSHub 服务'))
  await click(document.querySelector('button[aria-label="选择目标 RSSHub 实例"]') as HTMLButtonElement)
  const targetInstance = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('FunnyCups'))
  assert.ok(targetInstance, 'instance picker offers other public providers')
  await click(targetInstance as HTMLButtonElement)
  await click(findButton('检测订阅'))
  assert.ok(document.body.textContent?.includes('检测成功'))
  await click(findButton('确认更换实例'))
  assert.equal(rebound?.[0], 'custom-rsshub-ui')
  assert.equal(rebound?.[1], 'https://rsshub.cups.moe/bilibili/user/dynamic/12345')
  assert.equal(rebound?.[2].routeKey, '/bilibili/user/dynamic/12345')
} finally {
  globalThis.fetch = originalFetch
  await act(async () => { root.unmount() })
}
console.log('rsshub subscription store UI: ok')
