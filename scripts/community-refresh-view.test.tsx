import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { Capacitor, registerPlugin } from '@capacitor/core'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement, React, IS_REACT_ACT_ENVIRONMENT: true })
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as any
window.cancelAnimationFrame = clearTimeout as any
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any
window.getComputedStyle = (() => ({ transform: 'none', getPropertyValue: () => '' })) as any
Capacitor.isNativePlatform = () => false
Capacitor.getPlatform = () => 'android'
let requestNetwork: (request: any) => Promise<any> = async () => { throw new Error('unexpected native request') }
const nativeBoundary = { request: (request: any) => requestNetwork(request) }
registerPlugin('LinuxDoSession', { android: () => nativeBoundary, web: () => nativeBoundary })
const { createRoot } = await import('react-dom/client')
const { DiscoverView } = await import('../src/features/linuxdo/ui/DiscoverView')
const { NotificationsView } = await import('../src/features/linuxdo/ui/CommunityViews')
const { LeadStory } = await import('../src/components/ArticleItem')
const { createLinuxDoDiscoveryCache } = await import('../src/features/linuxdo/ui/discoveryCache')
const { linuxDoApi, linuxDoDiscovery, linuxDoNotifications } = await import('../src/features/linuxdo/runtime')
const { LinuxDoWorkspace } = await import('../src/features/linuxdo/ui/LinuxDoWorkspace')
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const noop = () => {}
let fail = true
linuxDoDiscovery.categories = async () => { if (fail) throw new Error('offline'); return [{ id: 1, slug: 'test', name: 'Recovered' }] }
linuxDoDiscovery.tags = async () => { if (fail) throw new Error('offline'); return [{ name: 'recovered', topicCount: 1 }] }
await act(async () => { root.render(<DiscoverView onOpen={noop} onScopeChange={noop} cacheRef={{ current: createLinuxDoDiscoveryCache() }} />); await flush() })
assert.ok(host.textContent?.includes('offline'), 'discovery failure must be visible in the default tab')
fail = false
const click = async (label: string) => {
  const button = host.querySelector(`[aria-label="${label}"]`)
  assert.ok(button, `missing refresh action: ${label}`)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}
await click('刷新发现')
assert.ok(host.textContent?.includes('Recovered'), 'refresh must recover the failed taxonomy without remounting')
assert.ok(!host.textContent?.includes('offline'))
await act(async () => { root.render(null); await flush() })
const session: any = { authenticated: true, authMode: 'browser-session', currentUser: { username: 'reader', id: 1 } }
let notificationTitle = 'Before refresh'
linuxDoNotifications.list = async () => ({ items: [{ id: 1, notificationType: 1, read: true, createdAt: '2026-10-03', data: { topic_title: notificationTitle } }], nextOffset: undefined }) as any
linuxDoNotifications.unreadCount = async () => 0
await act(async () => { root.render(<React.StrictMode><NotificationsView session={session} onOpen={noop} onOpenUser={noop} onUnreadChange={noop} /></React.StrictMode>); await flush() })
notificationTitle = 'After refresh'
await click('刷新通知')
assert.ok(host.textContent?.includes('After refresh'), 'notifications must fetch server truth on explicit refresh')
notificationTitle = 'Pulled refresh'
const notificationScroller = host.querySelector('.overflow-y-auto') as HTMLElement
notificationScroller.scrollTop = 0
const touch = async (name: string, y: number) => {
  const event = new window.Event(name, { bubbles: true, cancelable: true })
  Object.assign(event, { touches: name === 'touchend' ? [] : [{ clientX: 100, clientY: y }] })
  await act(async () => { notificationScroller.dispatchEvent(event); await flush() })
}
await touch('touchstart', 0)
await touch('touchmove', 200)
await touch('touchend', 200)
assert.ok(host.textContent?.includes('Pulled refresh'), 'touch pull must use the same notification refresh pipeline')
let privateTitle = 'Private before'
linuxDoNotifications.privateMessages = async () => ({ items: [{ id: 7, slug: 'private', title: privateTitle, tags: [], posters: [] }], nextPage: undefined }) as any
await act(async () => { Array.from(host.querySelectorAll('button')).find((button) => button.textContent === '私信')!.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
privateTitle = 'Private after'
await click('刷新私信')
assert.ok(host.textContent?.includes('Private after'), 'private refresh must reload conversations while keeping the private tab')
await act(async () => { root.render(null); await flush() })
const article: any = { id: 'news', sourceId: 'test', title: 'A hero', link: 'https://example.org/news', image: 'broken:cover', publishedAt: Date.now() }
await act(async () => { root.render(<LeadStory article={article} read={false} saved={false} onOpen={noop} variant="lead" />); await flush() })
const hero = host.querySelector('.lead-hero')!
await act(async () => { host.querySelector('img')!.dispatchEvent(new window.Event('error')); await flush() })
assert.ok(hero.querySelector('.h-\\[13\\.75rem\\]'), 'failed hero image must retain its full-height frame')
await act(async () => { root.render(null); await flush() })

// No animation frames are flushed: returning must restore content and scroll before paint.
const frames: FrameRequestCallback[] = []
window.requestAnimationFrame = (cb: FrameRequestCallback) => { frames.push(cb); return frames.length }
window.HTMLElement.prototype.scrollTo = function (options: any) { this.scrollTop = options.top ?? 0 }
const page = (mode: string) => ({ users: [], topic_list: { topics: [{ id: mode === 'hot' ? 2 : 1, slug: mode, title: `channel-${mode}`, posts_count: 1, tags: [], posters: [] }] } })
const feedRequests: string[] = []
let releaseHot: (() => void) | undefined
linuxDoApi.restore = async () => { linuxDoApi.setSession(session); return session }
// Exercise the real API client and feed decoder, substituting only the native network boundary.
Capacitor.isNativePlatform = () => true
let failUnread = true
requestNetwork = async ({ url, headers }: any) => {
  const path = new URL(url).pathname
  if (path.startsWith('/t/')) return { status: 404, data: '{"errors":["not found"]}', transport: 'browser' }
  assert.equal(headers['Discourse-Logged-In'], 'true', 'feed reads must use the authenticated browser session')
  assert.equal(headers['User-Api-Key'], undefined, 'the OTP exchange credential must not be used for ordinary feed reads')
  const mode = path.slice(1).replace('.json', '')
  feedRequests.push(mode)
  if (mode === 'hot') await new Promise<void>((resolve) => { releaseHot = resolve })
  if (mode === 'unread' && failUnread) return { status: 403, data: '<html><title>Just a moment...</title></html>', headers: { 'cf-mitigated': 'challenge' }, transport: 'browser' }
  return { status: 200, data: JSON.stringify(page(mode)), headers: { 'content-type': 'application/json' }, transport: 'browser' }
}
const backHandlerRef = { current: null } as any
await act(async () => { root.render(<LinuxDoWorkspace onExit={noop} backHandlerRef={backHandlerRef} presetSwitcher={{ activeName: 'Test', items: [], onSelect: noop, onManage: noop }} />); await flush() })
const clickText = async (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find((el) => el.textContent === label)
  assert.ok(button, `missing channel ${label}`)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}
await clickText('热门')
await clickText('新')
await act(async () => { releaseHot?.(); await flush() })
assert.ok(host.textContent?.includes('channel-new'), 'late hot result must not overwrite the new channel')
await clickText('未读')
assert.ok(host.textContent?.includes('安全验证'), 'a rejected browser read must display a recoverable error rather than stale channel content')
failUnread = false
await click('刷新')
assert.ok(host.textContent?.includes('channel-unread'))
await clickText('最新')
assert.ok(['latest', 'hot', 'new', 'unread'].every((mode) => feedRequests.includes(mode)), 'each channel must send its own server request')
let scroller = host.querySelector('.overflow-y-auto.page-x') as HTMLElement
assert.ok(scroller)
scroller.scrollTop = 420
await act(async () => { scroller.dispatchEvent(new window.Event('scroll')); await flush() })
await click('打开主题：channel-latest')
assert.ok(!host.querySelector('[aria-label="打开主题：channel-latest"]'), 'opening a topic must leave the feed surface')
await act(async () => { backHandlerRef.current(); await flush() })
scroller = host.querySelector('.overflow-y-auto.page-x') as HTMLElement
assert.equal(scroller.scrollTop, 420, 'cached feed must restore its scroll before the next frame')
assert.ok(host.textContent?.includes('channel-latest'))
await act(async () => { root.unmount(); await flush() })
console.log('community-refresh-view: ok')
