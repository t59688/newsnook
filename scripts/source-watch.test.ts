import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Article } from '../src/lib/types'
import { reconcileWatchArticles, watchArticleKey } from '../src/features/sourceWatch/store'

const base = { rules: [{ sourceId: 'openai-news', mode: 'instant' as const, enabled: true }], events: [], cursors: {}, lastChecked: {}, intervalMinutes: 60, quietHours: true, wifiOnly: false }
const article = (id: string): Article => ({ id, title: 'Article '+id, summary: '', publishedAt: 1760000000, hasRealDate: true, sourceId: 'openai-news', sourceName: 'OpenAI News', sourceLabel: 'OpenAI', sourceGroup: 'ai', originUrl: 'https://openai.com/news/'+id })
test('initial scan establishes baseline without notifications', () => {
  const { next, added } = reconcileWatchArticles(base, 'openai-news', [article('a'), article('b')], 1000)
  assert.equal(added.length, 0)
  assert.equal(next.cursors['openai-news'].length, 2)
  assert.equal(next.lastChecked['openai-news'], 1000)
})
test('subsequent scan inserts only unseen items and deduplicates', () => {
  const first = reconcileWatchArticles(base, 'openai-news', [article('a')], 1000).next
  const { next, added } = reconcileWatchArticles(first, 'openai-news', [article('b'), article('a')], 2000)
  assert.equal(added.length, 1)
  assert.equal(added[0].article.id, 'b')
  assert.equal(reconcileWatchArticles(next, 'openai-news', [article('b'), article('a')], 3000).added.length, 0)
})
test('canonicalized article key excludes fragment and trailing slash', () => {
  const a = article('c')
  assert.equal(watchArticleKey({ ...a, originUrl: a.originUrl + '/#reader' }), watchArticleKey(a))
})
test('only the current source cursor changes', () => {
  const first = { ...base, cursors: { other: ['other:foo'] } }
  assert.deepEqual(reconcileWatchArticles(first, 'openai-news', [article('a')], 1000).next.cursors.other, ['other:foo'])
})

test('foreground parsing hydrates a native title-only entry without a second notification', () => {
  const parsed = { ...article('richer'), image: 'https://openai.com/cover.webp', summary: 'New details from the original feed', publishedAt: 1760000100, hasRealDate: true }
  const key = watchArticleKey(parsed)
  const native = { ...parsed, id: key, summary: '', image: undefined, hasRealDate: false, publishedAt: 2000 }
  const initial = { ...base, cursors: { 'openai-news': [key] }, events: [{ key, sourceId: 'openai-news', article: native, discoveredAt: 2000, read: true }] }
  const { next, added } = reconcileWatchArticles(initial, 'openai-news', [parsed], 3000)
  assert.equal(added.length, 0)
  assert.equal(next.events.length, 1)
  assert.equal(next.events[0].read, true)
  assert.equal(next.events[0].article.id, parsed.id)
  assert.equal(next.events[0].article.image, parsed.image)
  assert.equal(next.events[0].article.summary, parsed.summary)
  assert.equal(next.events[0].article.publishedAt, parsed.publishedAt)
})
