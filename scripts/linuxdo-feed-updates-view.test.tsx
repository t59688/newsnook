import assert from 'node:assert/strict'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { Capacitor, registerPlugin } from '@capacitor/core'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
window.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as any
window.cancelAnimationFrame = clearTimeout as any
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any
window.getComputedStyle = (() => ({ transform: 'none', getPropertyValue: () => '' })) as any
window.HTMLElement.prototype.scrollTo = function (options: any) { this.scrollTop = options.top ?? 0 }
Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'
Object.defineProperty(document, 'visibilityState', { configurable: true, writable: true, value: 'visible' })
const session: any = { authenticated: true, authMode: 'browser-session', currentUser: { id: 7, username: 'reader' } }
let messages: any[] = []
let polls = 0
let pollStatus = 200
let failRefresh = false
let releaseRefresh: (() => void) | undefined
let blockRefresh = false
const feedPages: number[] = []
const topic = { id: 1, slug: 'topic', title: 'Cached topic', posts_count: 1, tags: [], posters: [] }
const nativeBoundary = { request: async (request: any) => {
  const url = new URL(request.url)
  if (url.pathname.startsWith('/message-bus/')) {
    polls++
    assert.equal(request.method, 'POST')
    assert.equal(request.headers['Dont-Chunk'], 'true')
    assert.equal(request.headers['X-CSRF-Token'], undefined)
    assert.equal(url.searchParams.get('dlp'), 't')
    assert.equal(url.origin, 'https://ping.ldstatic.com')
    if (pollStatus !== 200) return { status: pollStatus, data: '{}', headers: { 'retry-after': '90' } }
    const data = messages
    messages = []
    return { status: 200, data: JSON.stringify(data) }
  }
  if (url.pathname === '/latest.json') {
    const page = Number(url.searchParams.get('page'))
    feedPages.push(page)
    if (blockRefresh && page === 0) await new Promise<void>((resolve) => { releaseRefresh = resolve })
    if (failRefresh && page === 0) return { status: 503, data: '{}' }
    return { status: 200, data: JSON.stringify({ topic_list: { topics: [{ ...topic, id: page + 1, title: page > 0 ? 'Older topic' : feedPages.length > 1 ? 'Refreshed topic' : topic.title }], more_topics_url: '/latest.json?page=1' } }) }
  }
  if (url.pathname.startsWith('/t/')) return { status: 404, data: '{"errors":["not found"]}' }
  return { status: 200, data: '{}' }
} }
registerPlugin('LinuxDoSession', { android: () => nativeBoundary, web: () => nativeBoundary })
const { createRoot } = await import('react-dom/client')
const { LinuxDoWorkspace } = await import('../src/features/linuxdo/ui/LinuxDoWorkspace')
const { linuxDoApi, linuxDoNotifications, linuxDoDiscovery } = await import('../src/features/linuxdo/runtime')
linuxDoApi.restore = async () => { linuxDoApi.setSession(session); return session }
linuxDoNotifications.unreadCount = async () => 0
linuxDoDiscovery.categories = async () => []
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const backHandlerRef: any = { current: null }
const noop = () => {}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const advance = async (ms: number) => { await act(async () => { mock.timers.tick(ms); await flush() }) }
const click = async (label: string) => {
  const button = [...host.querySelectorAll<HTMLElement>('button,[role="link"]')].find((node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label)
  assert.ok(button, label)
  await act(async () => { button.click(); await flush() })
}
const scroller = () => host.querySelector<HTMLElement>('.overflow-y-auto.page-x')!
const banner = () => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('新的或更新过的话题'))
const update = (id: number, sequence: number) => ({ channel: '/latest', message_id: sequence, data: { topic_id: id, message_type: 'latest' } })
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 })
try {
  await act(async () => { root.render(<LinuxDoWorkspace onExit={noop} backHandlerRef={backHandlerRef} presetSwitcher={{ activeName: 'Test', items: [], onSelect: noop, onManage: noop }} />); await flush() })
  messages = [{ channel: '/__status', data: { '/latest': 100 } }]
  await advance(0)
  Object.defineProperties(scroller(), { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 400 } })
  scroller().scrollTop = 450
  await act(async () => { scroller().dispatchEvent(new window.Event('scroll')); await flush() })
  assert.deepEqual(feedPages, [0, 1], 'scrolling loads old pages')
  messages = [update(10, 101), update(10, 102), update(11, 103)]
  await advance(15000)
  assert.equal(banner()?.textContent, '查看 2 个新的或更新过的话题')
  assert.equal(scroller().scrollTop, 450, 'incoming events must preserve scroll')
  assert.deepEqual(feedPages, [0, 1], 'incoming events must not replace the list automatically')
  await click('打开主题：Cached topic')
  messages = [update(12, 104)]
  await advance(15000)
  await act(async () => { backHandlerRef.current(); await flush() })
  assert.equal(scroller().scrollTop, 450, 'returning from a topic preserves the cached feed position')
  assert.equal(banner()?.textContent, '查看 3 个新的或更新过的话题', 'updates received inside a topic survive returning')
  failRefresh = true
  await click(banner()!.textContent!)
  assert.equal(scroller().scrollTop, 0, 'banner immediately returns to the top')
  assert.ok(banner(), 'failed refresh keeps pending updates available for retry')
  failRefresh = false; blockRefresh = true
  await click(banner()!.textContent!)
  messages = [update(13, 105)]
  await advance(15000)
  await act(async () => { releaseRefresh?.(); await flush() })
  blockRefresh = false
  assert.equal(banner()?.textContent, '查看 1 个新的或更新过的话题', 'refresh must not clear events received while it was in flight')
  await click(banner()!.textContent!)
  assert.equal(banner(), undefined)
  assert.ok(host.textContent?.includes('Refreshed topic'))
  assert.ok(!host.textContent?.includes('Older topic'), 'refresh resets pagination and replaces old pages')
  ;(document as any).visibilityState = 'hidden'
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); await flush() })
  const hiddenPolls = polls
  await advance(60000)
  assert.equal(polls, hiddenPolls, 'hidden workspace must not poll')
  ;(document as any).visibilityState = 'visible'
  pollStatus = 429
  await act(async () => { document.dispatchEvent(new window.Event('visibilitychange')); await flush() })
  await advance(0)
  const limitedPolls = polls
  await advance(89999)
  assert.equal(polls, limitedPolls, 'server Retry-After must be respected')
  pollStatus = 200
  await advance(1)
  assert.equal(polls, limitedPolls + 1)
  await act(async () => { root.unmount(); await flush() })
  const stoppedPolls = polls
  await advance(60000)
  assert.equal(polls, stoppedPolls, 'leaving workspace cancels polling')
  console.log('linuxdo-feed-updates-view: ok')
} finally {
  await act(async () => root.unmount())
  mock.timers.reset()
}
