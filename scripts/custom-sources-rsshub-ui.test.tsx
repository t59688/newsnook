import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
import type { NewsSource } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.defineProperty(window.document, 'oninput', { configurable: true, value: null })
window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  DOMParser: window.DOMParser, React, IS_REACT_ACT_ENVIRONMENT: true,
})
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
} })
const { createRoot } = await import('react-dom/client')
const { CustomSourcesScreen } = await import('../src/screens/settings/CustomSourcesScreen')
const root = createRoot(document.getElementById('root')!)
const route = '/jike/user/d03b9adf-3acb-46c0-8308-85195f22188f'
const logicalUrl = 'rsshub://' + route.slice(1)
const workingUrl = 'https://rsshub.stsecurity.moe' + route
const xml = '<rss version="2.0"><channel><title>即刻用户动态</title><item><title>最新动态</title><link>https://web.okjike.com/1</link></item></channel></rss>'
const attempted: string[] = []
const saved: Array<Pick<NewsSource, 'url' | 'name' | 'discovery'>> = []
let requests = 0
const props = {
  prefs: DEFAULT_PREFERENCES,
  onAddCustomSource: (value: NewsSource) => { saved.push(value) },
  onUpdateCustomSource: () => {}, onDeleteCustomSource: () => {}, onDeleteCustomSources: () => {},
  onMoveCustomSourcesToCategory: () => {}, onAddCustomSourcesToCategory: () => {}, onSetCustomSourcesPaused: () => {},
  onBatchImport: () => {}, onOpenFeedStore: () => {}, onBack: () => {},
}
function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label))
  assert.ok(match, 'missing ' + label)
  return match as HTMLButtonElement
}
async function click(el: HTMLElement): Promise<void> { await act(async () => { el.click() }) }
async function fill(value: string): Promise<void> {
  const input = document.querySelector('input[required]') as HTMLInputElement
  assert.ok(input, 'source URL input')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new window.Event('input', { bubbles: true, cancelable: true }))
    input.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true }))
  })
  assert.equal(input.value, value)
}
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async (input) => {
    requests++
    const requested = String(input)
    const wrapped = new URL(requested, 'https://news.example.net')
    const target = wrapped.searchParams.get('url') ?? requested
    attempted.push(target)
    assert.ok(!target.includes('rsshub://'), 'logical URI must not be sent to HTTP transport')
    if (target.includes('/jike/user/') && target.startsWith('https://rsshub.isrss.com')) return new Response('blocked', { status: 403 })
    if (target.includes('/jike/user/') && target.startsWith('https://rsshub.stsecurity.moe')) return new Response(xml)
    throw new Error('Unexpected request: ' + requested)
  }
  await act(async () => root.render(<CustomSourcesScreen {...props} />))
  await click(button('添加 RSS 源'))
  await fill(logicalUrl)
  await act(async () => { (document.querySelector('form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(saved.length, 0, 'RSSHub URI may not be saved before an available instance is verified')
  assert.ok(document.body.textContent?.includes('请先点击「探测」'))
  await act(async () => { button('探测').click(); await new Promise((resolve) => setTimeout(resolve, 80)) })
  assert.ok(attempted.includes(workingUrl), 'failed first instance should fall back to a working RSSHub instance')
  assert.equal((document.querySelector('input[required]') as HTMLInputElement).value, workingUrl)
  assert.equal((document.querySelector('input[placeholder^="如：少数派"]') as HTMLInputElement).value, '即刻用户动态')
  await act(async () => { (document.querySelector('form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(saved.length, 1)
  assert.equal(saved[0].url, workingUrl)
  assert.equal(saved[0].name, '即刻用户动态')
  assert.equal(saved[0].discovery?.generator, 'rsshub')
  assert.equal(saved[0].discovery?.routeKey, route)
  assert.equal(saved[0].discovery?.instanceId, 'stsecurity')
  assert.equal(saved[0].discovery?.verification?.status, 'verified')
  // Re-probing the resolved HTTPS URL must retain generator metadata.
  await click(button('添加 RSS 源'))
  await fill('rsshub://jike/user/%2e%2e/admin')
  const oldCount = requests
  await act(async () => { button('探测').click(); await new Promise((resolve) => setTimeout(resolve, 5)) })
  assert.equal(requests, oldCount, 'malformed route is rejected before HTTP fetch')
  assert.ok(document.body.textContent?.includes('路径') || document.body.textContent?.includes('路由'))
  await act(async () => { (document.querySelector('form') as HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })) })
  assert.equal(saved.length, 1, 'invalid logical URI must not be persisted')
} finally {
  globalThis.fetch = originalFetch
  await act(async () => root.unmount())
}
console.log('custom sources RSSHub URI UI: ok')
