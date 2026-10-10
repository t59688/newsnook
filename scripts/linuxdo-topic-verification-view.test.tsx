import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import { Capacitor } from '@capacitor/core'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, React,
  Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  HTMLImageElement: window.HTMLImageElement,
  DOMParser: window.DOMParser, NodeFilter: window.NodeFilter,
  MutationObserver: window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
  localStorage: { getItem: () => null, setItem: () => {} },
  ResizeObserver: class { observe() {} disconnect() {} },
})
window.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => callback(0), 0)) as any
window.cancelAnimationFrame = clearTimeout as any
window.getComputedStyle = (() => ({ overflowY: 'auto', getPropertyValue: () => '' })) as any
window.HTMLElement.prototype.scrollTop = 0
window.HTMLElement.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.getBoundingClientRect = function () {
  return { x: 0, y: 0, top: 0, bottom: 100, left: 0, right: 400, width: 400, height: 100, toJSON() {} }
}
Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'

const { createRoot } = await import('react-dom/client')
const { LinuxDoTopicView } = await import('../src/features/linuxdo/ui/ThreadViews')
const { linuxDoApi, linuxDoDiscovery, linuxDoTopics } = await import('../src/features/linuxdo/runtime')
const { LinuxDoApiError } = await import('../src/features/linuxdo/types')

const session: any = {
  authenticated: true, authMode: 'browser-session',
  currentUser: { id: 9, username: 'reader' },
}
linuxDoApi.setSession(session)
linuxDoDiscovery.categories = async () => []
let blocked = true
let requests = 0
const serverTopic: any = {
  id: 100, slug: 'test', title: 'Recovered topic', postsCount: 1,
  highestPostNumber: 1, lastReadPostNumber: 1,
  createdAt: '2026-10-01T00:00:00Z', lastPostedAt: '2026-10-01T00:00:00Z',
  tags: [], postStream: { stream: [1001], posts: [{
    id: 1001, postNumber: 1, username: 'author', createdAt: '2026-10-01T00:00:00Z',
    cooked: '<p>Recovered content</p>', read: true, actions: [],
  }] },
}
linuxDoTopics.get = async () => {
  requests++
  if (blocked) throw new LinuxDoApiError('browser-verification', 'Linux.do 需要浏览器安全验证', 403, undefined, {
    stage: 'request', method: 'GET', path: '/t/test/100.json', status: 403,
    transport: 'native', cfMitigated: 'challenge', cfRay: 'example-ray',
  })
  return serverTopic
}
const noop = () => {}
const host = document.createElement('div')
document.body.append(host)
const root = createRoot(host)
let complete = false
const verificationUrls: string[] = []
let accountChanges = 0
const flush = async () => { for (let i = 0; i < 45; i++) await Promise.resolve() }
const props: any = {
  summary: { id: 100, slug: 'test', title: 'Blocked topic', replyCount: 1, views: 2, tags: [], posters: [] },
  session, overlayBackHandlerRef: { current: null },
  onBack: noop, onCompose: noop, onBoost: noop, onOpenUser: noop, onOpenTopic: noop,
  onOpenTag: noop, onEdit: noop,
  onSession: () => { accountChanges++ },
  onVerify: async (options: any) => { verificationUrls.push(options?.url ?? ''); return complete },
}

try {
  await act(async () => { root.render(<LinuxDoTopicView {...props} />); await flush() })
  assert.equal(requests, 1)
  assert.ok(host.querySelector('[data-linuxdo-request-error]'), 'challenge must not be an inert text-only error')
  assert.match(host.textContent ?? '', /需要完成 Linux.do 安全验证/)
  const button = host.querySelector<HTMLButtonElement>('[data-linuxdo-verify]')
  assert.ok(button, 'topic error provides a visible shared security verification entry')
  assert.equal(button.getAttribute('aria-label'), '打开安全验证')

  await act(async () => { button.click(); await flush() })
  assert.deepEqual(verificationUrls, ['https://linux.do/t/test/100'])
  assert.equal(requests, 1, 'cancelling the challenge cannot replay the topic request')
  assert.ok(host.querySelector('[data-linuxdo-request-error]'))

  complete = true
  blocked = false
  const again = host.querySelector<HTMLButtonElement>('[data-linuxdo-verify]')
  assert.ok(again)
  await act(async () => { again.click(); await flush() })
  assert.equal(requests, 2, 'completing the first-party verification replays exactly the failed GET')
  assert.equal(host.querySelector('[data-linuxdo-request-error]'), null)
  assert.match(host.textContent ?? '', /Recovered topic/)
  assert.match(host.textContent ?? '', /Recovered content/)
  assert.equal(accountChanges, 0, 'clearance is not a login/logout operation')
  assert.equal(linuxDoApi.sessionSnapshot().currentUser?.id, 9)
  console.log('linuxdo-topic-verification-view: ok')
} finally {
  await act(async () => { root.unmount(); await flush() })
}
