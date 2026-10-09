import assert from 'node:assert/strict'

import {
  bodyCacheStats,
  clearBodyCache,
  hasCachedBody,
  listCachedArticles,
  loadCachedBody,
  saveCachedBody,
  syncBodyPins,
} from '../src/lib/bodyCache'
import {
  clearListCache,
  LIST_CACHE_PREFIX,
  listCacheStats,
  loadLaterArticles,
  loadCachedList,
  readRaw,
  saveCachedArticles,
  saveLaterArticles,
} from '../src/lib/storage'
import type { Article } from '../src/lib/types'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
})

let clock = 1_800_000_000_000
const realDateNow = Date.now
Date.now = () => {
  clock += 1
  return clock
}

function article(id: string, contentHtml?: string): Article {
  return {
    id,
    title: `标题 ${id}`,
    summary: `摘要 ${id}`,
    contentHtml,
    publishedAt: clock,
    hasRealDate: true,
    sourceId: 'test-source',
    sourceName: '测试来源',
    sourceLabel: '测试',
    sourceGroup: 'cn',
    originUrl: `https://example.com/${id}`,
    contentType: 'article',
  }
}

function save(articleValue: Article, html = `<p>${articleValue.title}</p>`): void {
  assert.equal(
    saveCachedBody(articleValue, { html, bodySource: 'feed' }),
    true,
    `正文 ${articleValue.id} 应写入成功`,
  )
}

try {
  const first = article('first')
  save(first)
  assert.equal(loadCachedBody(first.id)?.html, '<p>标题 first</p>')
  assert.equal(listCachedArticles()[0]?.article.id, first.id)

  const pinned = article('pinned')
  const ordinary = article('ordinary')
  save(pinned)
  save(ordinary)
  syncBodyPins(new Set([pinned.id]))
  clearBodyCache({ includePinned: false })
  assert.equal(hasCachedBody(pinned.id), true, '普通清理必须保留稍后读正文')
  assert.equal(hasCachedBody(first.id), false)
  assert.equal(hasCachedBody(ordinary.id), false)
  assert.deepEqual(bodyCacheStats(), {
    count: 1,
    bytes: bodyCacheStats().bytes,
    pinned: 1,
    pinnedBytes: bodyCacheStats().bytes,
  })

  // 删除索引模拟 Android WebView 在配额边缘只落下正文的情况，统计应从真实键恢复。
  localStorage.removeItem('newsnook:body:index')
  assert.equal(bodyCacheStats().count, 1)
  assert.equal(listCachedArticles()[0]?.article.id, pinned.id)
  syncBodyPins(new Set([pinned.id]))

  // 超过 3MB 时按 LRU 淘汰，固定正文最后才动。
  const largeHtml = `<p>${'正'.repeat(420_000)}</p>`
  for (const id of ['large-1', 'large-2', 'large-3', 'large-4']) {
    save(article(id), largeHtml)
  }
  assert.equal(hasCachedBody(pinned.id), true, '固定正文应优先保留')
  assert.ok(bodyCacheStats().bytes <= 3 * 1024 * 1024)

  const feedArticle = article('feed-full', '<p>不应进入列表缓存的全文</p>')
  saveCachedArticles('test-source', [feedArticle], { cursor: '20260801', page: 2 })
  const cachedList = loadCachedList('test-source')
  assert.equal(cachedList?.items[0]?.contentHtml, undefined)
  assert.deepEqual(cachedList?.paging, { cursor: '20260801', page: 2 })
  assert.equal(
    readRaw(`${LIST_CACHE_PREFIX}test-source`)?.includes('不应进入列表缓存的全文'),
    false,
  )
  assert.equal(listCacheStats().count, 1)

  saveLaterArticles([feedArticle])
  assert.equal(loadLaterArticles()[0]?.contentHtml, undefined)
  assert.equal(readRaw('later-items')?.includes('不应进入列表缓存的全文'), false)

  clock += 1000 * 60 * 60 * 24 * 8
  assert.equal(loadCachedList('test-source'), null, '超过七天的列表缓存应自动删除')
  assert.deepEqual(listCacheStats(), { count: 0, bytes: 0 })

  saveCachedArticles('test-source', [feedArticle])
  clearListCache()
  clearBodyCache({ includePinned: true })
  assert.deepEqual(listCacheStats(), { count: 0, bytes: 0 })
  assert.deepEqual(bodyCacheStats(), { count: 0, bytes: 0, pinned: 0, pinnedBytes: 0 })

  console.log('cache behavior tests passed')
} finally {
  Date.now = realDateNow
}
