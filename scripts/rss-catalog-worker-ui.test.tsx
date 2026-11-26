import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  React, IS_REACT_ACT_ENVIRONMENT: true })

const workerFeed = { id: 'sample', title: 'RSS 测试来源', url: 'https://example.org/feed', category: '新闻',
  language: 'zh', region: 'Global', tags: ['新闻'], aliases: [], nsfw: false }
const requested: Array<{ id: number; type: string; params?: { query?: string; limit?: number } }> = []
class FakeWorker {
  private listeners = new Map<string, Array<(event: unknown) => void>>()
  addEventListener(type: string, fn: (event: unknown) => void) {
    const old = this.listeners.get(type) ?? []
    old.push(fn)
    this.listeners.set(type, old)
  }
  postMessage(req: { id: number; type: string; params?: { query?: string; limit?: number } }) {
    requested.push(req)
    queueMicrotask(() => {
      const result = req.type === 'query'
        ? { total: req.params?.query ? 1 : 38957,
            feeds: [workerFeed], summary: { count: 38957, categories: [['新闻', 38957]], languages: ['zh'] } }
        : null
      for (const fn of this.listeners.get('message') ?? []) fn({ data: { type: 'result', id: req.id, result } })
    })
  }
}
Object.assign(globalThis, { Worker: FakeWorker })
const { createRoot } = await import('react-dom/client')
const { RssCatalogBrowser } = await import('../src/features/rssCatalog/RssCatalogBrowser')
const root = createRoot(document.getElementById('root')!)
try {
  await act(async () => {
    root.render(<RssCatalogBrowser onSelect={() => {}} duplicateLabel={() => null} />)
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
  assert.ok(requested.some((request) => request.type === 'query'),
    'the production UI must query the Web Worker instead of parsing all feeds on the UI thread')
  assert.ok(document.body.textContent?.includes('38,957'), 'display the full result count from worker metadata')
  assert.equal(document.querySelectorAll('[data-catalog-feed]').length, 1, 'UI receives only requested page')
  assert.ok(requested.some((request) => request.type === 'query' && request.params?.limit === 30))
  await act(async () => {
    const more = [...document.querySelectorAll('button')].find((button) => button.textContent === '加载更多')
    assert.ok(more, 'full results count must still permit pagination')
    more.click()
    await new Promise((resolve) => setTimeout(resolve, 5))
  })
  assert.ok(requested.some((request) => request.type === 'query' && request.params?.limit === 60),
    'load more asks the worker for the expanded bounded window')
} finally { await act(async () => root.unmount()) }
console.log('RSS catalog UI uses bounded off-main-thread feed windows: ok')
