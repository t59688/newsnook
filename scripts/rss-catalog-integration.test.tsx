import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver, DOMParser: window.DOMParser, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { FeedStoreScreen } = await import('../src/screens/settings/FeedStoreScreen')
const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch
const calls: string[] = []
const ok = () => ({ ok: true })
let added = 0
let created = 0
try {
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    if (String(url).includes('news-update.aizeek.com')) throw new Error('offline')
    return new Response('<rss version="2.0"><channel><title>预览来源</title><item><title>最新文章</title></item></channel></rss>')
  }
  await act(async () => root.render(<FeedStoreScreen prefs={DEFAULT_PREFERENCES} currentCategoryId="cn-headlines" currentPresetId="test" currentPresetName="日常" enabledIds={[]} onSubscribe={() => { created++; return ok() }} onAddBuiltinToCategory={() => { added++; return ok() }} onPause={ok} onUpdateSubscription={ok} onDelete={ok} onOpenSource={() => {}} onBack={() => {}} />))
  assert.ok(document.querySelector('section[aria-label="RSS 目录"]'), 'the normal store entry opens the offline catalog')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)) })
  const first = document.querySelector('[data-catalog-feed]') as HTMLButtonElement
  assert.ok(first)
  await act(async () => first.click())
  const button = (text: string) => { const node = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === text); assert.ok(node, text); return node as HTMLButtonElement }
  await act(async () => button('检测与预览').click())
  assert.ok(document.body.textContent?.includes('最新文章'))
  await act(async () => button('订阅').click())
  assert.equal(created, 1, 'catalog entry creates a subscription through the existing action')
  assert.equal(added, 0, 'a new source is not mistaken for a built-in duplicate')
  assert.ok(document.body.textContent?.includes('订阅已保存'))
  assert.equal(calls.filter((url) => !url.includes('news-update.aizeek.com')).length, 1, 'browsing never fetches the upstream; only preview does')
} finally { globalThis.fetch = originalFetch; await act(async () => root.unmount()) }
console.log('rss catalog store entry and preview integration: ok')
