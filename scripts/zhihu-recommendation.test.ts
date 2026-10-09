import assert from 'node:assert/strict'

import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuRecommendationFeedbackService } from '../src/features/zhihu/feed/feedback'
import { ZhihuFeedService } from '../src/features/zhihu/feed/service'
import {
  clearZhihuRecommendationProfile,
  loadZhihuRecommendationProfile,
  rankZhihuLocalRecommendations,
  rankZhihuSmartRecommendations,
  recordZhihuRecommendationImpression,
  recordZhihuRecommendationSignal,
  type ZhihuRecommendationStorage,
} from '../src/features/zhihu/feed/recommendation'
import { ZhihuSmartRecommendationCoordinator } from '../src/features/zhihu/feed/smart'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import type { ZhihuRequest, ZhihuTransport } from '../src/features/zhihu/transport/types'
import type { ZhihuContentSummary } from '../src/features/zhihu/types'

function response(id: string, type: 'answer' | 'article', next?: string) {
  return {
    data: [{
      target: {
        type,
        id,
        title: `${id} title`,
        excerpt: `${id} excerpt`,
        voteup_count: id.includes('popular') ? 5000 : 20,
        created_time: 1_786_000_000,
        author: { id: `${id}-author`, url_token: `${id}-token`, name: `${id} author` },
      },
    }],
    paging: { is_end: !next, next },
  }
}

const calls: Array<{
  operation: string
  url: string
  headers?: Record<string, string>
  signing?: string
}> = []
const api = {
  async getJson(operation: string, url: string) {
    calls.push({ operation, url })
    if (operation === 'feed.recommended-web') {
      return response(
        url.includes('after=web-next') ? 'web-page-2' : 'web-page-1',
        'article',
        url.includes('after=web-next') ? undefined : 'https://www.zhihu.com/api/v3/feed/topstory/recommend?after=web-next',
      )
    }
    throw new Error(`unexpected ${operation}`)
  },
  async getJsonWithHeaders(
    operation: string,
    url: string,
    headers: Record<string, string>,
    _signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ) {
    calls.push({ operation, url, headers, signing: options?.signing })
    return response(
      url.includes('after=android-next') ? 'android-page-2' : 'android-page-1',
      'answer',
      url.includes('after=android-next') ? undefined : 'https://api.zhihu.com/topstory/recommend?after=android-next',
    )
  },
}

const service = new ZhihuFeedService(api)
const android = await service.listFeed('recommended', undefined, undefined, 'android')
assert.equal(android.items[0]?.recommendationSource, 'android')
assert.equal(calls[0]?.operation, 'feed.recommended')
assert.equal(calls[0]?.headers?.['x-api-version'], '3.1.8')
assert.equal(calls[0]?.signing, 'none', 'Android 推荐客户端不能误套 Web ZSE96')

calls.length = 0
const web = await service.listFeed('recommended', undefined, undefined, 'web')
assert.equal(web.items[0]?.recommendationSource, 'web')
assert.equal(calls[0]?.operation, 'feed.recommended-web')
assert.match(calls[0]?.url ?? '', /desktop=true/)

calls.length = 0
const mixedFirst = await service.listFeed('recommended', undefined, undefined, 'mixed')
assert.deepEqual(mixedFirst.items.map((item) => item.ref.id), ['android-page-1', 'web-page-1'])
assert.ok(mixedFirst.nextCursor?.startsWith('mixed:'), '混合推荐必须保存两路独立游标')
const mixedSecond = await service.listFeed('recommended', mixedFirst.nextCursor, undefined, 'mixed')
assert.deepEqual(mixedSecond.items.map((item) => item.ref.id), ['android-page-2', 'web-page-2'])
assert.equal(mixedSecond.hasMore, false)
assert.ok(calls.some((call) => call.url.includes('after=android-next')))
assert.ok(calls.some((call) => call.url.includes('after=web-next')))

function memoryStorage(): ZhihuRecommendationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
const preferred: ZhihuContentSummary = {
  ref: { kind: 'article', id: 'preferred' },
  title: '偏好文章',
  excerpt: '',
  url: 'https://zhuanlan.zhihu.com/p/preferred',
  author: { id: 'writer', token: 'writer-token', name: '常读作者' },
  voteupCount: 10,
  createdAt: 1_786_000_000,
}
const other: ZhihuContentSummary = {
  ref: { kind: 'answer', id: 'other' },
  title: '其它回答',
  excerpt: '',
  url: 'https://www.zhihu.com/answer/other',
  author: { id: 'other-writer', name: '其他作者' },
  voteupCount: 100,
  createdAt: 1_786_000_000,
}
recordZhihuRecommendationSignal('account-a', preferred, 'collect', storage, 1_786_100_000_000)
recordZhihuRecommendationSignal('account-a', preferred, 'follow-author', storage, 1_786_100_001_000)
const ranked = rankZhihuLocalRecommendations(
  [other, preferred],
  'account-a',
  storage,
  1_786_100_100_000,
)
assert.equal(ranked[0]?.ref.id, 'preferred')
assert.match(ranked[0]?.recommendationReason ?? '', /常读作者/)
assert.equal(ranked[0]?.recommendationSource, 'local')
assert.equal(loadZhihuRecommendationProfile('account-b', storage).totalSignals, 0, '画像必须按知乎账号隔离')
clearZhihuRecommendationProfile('account-a', storage)
assert.equal(loadZhihuRecommendationProfile('account-a', storage).totalSignals, 0, '用户必须能彻底清空本地画像')

const exposureStorage = memoryStorage()
const exposed: ZhihuContentSummary = {
  ref: { kind: 'answer', id: 'exposed' },
  title: '已经看过很多次的内容',
  excerpt: '',
  url: 'https://www.zhihu.com/question/1/answer/exposed',
  author: { id: 'same-author', name: '同一作者' },
  voteupCount: 100,
  createdAt: 1_786_100_000,
  recommendationSource: 'android',
}
const unseen: ZhihuContentSummary = {
  ...exposed,
  ref: { kind: 'answer', id: 'unseen' },
  title: '尚未曝光的内容',
  url: 'https://www.zhihu.com/question/2/answer/unseen',
}
recordZhihuRecommendationImpression('account-a', exposed, exposureStorage, 1_786_100_000_000)
recordZhihuRecommendationImpression('account-a', exposed, exposureStorage, 1_786_100_001_000)
assert.equal(
  loadZhihuRecommendationProfile('account-a', exposureStorage).impressions['answer:exposed']?.count,
  1,
  '短时间滚动抖动不能重复累计曝光次数',
)
const exposureRanked = rankZhihuSmartRecommendations(
  [exposed, unseen],
  'account-a',
  exposureStorage,
  1_786_100_002_000,
)
assert.equal(exposureRanked[0]?.ref.id, 'unseen', '24 小时内已充分曝光的内容必须明显降权')

const topicStorage = memoryStorage()
const topicSeed: ZhihuContentSummary = {
  ref: { kind: 'answer', id: 'topic-seed' },
  title: '储能电池系统如何做安全设计',
  excerpt: '讨论 BMS、电芯热管理和储能系统安全。',
  url: 'https://www.zhihu.com/question/10/answer/topic-seed',
  author: { id: 'topic-seed-author', name: '储能作者' },
  voteupCount: 100,
  createdAt: 1_786_100_000,
  recommendationSource: 'android',
}
const topicSimilar: ZhihuContentSummary = {
  ...topicSeed,
  ref: { kind: 'answer', id: 'topic-similar' },
  title: '储能电池系统的 BMS 与热管理怎么设计',
  excerpt: '电芯安全、BMS 和热管理实践。',
  url: 'https://www.zhihu.com/question/11/answer/topic-similar',
  author: { id: 'topic-similar-author', name: '另一位储能作者' },
}
const topicUnrelated: ZhihuContentSummary = {
  ...topicSeed,
  ref: { kind: 'answer', id: 'topic-unrelated' },
  title: '古典音乐中的弦乐四重奏应该怎么欣赏',
  excerpt: '讨论室内乐、作曲家和演奏版本。',
  url: 'https://www.zhihu.com/question/12/answer/topic-unrelated',
  author: { id: 'topic-unrelated-author', name: '音乐作者' },
}
recordZhihuRecommendationSignal('topic-account', topicSeed, 'collect', topicStorage, 1_786_100_000_000)
assert.ok(Object.keys(loadZhihuRecommendationProfile('topic-account', topicStorage).termScores).length > 0, '收藏必须学习内容主题，而不只学习作者/类型')
const topicRanked = rankZhihuSmartRecommendations(
  [topicUnrelated, topicSimilar],
  'topic-account',
  topicStorage,
  1_786_100_100_000,
)
assert.equal(topicRanked[0]?.ref.id, 'topic-similar', '本地主题兴趣应该提升相近内容')

const negativeStorage = memoryStorage()
const dislikedFootball: ZhihuContentSummary = {
  ...topicSeed,
  ref: { kind: 'answer', id: 'football-disliked' },
  title: '世界杯足球球队战术如何分析',
  excerpt: '讨论足球阵型、球队和世界杯比赛。',
  url: 'https://www.zhihu.com/question/20/answer/football-disliked',
  author: { id: 'football-author', name: '足球作者' },
}
const similarFootball: ZhihuContentSummary = {
  ...dislikedFootball,
  ref: { kind: 'answer', id: 'football-similar' },
  title: '世界杯足球比赛中的阵型与战术',
  url: 'https://www.zhihu.com/question/21/answer/football-similar',
  author: { id: 'other-football-author', name: '另一位足球作者' },
}
recordZhihuRecommendationSignal('negative-account', dislikedFootball, 'not-interested', negativeStorage, 1_786_100_000_000)
const excludedRanked = rankZhihuSmartRecommendations(
  [dislikedFootball, topicUnrelated],
  'negative-account',
  negativeStorage,
  1_786_100_100_000,
)
assert.ok(!excludedRanked.some((item) => item.ref.id === 'football-disliked'), '30 天内明确“不感兴趣”的同一实体必须硬排除')
const negativeRanked = rankZhihuSmartRecommendations(
  [similarFootball, topicUnrelated],
  'negative-account',
  negativeStorage,
  1_786_100_100_000,
)
assert.equal(negativeRanked[0]?.ref.id, 'topic-unrelated', '不感兴趣必须压低相似主题，而不是只隐藏当前实体')

recordZhihuRecommendationSignal('author-account', dislikedFootball, 'less-author', negativeStorage, 1_786_100_200_000)
const sameAuthor = { ...topicUnrelated, ref: { kind: 'answer' as const, id: 'same-author-next' }, author: dislikedFootball.author }
const otherAuthor = { ...topicUnrelated, ref: { kind: 'answer' as const, id: 'other-author-next' }, author: { id: 'neutral-author', name: '中立作者' } }
const authorRanked = rankZhihuSmartRecommendations(
  [sameAuthor, otherAuthor],
  'author-account',
  negativeStorage,
  1_786_100_300_000,
)
assert.equal(authorRanked[0]?.ref.id, 'other-author-next', '少推荐此作者必须只针对作者形成明显负向信号')

const smartCalls: Array<{ source: string; cursor?: string }> = []
const smartCoordinator = new ZhihuSmartRecommendationCoordinator({
  async fetch(source, cursor) {
    smartCalls.push({ source, cursor })
    const page = cursor ? 2 : 1
    const items = Array.from({ length: 20 }, (_, index): ZhihuContentSummary => ({
      ref: { kind: index % 3 === 0 ? 'article' : 'answer', id: `${source}-${page}-${index}` },
      title: `${source} page ${page} item ${index}`,
      excerpt: '',
      url: `https://www.zhihu.com/${source}/${page}/${index}`,
      author: { id: `${source}-author-${index % 7}`, name: `${source} author ${index % 7}` },
      voteupCount: 50 + index,
      createdAt: 1_786_100_000 - index,
      recommendationSource: source === 'hot' ? 'hot' : source === 'web' ? 'web' : 'android',
    }))
    return {
      items,
      nextCursor: cursor ? undefined : `https://example.test/${source}/page-2`,
      hasMore: !cursor,
    }
  },
})
const smart1 = await smartCoordinator.list(undefined, undefined, null)
const smart2 = await smartCoordinator.list(smart1.nextCursor, undefined, null)
const smart3 = await smartCoordinator.list(smart2.nextCursor, undefined, null)
assert.equal(smartCalls.length, 3, '候选充足时首屏只并行请求三路第一页，不应过度补抓')
assert.equal(new Set([...smart1.items, ...smart2.items, ...smart3.items].map((item) => item.ref.id)).size, 60)
const stablePrefix = [...smart1.items, ...smart2.items, ...smart3.items].map((item) => item.ref.id)
const smart4 = await smartCoordinator.list(smart3.nextCursor, undefined, null)
assert.equal(smartCalls.length, 6, '消费完首轮候选后才继续三路各自游标')
assert.ok(smart4.items.every((item) => item.ref.id.includes('-2-')), '续载只能向稳定前缀尾部追加新候选')
assert.equal(new Set(stablePrefix).size, stablePrefix.length, '稳定前缀本身必须完全去重')

const feedbackRequests: ZhihuRequest[] = []
const feedbackTransport: ZhihuTransport = {
  async request(input) {
    feedbackRequests.push(input)
    return { status: 204, headers: {}, body: '' }
  },
}
const feedbackSession = new ZhihuSessionService()
feedbackSession.switchAccount({ id: 'feedback-account', name: '反馈测试账号' }, 'authenticated')
const feedbackApi = new ZhihuApiClient(feedbackTransport, feedbackSession)
const feedback = new ZhihuRecommendationFeedbackService(feedbackApi, feedbackSession)
feedback.recordImpression('feedback-account', unseen)
await feedback.flushImpressions()
assert.equal(feedbackRequests[0]?.operation, 'feed.lastread.touch')
assert.match(feedbackRequests[0]?.body ?? '', /"touch"/, '真实曝光必须批量回传 touch')
assert.match(feedbackRequests[0]?.headers?.['Content-Type'] ?? '', /^multipart\/form-data; boundary=/)
feedback.recordRead('feedback-account', unseen)
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(feedbackRequests[1]?.operation, 'feed.lastread.touch')
assert.match(feedbackRequests[1]?.body ?? '', /"read"/, '真正打开内容必须回传 read')
feedback.dispose()

console.log('zhihu recommendation modes contract ok')
