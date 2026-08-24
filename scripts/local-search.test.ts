import assert from 'node:assert/strict'

import {
  LOCAL_SEARCH_ORIGIN_LABELS,
  buildLocalSearchCorpus,
  normalizeSearchQuery,
  searchLocalArticles,
} from '../src/lib/localSearch'
import type { Article } from '../src/lib/types'

console.log('Testing local offline search...')

function article(patch: Partial<Article> & Pick<Article, 'id' | 'title'>): Article {
  return {
    summary: '',
    publishedAt: 1_700_000_000_000,
    hasRealDate: true,
    sourceId: 'demo',
    sourceName: '示例信源',
    sourceLabel: '示例',
    sourceGroup: 'cn',
    originUrl: `https://example.com/${patch.id}`,
    ...patch,
  }
}

const feed = [
  article({ id: 'a1', title: '国产大模型价格战再起', summary: '多家厂商同时下调推理价格' }),
  article({ id: 'a2', title: '欧洲央行维持利率不变', summary: '通胀回落但仍高于目标' }),
  article({
    id: 'a3',
    title: 'Rust 1.90 发布',
    summary: 'Async trait 稳定化',
    sourceName: 'Hacker News',
    sourceLabel: 'HN',
    publishedAt: 1_700_000_500_000,
  }),
]
const later = [article({ id: 'a4', title: '如何读懂财报里的现金流', summary: '一份实用清单' })]
const history = [
  article({ id: 'a1', title: '国产大模型价格战再起', summary: '多家厂商同时下调推理价格' }),
  article({ id: 'a5', title: '大模型推理成本拆解', summary: '显存与吞吐的取舍' }),
]

// 1. 语料合并按 id 去重，稍后读/历史的来源标记优先于泛列表
const corpus = buildLocalSearchCorpus({ feed, later, history })
assert.equal(corpus.length, 5)
assert.equal(corpus.find((entry) => entry.article.id === 'a1')?.origin, 'history')
assert.equal(corpus.find((entry) => entry.article.id === 'a4')?.origin, 'later')
assert.equal(corpus.find((entry) => entry.article.id === 'a2')?.origin, 'feed')

// 2. 空查询不返回任何东西，避免一进页面就把整个语料倒出来
assert.equal(searchLocalArticles(corpus, '').length, 0)
assert.equal(searchLocalArticles(corpus, '   ').length, 0)

// 3. 中文子串匹配（无需分词）
const modelHits = searchLocalArticles(corpus, '大模型')
assert.equal(modelHits.length, 2)
assert.ok(modelHits.every((hit) => hit.matchedTitle))

// 4. 摘要命中也算，但排在标题命中之后
const cashHits = searchLocalArticles(corpus, '现金流')
assert.equal(cashHits.length, 1)
assert.equal(cashHits[0].article.id, 'a4')

const inflationHits = searchLocalArticles(corpus, '通胀')
assert.equal(inflationHits.length, 1)
assert.equal(inflationHits[0].matchedTitle, false)
assert.equal(inflationHits[0].matchedSummary, true)

// 5. 多片段是 AND：两个片段都要命中同一篇
assert.equal(searchLocalArticles(corpus, '大模型 价格').length, 1)
assert.equal(searchLocalArticles(corpus, '大模型 欧洲').length, 0)

// 6. 大小写无关，且能按信源名找
assert.equal(searchLocalArticles(corpus, 'rust').length, 1)
const sourceHits = searchLocalArticles(corpus, 'hacker')
assert.equal(sourceHits.length, 1)
assert.equal(sourceHits[0].matchedSource, true)
assert.equal(sourceHits[0].matchedTitle, false)

// 7. 标题命中排在摘要命中前面
const inferenceHits = searchLocalArticles(corpus, '推理')
assert.equal(inferenceHits.length, 2)
assert.equal(inferenceHits[0].article.id, 'a5')
assert.equal(inferenceHits[0].matchedTitle, true)

// 8. 来源过滤
const laterOnly = searchLocalArticles(corpus, '财报', { origins: ['later'] })
assert.equal(laterOnly.length, 1)
assert.equal(searchLocalArticles(corpus, '财报', { origins: ['feed'] }).length, 0)

// 9. 结果数上限
const bulk = Array.from({ length: 200 }, (_, index) =>
  article({ id: `bulk-${index}`, title: `重复标题 ${index}` }),
)
const bulkResults = searchLocalArticles(buildLocalSearchCorpus({ feed: bulk }), '重复标题', {
  limit: 25,
})
assert.equal(bulkResults.length, 25)

// 10. 查询归一化
assert.equal(normalizeSearchQuery('  大  模型 '), '大 模型')
assert.equal(LOCAL_SEARCH_ORIGIN_LABELS.later, '稍后读')

console.log('Local offline search tests: ALL PASSED')
