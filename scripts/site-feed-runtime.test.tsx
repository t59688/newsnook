import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { NewsSource } from '../src/sources/registry'
const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const data = new Map<string, string>()
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true, localStorage: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key), key: (index: number) => [...data.keys()][index], get length() { return data.size } } })
const { createRoot } = await import('react-dom/client')
const { useFeeds } = await import('../src/hooks/useFeeds')
const { loadCachedList, LIST_CACHE_PREFIX } = await import('../src/lib/storage')
const { fetchSourcePrestoreCandidates } = await import('../src/features/prestore/sourceWindow')
const source: NewsSource = { id: 'custom_runtime', name: '运行站点', label: '运行', group: 'custom', kind: 'web-catalog', url: 'https://example.test/', enabled: true }
const sources = [source]
const ids = [source.id]
const automaticIds: string[] = []
let result: ReturnType<typeof useFeeds>
function Harness() { result = useFeeds(ids, undefined, sources, undefined, automaticIds); return null }
const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch
const requests: string[] = []
try {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://app.test/').searchParams.get('url')!
    requests.push(url)
    const page = url.includes('/page/3') ? 3 : url.includes('/page/2') ? 2 : 1
    const html = `<main><article><h2><a href="/posts/${page}">测试文章 ${page}</a></h2></article></main>`+(page < 3 ? `<a rel="next" href="/page/${page+1}">下一页</a>` : '')
    return new Response(html, { headers: { 'content-type': 'text/html' } })
  }
  await act(async () => { root.render(<Harness />) })
  await act(async () => { await result!.refresh(ids) })
  await act(async () => { await result!.loadMore(ids) })
  assert.equal(result!.articles.length, 2)
  await act(async () => { await result!.refresh(ids) })
  await act(async () => { await result!.loadMore(ids) })
  assert.equal(result!.articles.length, 3, 'refresh rewalk skips retained duplicate page and reaches older new page')
  assert.equal(requests.at(-1), 'https://example.test/page/3')
  assert.equal(result!.paginationState(ids), 'exhausted')
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
  assert.equal(loadCachedList(source.id)?.paging?.sourceVersion, 'catalog-v2:')
  const prestore = await fetchSourcePrestoreCandidates(source, 3, new AbortController().signal)
  assert.equal(prestore.length, 3, 'prestore follows observed pages with source identity')
  assert.ok(prestore.every((article) => article.sourceId === source.id && article.contentType === 'article'))
  await act(async () => { root.unmount() })
  const historical = { ...result!.articles[0], contentType: 'video' }
  const oldAt = Date.now() - 86400000
  data.set('newsnook:'+LIST_CACHE_PREFIX+source.id, JSON.stringify({ at: oldAt, items: [historical] }))
  const restoredRoot = createRoot(document.getElementById('root')!)
  await act(async () => { restoredRoot.render(<Harness />) })
  assert.equal(result!.articles[0].contentType, 'article', 'legacy all-video cache is repaired locally without network')
  assert.equal(result!.articles[0].id, historical.id)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)) })
  assert.equal(loadCachedList(source.id)?.cachedAt, oldAt, 'migration does not freshen stale data')
  await act(async () => { restoredRoot.unmount() })
} finally { globalThis.fetch = originalFetch }
console.log('site catalog feed runtime and prestore: ok')
