import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { mock } from 'node:test'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
const storage = new Map<string, string>()
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
  DOMParser: window.DOMParser, NodeFilter: window.NodeFilter, React,
  MutationObserver: window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
})
const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let mediaShift = 0
let resizeCallback: (() => void) | undefined
globalThis.ResizeObserver = class { constructor(callback: () => void) { resizeCallback = callback } observe() {} disconnect() {} } as any
window.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId }
window.cancelAnimationFrame = (id: number) => { frames.delete(id) }
window.getComputedStyle = (() => ({ overflowY: 'auto', getPropertyValue: () => '' })) as any
window.HTMLElement.prototype.scrollTop = 0
window.HTMLElement.prototype.scrollIntoView = function () {
  const root = this.closest('[data-linuxdo-topic-scroller]') as HTMLElement
  root.scrollTop = Math.max(0, root.scrollTop + this.getBoundingClientRect().top - 80)
  root.dispatchEvent(new window.Event('scroll', { bubbles: true }))
}
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const scroller = this.closest('[data-linuxdo-topic-scroller]') as HTMLElement | null
  const articles = scroller ? Array.from(scroller.querySelectorAll('article[data-linuxdo-post-number]')) : []
  const index = articles.indexOf(this)
  const top = index >= 0 ? 60 + index * 140 + (index >= 2 ? mediaShift : 0) - (scroller?.scrollTop ?? 0) : 0
  const height = index >= 0 ? 140 : 300
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 400, width: 400, height, toJSON() {} }
}
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'
let serverRead = 40
let fail = false
const requests: string[] = []
const stream = Array.from({ length: 100 }, (_, i) => 1001 + i)
const post = (number: number) => ({ ...(number === 42 ? { reply_to_post_number: 8, reply_to_user: { username: 'quoted' }, via_ios_app: true, ios_device_name: 'iPhone 17' } : {}), id: 1000 + number, post_number: number, username: 'reader', read: false, cooked: '<p>Reply</p>', actions_summary: [] })
let releaseResponse: (() => void) | undefined
let delayTopic: number | undefined
const native = {
  request: async ({ url }: { url: string }) => {
    requests.push(url)
    const parsed = new URL(url)
    const match = parsed.pathname.match(/^\/t\/test\/(\d+)(?:\/(\d+))?\.json$/)
    if (match) {
      const id = Number(match[1])
      if (id === delayTopic) await new Promise<void>(resolve => { releaseResponse = resolve })
      if (fail) return { status: 500, data: '{"errors":["offline"]}' }
      const near = Number(match[2] ?? 1)
      const numbers = Array.from({ length: 5 }, (_, i) => Math.max(1, Math.min(96, near - 2)) + i)
      return { status: 200, data: JSON.stringify({ id, slug: 'test', title: 'Position topic ' + id, posts_count: 100, highest_post_number: 100,
        last_read_post_number: serverRead, post_stream: { stream, posts: numbers.map(post) } }) }
    }
    if (parsed.pathname.endsWith('/posts.json')) {
      return { status: 200, data: JSON.stringify({ post_stream: { posts: parsed.searchParams.getAll('post_ids[]').map(id => post(Number(id) - 1000)) } }) }
    }
    if (parsed.pathname === '/session/csrf.json') return { status: 200, data: '{"csrf":"test"}' }
    if (parsed.pathname === '/topics/timings') return { status: 200, data: '' }
    throw new Error('Unexpected request: ' + url)
  },
  prepareBrowserSession: async () => ({ ready: false }),
}
registerPlugin('LinuxDoSession', { android: () => native, web: () => native })
const { createRoot } = await import('react-dom/client')
const { LinuxDoTopicView } = await import('../src/features/linuxdo/ui/ThreadViews')
const { linuxDoTopicPositionOf, rememberLinuxDoTopicPosition, adjacentLinuxDoPostIds } = await import('../src/features/linuxdo/topic/readingPosition')
const { linuxDoApi } = await import('../src/features/linuxdo/runtime')
const session = { authenticated: true, authMode: 'browser-session', currentUser: { id: 9, username: 'reader' } }
const noop = () => {}
const props: any = { summary: { id: 100, slug: 'test', title: 'Position topic', replyCount: 99, views: 1, tags: [], posters: [] },
  session, categoriesById: { 1: { id: 1, name: 'Test' } }, overlayBackHandlerRef: { current: null },
  onBack: noop, onCompose: noop, onBoost: noop, onOpenUser: noop, onOpenTopic: noop, onOpenTag: noop, onEdit: noop }
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }
const draw = async () => { await act(async () => { const callbacks = Array.from(frames.values()); frames.clear(); callbacks.forEach(fn => fn(0)); await flush() }) }
const render = async (extra: any = {}) => {
  const next = { ...props, ...extra }
  linuxDoApi.setSession(next.session)
  await act(async () => { root.render(<LinuxDoTopicView key={`${next.summary.id}:${next.session.currentUser?.id ?? 'guest'}:${next.targetPostNumber ?? ''}`} {...next} />); await flush() })
  await draw()
}
const close = async () => { await act(async () => { root.render(null); await flush() }); frames.clear() }
const scroller = () => host.querySelector('[data-linuxdo-topic-scroller]') as HTMLElement
const scroll = async (top: number) => {
  const node = scroller()
  Object.defineProperty(node, 'clientHeight', { value: 300, configurable: true })
  Object.defineProperty(node, 'scrollHeight', { get: () => 260 + node.querySelectorAll('article[data-linuxdo-post-number]').length * 140, configurable: true })
  await act(async () => { node.dispatchEvent(new window.Event('touchstart', { bubbles: true })); node.scrollTop = top; node.dispatchEvent(new window.Event('scroll', { bubbles: true })); await flush() })
}
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 })
try {
  await render()
  const devicePost = host.querySelector('[data-linuxdo-post-number="42"]')!
  const deviceLabel = devicePost.querySelector('[data-linuxdo-post-device]')!
  assert.ok(deviceLabel, 'device information must be present without hover or click')
  assert.match(deviceLabel.textContent || '', /回复自 iPhone 17/)
  assert.equal(devicePost.querySelector('header [data-linuxdo-post-device]'), null, 'device belongs below the post body')
  assert.ok(devicePost.querySelector('.linuxdo-post-prose')!.compareDocumentPosition(deviceLabel) & 4)
  assert.equal(host.querySelector('[data-linuxdo-post-number="41"] [data-linuxdo-post-device]'), null)
  assert.ok(requests.includes('https://linux.do/t/test/100/41.json'), 'plain open must load the server-derived first unread floor outside the initial window')
  assert.equal(scroller().scrollTop, 340, 'restored floor must be visible, not merely fetched')
  console.log('PASS server cursor opens the correct post window and positions it')
  mediaShift = 70
  await act(async () => { resizeCallback?.(); await flush() })
  assert.equal(scroller().scrollTop, 410, 'late media growth above the target must retain the initial anchor')
  mediaShift = 0
  await act(async () => { resizeCallback?.(); await flush() })
  await scroll(450)
  mediaShift = 70
  await act(async () => { resizeCallback?.(); await flush() })
  assert.equal(scroller().scrollTop, 450, 'after user input, delayed layout must not force the opening position')
  mediaShift = 0
  await scroll(450)
  await act(async () => { mock.timers.tick(5000); await flush() })
  assert.equal(scroller().scrollTop, 450, 'timings ACK and read-state renders must not jump back to the opening floor')
  console.log('PASS media stabilization stops on input and read ACK does not reset position')
  await close()
  serverRead = 80
  requests.length = 0
  await render()
  assert.equal(requests[0], 'https://linux.do/t/test/100/41.json', 'local last view must override the furthest server cursor')
  assert.equal(scroller().scrollTop, 450, 're-entry must restore offset inside a long post')
  console.log('PASS leaving and re-entering restores the actual local position')
  const quote = host.querySelector<HTMLButtonElement>('[aria-label="跳转到 quoted 的帖子 #8"]')!
  assert.ok(quote)
  await act(async () => { quote.click(); await flush() })
  await act(async () => { mock.timers.tick(80); await flush() })
  for (let number = 11; number <= 38; number++) assert.ok(host.querySelector(`[data-linuxdo-post-number="${number}"]`), 'quote jump must fill the merged window gap: ' + number)
  console.log('PASS quote jumps cannot permanently skip replies between merged windows')
  await close()
  rememberLinuxDoTopicPosition(100, 9, { postNumber: 41, offset: 110 })
  await render()
  await scroll(500)
  const afterIds = new URL(requests.findLast(url => url.includes('/posts.json'))!).searchParams.getAll('post_ids[]').map(Number)
  assert.equal(afterIds[0], 1044, 'downward pagination must continue after the opening window')
  await scroll(40)
  const beforeIds = new URL(requests.findLast(url => url.includes('/posts.json'))!).searchParams.getAll('post_ids[]').map(Number)
  assert.equal(beforeIds.at(-1), 1038, 'upward pagination must load the preceding context')
  assert.equal(scroller().scrollTop, 5360, 'prepending 38 floors must keep the previously visible floor at the same viewport offset')
  console.log('PASS long-thread pagination loads both directions and preserves the viewport')
  assert.deepEqual(adjacentLinuxDoPostIds(stream, [6, 7, 8, 9, 10, 39, 40, 41, 42, 43].map(number => ({ id: 1000 + number } as any)), 'after'),
    Array.from({ length: 28 }, (_, i) => 1011 + i), 'quote jump merges must fill internal gaps before advancing past the furthest window')
  await close()
  await render({ targetPostNumber: 8 })
  assert.equal(scroller().scrollTop, 340, 'explicit notification/search/bookmark floor must override stored position')
  assert.ok(host.querySelector('[data-linuxdo-post-number="8"]'))
  console.log('PASS explicit floor overrides automatic resume')
  await close()
  requests.length = 0
  await render({ session: { ...session, currentUser: { id: 10, username: 'other' } } })
  assert.ok(requests.includes('https://linux.do/t/test/100/81.json'), 'another account must not inherit account 9 local position')
  console.log('PASS accounts have separate local positions')
  await close()
  requests.length = 0
  await render({ session: { authenticated: false, authMode: 'none' } })
  assert.equal(requests[0], 'https://linux.do/t/test/100.json')
  assert.equal(scroller().scrollTop ?? 0, 0, 'guest must not consume authenticated server cursor')
  console.log('PASS first guest visit stays at the beginning')
  await close()
  const saved = JSON.stringify(Array.from(storage.entries()))
  fail = true
  await render()
  assert.ok(host.textContent?.includes('服务暂时不可用'), 'entry failure must be visible')
  await close()
  assert.equal(JSON.stringify(Array.from(storage.entries())), saved, 'failed entry must not erase an existing position')
  fail = false
  console.log('PASS failed requests preserve stored positions')
  delayTopic = 100
  await render()
  assert.ok(releaseResponse)
  await render({ summary: { ...props.summary, id: 200 } })
  await act(async () => { releaseResponse!(); await flush() })
  assert.ok(host.textContent?.includes('Position topic 200'))
  assert.ok(!host.textContent?.includes('Position topic 100'), 'late response from the abandoned topic must not replace the current one')
  console.log('PASS abandoned requests cannot restore a different topic')
  await close()
  storage.set('newsnook:linuxdo-topic-positions:v1', '{broken')
  assert.equal(linuxDoTopicPositionOf(100, 9), undefined, 'corrupt storage must degrade to server resume')
  storage.set('newsnook:linuxdo-topic-positions:v1', JSON.stringify({ '9:100': { postNumber: -1, offset: 'bad', updatedAt: 1 } }))
  assert.equal(linuxDoTopicPositionOf(100, 9), undefined, 'invalid position entries must be ignored')
  storage.set('newsnook:linuxdo-topic-positions:v1', JSON.stringify(Object.fromEntries(Array.from({ length: 240 }, (_, i) => [`9:${i}`, { postNumber: 2, offset: 0, updatedAt: i }]))))
  rememberLinuxDoTopicPosition(500, 9, { postNumber: 80, offset: 10 })
  const bounded = JSON.parse(storage.get('newsnook:linuxdo-topic-positions:v1')!)
  assert.equal(Object.keys(bounded).length, 240, 'persistent position table must stay bounded')
  assert.equal(linuxDoTopicPositionOf(0, 9), undefined, 'oldest position must be evicted')
  assert.equal(linuxDoTopicPositionOf(500, 9)?.postNumber, 80)
  console.log('PASS corrupt/invalid storage degrades safely and history remains bounded')
} finally {
  await act(async () => { root.unmount(); await flush() })
  mock.timers.reset()
}
console.log('linuxdo-topic-position-view: ok')
