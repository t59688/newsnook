import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { mock } from 'node:test'
import { Capacitor, registerPlugin } from '@capacitor/core'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement,
  DOMParser: window.DOMParser, NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: clearTimeout,
  ResizeObserver: class { observe() {} disconnect() {} },
})
window.requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0) as any
window.cancelAnimationFrame = clearTimeout as any
window.getComputedStyle = (() => ({ overflow: 'auto', overflowY: 'auto', getPropertyValue: () => '' })) as any
window.HTMLElement.prototype.getBoundingClientRect = function () {
  const post = Number(this.dataset.linuxdoPostNumber ?? 0)
  const top = post ? 50 + post * 120 : 0
  return { x: 0, y: top, top, bottom: post ? top + 90 : 600, left: 0, right: 400, width: 400, height: post ? 90 : 600, toJSON() {} }
}
Object.defineProperty(document, 'visibilityState', { value: 'visible' })
Object.assign(globalThis, { IntersectionObserver: class { constructor(private callback: () => void) {} observe() { queueMicrotask(() => this.callback()) } disconnect() {} } })

Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'
const currentUser = { id: 9, username: 'test-reader', name: 'Reader', trustLevel: 2 }
const session = { authenticated: true, authMode: 'browser-session' as const, currentUser }
const topic = { id: 100, slug: 'test', title: 'Read tracking', posts_count: 2, highest_post_number: 2, last_read_post_number: null,
  post_stream: { stream: [1001, 1002], posts: [1, 2].map(number => ({
    id: 1000 + number, topic_id: 100, post_number: number, username: 'someone', read: false,
    created_at: '2026-09-23T00:00:00Z', cooked: '<p>Visible comment.</p>', actions_summary: [],
  })) } }
let denied = false
let deniedCsrf = false
let firstPartyDenied = false
let postRequests = 0
let verificationRequests = 0
let verificationOptions: any
const native = {
  request: async (request: any) => {
    if (request.url.includes('/session/csrf')) return deniedCsrf
      ? { status: 403, data: '<html>challenge</html>', headers: { 'cf-mitigated': 'challenge' }, transport: 'native' }
      : { status: 200, data: '{"csrf":"test-token"}', transport: 'native' }
    if (request.url.endsWith('/topics/timings')) {
      postRequests++
      return denied ? { status: 403, data: '<html>challenge</html>', headers: { 'cf-mitigated': 'challenge', 'cf-ray': 'test-ray' }, transport: firstPartyDenied ? 'browser-firstparty' : 'browser' } : { status: 200, data: '', transport: 'browser' }
    }
    return { status: 200, data: JSON.stringify(topic) }
  },
  prepareBrowserSession: async () => ({ ready: false }),
  authenticate: async (options: any) => { verificationRequests++; verificationOptions = options; denied = false; return session },
}
registerPlugin('LinuxDoSession', { web: () => native, android: () => native })
const { createRoot } = await import('react-dom/client')
const { LinuxDoTopicView } = await import('../src/features/linuxdo/ui/ThreadViews')
const { AccountView } = await import('../src/features/linuxdo/ui/AccountView')
const { linuxDoApi } = await import('../src/features/linuxdo/runtime')
const noop = () => {}
const props: any = {
  summary: { id: 100, slug: 'test', title: 'Read tracking', replyCount: 1, views: 1, tags: [], posters: [] },
  session, categoriesById: { 1: { id: 1, name: 'Test' } }, overlayBackHandlerRef: { current: null },
  onBack: noop, onCompose: noop, onBoost: noop, onOpenUser: noop, onOpenTopic: noop, onOpenTag: noop, onEdit: noop,
  onSession: (next: any) => linuxDoApi.setSession(next),
}
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const advance = async (ms: number) => { await act(async () => { mock.timers.tick(ms); await flush() }) }
const unread = () => host.querySelectorAll('[aria-label^="帖子 #"][aria-label$=" 未读"]').length
mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 })
try {
  linuxDoApi.setSession(session as any)
  await act(async () => { root.render(<LinuxDoTopicView {...props} />); await flush() })
  await advance(0)
  assert.equal(unread(), 2)
  await advance(5000)
  assert.equal(postRequests, 1)
  assert.equal(unread(), 0, 'real TopicView must remove both blue dots only after the HTTP ACK')
  const fadedDots = Array.from(host.querySelectorAll<HTMLElement>('[data-linuxdo-unread-dot]'))
  assert.equal(fadedDots.length, 2, 'acknowledged dots should remain briefly renderable so opacity can animate instead of disappearing abruptly')
  assert.ok(fadedDots.every(dot => dot.className.includes('opacity-0')), 'acknowledged dots should fade to transparent after ACK')
  console.log('PASS real TopicView: successful ACK fades visible blue dots')

  await act(async () => { root.render(null); await flush() })
  denied = true; postRequests = 0
  linuxDoApi.setSession(session as any)
  await act(async () => { root.render(<LinuxDoTopicView {...props} />); await flush() })
  await advance(0); await advance(5000)
  assert.equal(unread(), 2, 'a challenged response must not erase unread state')
  const status = host.querySelector('[data-linuxdo-read-sync]')
  assert.ok(status, 'failed sync must remain visible, not vanish in a two-second toast')
  assert.match(status.textContent ?? '', /403/)
  assert.match(status.textContent ?? '', /\/topics\/timings/)
  assert.match(status.textContent ?? '', /browser/)
  console.log('PASS real TopicView: rejected POST leaves dots and persistent phase diagnosis')
  const verify = status.querySelector<HTMLButtonElement>('[data-read-sync-verify]')
  assert.ok(verify)
  await act(async () => { verify.click(); await flush() })
  assert.equal(verificationRequests, 1)
  assert.equal(unread(), 0, 'verifying the same account must resume the retained batch and clear dots')
  assert.equal(postRequests, 2, 'exactly one original attempt and one resumed attempt')
  console.log('PASS real TopicView: same-account in-app verification resumes the retained batch')
  await act(async () => { root.render(null); await flush() })
  denied = true; firstPartyDenied = true; postRequests = 0
  linuxDoApi.setSession(session as any)
  await act(async () => { root.render(<LinuxDoTopicView {...props} />); await flush() })
  await advance(0); await advance(5000)
  const firstPartyStatus = host.querySelector('[data-linuxdo-read-sync]')
  assert.match(firstPartyStatus?.textContent ?? '', /第一方页面中的提交请求/)
  assert.match(firstPartyStatus?.textContent ?? '', /不会弹出验证页/)
  assert.equal(unread(), 2)
  const firstPartyVerify = firstPartyStatus?.querySelector<HTMLButtonElement>('[data-read-sync-verify]')
  assert.ok(firstPartyVerify, 'a challenged POST needs a visible first-party POST navigation')
  await act(async () => { firstPartyVerify.click(); await flush() })
  assert.equal(verificationOptions?.readSyncChallenge, true)
  assert.equal(unread(), 0)
  console.log('PASS real TopicView: first-party challenge opens a visible POST verification and resumes retained timings')
  await act(async () => { root.render(null); await flush() })
  denied = false; firstPartyDenied = false
  deniedCsrf = true; postRequests = 0; linuxDoApi.setSession(session as any)
  await act(async () => { root.render(<LinuxDoTopicView {...props} />); await flush() })
  await advance(0); await advance(5000)
  assert.equal(postRequests, 0, 'a failed preflight means no timings POST was made')
  assert.equal(unread(), 2)
  const csrfStatus = host.querySelector('[data-linuxdo-read-sync]')
  assert.match(csrfStatus?.textContent ?? '', /GET \/session\/csrf/)
  assert.match(csrfStatus?.textContent ?? '', /获取写入会话/)
  console.log('PASS real TopicView: CSRF failure is identified before any timings POST')
  deniedCsrf = false
  let applied = false
  await act(async () => { root.render(<AccountView session={session as any} onSession={() => { applied = true }} onBookmarks={noop} onProfile={noop} onTrustLevel={noop} />); await flush() })
  const auxiliaryVerify = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.includes('打开 Linux.do 登录页面'))
  assert.ok(auxiliaryVerify)
  await act(async () => { auxiliaryVerify.click(); await flush() })
  assert.equal(applied, true, 'account verification must update the API/workspace session, not merely report success')
  console.log('PASS AccountView: browser verification applies the new session')
} finally {
  await act(async () => { root.unmount(); await flush() })
  mock.timers.reset()
}
console.log('linuxdo-readsync-view: 6 passed')
