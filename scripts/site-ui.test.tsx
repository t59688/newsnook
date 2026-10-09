import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { Article } from '../src/lib/types'
import type { NewsSource } from '../src/sources/registry'
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { SiteScreen } = await import('../src/screens/SiteScreen')
const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch
const source: NewsSource = { id: 'custom_ui', name: '通用站', label: '通用站', url: 'https://example.test/', group: 'custom', kind: 'web-catalog', enabled: true }
const requests: string[] = []
let fail = false
let opened: Article | undefined
const card = (id: number) => `<main><article><h2><a href="/posts/${id}">测试条目 ${id}</a></h2></article></main>`
function button(label: string): HTMLButtonElement { const match = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(label)); assert.ok(match, label); return match as HTMLButtonElement }
try {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://app.test/').searchParams.get('url')!
    requests.push(url)
    if (fail) return new Response('failure', { status: 503 })
    return new Response(url.includes('/page/2') ? card(2) : card(1)+'<nav><a href="/category/news/">新闻</a></nav><a rel="next" href="/page/2">下一页</a>', { headers: { 'content-type': 'text/html' } })
  }
  await act(async () => { root.render(<SiteScreen sites={[{ source }]} readIds={new Set()} onOpen={(article) => { opened = article }} />) })
  assert.ok(document.body.textContent?.includes('测试条目 1'), 'unknown CMS still browsable')
  await act(async () => { button('下一页').click() })
  assert.deepEqual(requests, [source.url, 'https://example.test/page/2'])
  assert.ok(document.body.textContent?.includes('测试条目 2'))
  await act(async () => { button('测试条目 2').click() })
  assert.equal(opened?.sourceId, source.id)
  fail = true
  await act(async () => { button('新闻').click() })
  assert.ok(document.body.textContent?.includes('HTTP 503'))
  assert.ok(document.body.textContent?.includes('测试条目 2'), 'failure retains successful contents')
  fail = false
  await act(async () => { button('重试').click() })
  assert.equal(requests.at(-1), 'https://example.test/category/news/', 'retry repeats failed request')
  await act(async () => { button('测试条目 1').click() })
  assert.equal(opened?.sourceId, source.id, 'category does not change article source identity')
} finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch }
console.log('site catalog UI: ok')
