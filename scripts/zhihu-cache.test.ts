import assert from 'node:assert/strict'

import { loadZhihuPublicFeedCache, saveZhihuPublicFeedCache, type ZhihuPublicCacheStorage } from '../src/features/zhihu/storage/cache'

function memoryStorage(): ZhihuPublicCacheStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
const page = {
  items: [{
    ref: { kind: 'answer' as const, id: '1' },
    title: '公开回答',
    excerpt: '公开摘要',
    url: 'https://www.zhihu.com/question/1/answer/1',
  }],
  nextCursor: 'https://api.zhihu.com/topstory/recommend?after_id=next',
  hasMore: true,
}

saveZhihuPublicFeedCache('recommended', page, storage, 1_000)
assert.deepEqual(loadZhihuPublicFeedCache('recommended', storage, 2_000), page)

const androidCacheKey = [...storage.values.keys()].find((key) => key.endsWith(':recommended:android'))
assert.ok(androidCacheKey)
const legacyEnvelope = JSON.parse(storage.values.get(androidCacheKey!)!) as { version: number }
legacyEnvelope.version = 1
storage.values.set(androidCacheKey!, JSON.stringify(legacyEnvelope))
assert.equal(loadZhihuPublicFeedCache('recommended', storage, 2_000), null, '旧版可能含已四舍五入 19 位 ID 的缓存必须淘汰')
assert.equal(storage.values.has(androidCacheKey!), false)
saveZhihuPublicFeedCache('recommended', page, storage, 1_000)

saveZhihuPublicFeedCache('following', page, storage, 1_000)
assert.equal([...storage.values.keys()].some((key) => key.endsWith(':following')), false, '账号关注流不得进入公共 localStorage 缓存')
assert.equal(loadZhihuPublicFeedCache('following', storage, 2_000), null)

const beforeLocal = storage.values.size
saveZhihuPublicFeedCache('recommended', page, storage, 1_000, 'local')
assert.equal(storage.values.size, beforeLocal, '本地画像衍生排序不得进入公共 feed cache')
assert.equal(loadZhihuPublicFeedCache('recommended', storage, 2_000, 'local'), null)

saveZhihuPublicFeedCache('recommended', page, storage, 1_000, 'web')
saveZhihuPublicFeedCache('recommended', page, storage, 1_000, 'mixed')
assert.ok([...storage.values.keys()].some((key) => key.endsWith(':recommended:web')))
assert.ok([...storage.values.keys()].some((key) => key.endsWith(':recommended:mixed')))

assert.equal(loadZhihuPublicFeedCache('recommended', storage, 9 * 24 * 60 * 60 * 1000), null, '过期公开缓存必须丢弃')

console.log('zhihu public cache boundary ok')
