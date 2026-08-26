/**
 * 本地推荐：切词 / 画像 / 排序 / 冷启动退化，以及推荐分类与「本地推荐」预设的契约。
 * 用法：npx tsx scripts/recommend.test.ts
 */
import assert from 'node:assert/strict'

import {
  RECOMMEND_LIMIT,
  buildReadingProfile,
  collectReadArticles,
  rankRecommendations,
  tokenize,
} from '../src/lib/recommend'
import type { Article } from '../src/lib/types'
import { CATEGORIES, RECOMMEND_CATEGORY_ID } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  recommendationScopeSourceIds,
  sourceIdsForCategoryWithPrefs,
  toggleCategorySource,
  toggleCategoryVisible,
  visibleCategories,
} from '../src/sources/preferences'
import {
  BUILTIN_FORYOU_ID,
  applySnapshotToPrefs,
  findBuiltinPreset,
  normalizeSnapshot,
} from '../src/sources/presets'

console.log('Testing local recommendation ranking...')

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000

function article(patch: Partial<Article> & Pick<Article, 'id' | 'title'>): Article {
  return {
    summary: '',
    publishedAt: NOW - HOUR,
    hasRealDate: true,
    sourceId: 'demo',
    sourceName: '示例信源',
    sourceLabel: '示例',
    sourceGroup: 'cn',
    originUrl: `https://example.com/${patch.id}`,
    ...patch,
  }
}

// —— Task 1: 切词 ——
assert.deepEqual(tokenize('大模型价格战'), ['大模', '模型', '型价', '价格', '格战'])
assert.deepEqual(tokenize('OpenAI 发布 GPT-5'), ['openai', 'gpt', '发布'])
assert.deepEqual(tokenize('好'), ['好'])
assert.deepEqual(tokenize(''), [])
console.log('recommend tokenize: ok')

// —— Task 2: 画像构建 ——
const readAiArticles = [
  article({ id: 'r1', title: '大模型推理成本再降', sourceId: 'ai-news' }),
  article({ id: 'r2', title: '大模型芯片竞争加剧', sourceId: 'ai-news' }),
  article({ id: 'r3', title: '开源大模型评测出炉', sourceId: 'oss-blog' }),
]
const profile = buildReadingProfile({ readArticles: readAiArticles, laterArticles: [] })
assert.equal(profile.docCount, 3)
assert.ok((profile.termWeights.get('大模') ?? 0) > 0, '中文 bigram 应进入画像')
assert.equal(profile.sourceAffinity.get('ai-news'), 1, '读得最多的源亲和度应为 1')
assert.ok((profile.sourceAffinity.get('oss-blog') ?? 0) < 1)

// 同一篇既在已读又在稍后读：只计一次，且按稍后读的更高权重计
const dupProfile = buildReadingProfile({
  readArticles: [readAiArticles[0]],
  laterArticles: [readAiArticles[0]],
})
assert.equal(dupProfile.docCount, 1)
console.log('recommend profile: ok')

// —— Task 3: 冷启动退化为按时间 ——
const emptyProfile = buildReadingProfile({ readArticles: [], laterArticles: [] })
assert.equal(emptyProfile.docCount, 0)
const coldCandidates = [
  article({ id: 'c-old', title: '旧闻', publishedAt: NOW - 30 * HOUR }),
  article({ id: 'c-new', title: '新闻', publishedAt: NOW - 1 * HOUR }),
  article({ id: 'c-mid', title: '午间报', publishedAt: NOW - 10 * HOUR }),
]
assert.deepEqual(
  rankRecommendations(coldCandidates, emptyProfile, { now: NOW }).map((item) => item.id),
  ['c-new', 'c-mid', 'c-old'],
  '冷启动应严格按发布时间降序',
)

const bulk = Array.from({ length: RECOMMEND_LIMIT + 20 }, (_v, i) =>
  article({ id: `bulk-${i}`, title: `第 ${i} 条`, publishedAt: NOW - i * HOUR }),
)
assert.equal(rankRecommendations(bulk, emptyProfile, { now: NOW }).length, RECOMMEND_LIMIT)
console.log('recommend cold start: ok')

// —— Task 4: 内容相似驱动排序 ——
const contentCandidates = [
  article({ id: 'n1', title: '欧洲央行维持利率不变', sourceId: 'macro', publishedAt: NOW - HOUR }),
  article({
    id: 'n2',
    title: '大模型推理优化实践分享',
    sourceId: 'unread-tech',
    publishedAt: NOW - HOUR,
  }),
]
const contentRanked = rankRecommendations(contentCandidates, profile, { now: NOW })
assert.equal(contentRanked[0].id, 'n2', '与已读词面相近的条目应排在前面')

// —— Task 5: 信源亲和作为并列信号 ——
const affinityCandidates = [
  article({ id: 's1', title: '今日要闻速览', sourceId: 'macro', publishedAt: NOW - HOUR }),
  article({ id: 's2', title: '今日要闻速览', sourceId: 'ai-news', publishedAt: NOW - HOUR }),
]
const affinityRanked = rankRecommendations(affinityCandidates, profile, { now: NOW })
assert.equal(affinityRanked[0].id, 's2', '词面打平时常读信源应占先')

// —— Task 6: 排除已读 / 稍后读，去重 ——
const excludeRanked = rankRecommendations(
  [readAiArticles[0], contentCandidates[1], contentCandidates[1]],
  profile,
  { now: NOW, excludeIds: new Set(['r1']) },
)
assert.deepEqual(excludeRanked.map((item) => item.id), ['n2'])
assert.deepEqual(rankRecommendations([], profile, { now: NOW }), [])

// —— Task 7: 信源打散——单源不能刷屏 ——
const floodCandidates = [
  ...Array.from({ length: 8 }, (_v, i) =>
    article({
      id: `flood-${i}`,
      title: '大模型推理成本观察',
      sourceId: 'ai-news',
      publishedAt: NOW - HOUR,
    }),
  ),
  article({
    id: 'other-1',
    title: '开源模型社区动态',
    sourceId: 'oss-blog',
    publishedAt: NOW - HOUR,
  }),
]
const floodRanked = rankRecommendations(floodCandidates, profile, { now: NOW })
const topFiveSources = new Set(floodRanked.slice(0, 5).map((item) => item.sourceId))
assert.ok(topFiveSources.size >= 2, '打散后前五条至少来自两个源')
console.log('recommend ranking: ok')

// —— Task 8: 已读元数据 join ——
const joined = collectReadArticles(new Set(['r1', 'ghost']), [
  [article({ id: 'r1', title: '稍后读里的版本', sourceId: 'later-pool' })],
  readAiArticles,
])
assert.equal(joined.length, 1)
assert.equal(joined[0].sourceId, 'later-pool', '优先取先传入池子的元数据')
console.log('recommend collect: ok')

// —— Task 9: 推荐分类契约（聚合、范围、选源守卫）——
const recommendCategory = CATEGORIES.find((category) => category.id === RECOMMEND_CATEGORY_ID)
assert.ok(recommendCategory, '注册表应包含推荐分类')
assert.ok(!recommendCategory!.sourceIds?.length, '推荐分类不应有固定信源')

// 推荐范围 = 可见分类信源并集；综合贡献频道启用列表
const scopedPrefs = normalizePreferences({
  categoryOrder: ['recommend', 'hot', 'tech'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => !['recommend', 'hot', 'tech'].includes(id),
  ),
})
const scope = recommendationScopeSourceIds(scopedPrefs, ['enabled-only'])
assert.ok(scope.includes('netease'), '应包含可见「热点」分类的源')
assert.ok(scope.includes('ithome'), '应包含可见「科技」分类的源')
assert.ok(!scope.includes('enabled-only'), '综合被隐藏时不应引入频道启用列表')
assert.ok(!scope.includes('netease-ent'), '隐藏分类的源不应进入推荐范围')
assert.deepEqual(
  sourceIdsForCategoryWithPrefs(RECOMMEND_CATEGORY_ID, scopedPrefs, ['enabled-only']),
  scope,
)

// 只有推荐可见时回落到频道启用列表
const loneRecommendPrefs = normalizePreferences({
  categoryOrder: ['recommend'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => id !== 'recommend',
  ),
})
assert.deepEqual(recommendationScopeSourceIds(loneRecommendPrefs, ['netease']), ['netease'])

// 聚合分类不参与逐分类选源
assert.equal(
  toggleCategorySource(DEFAULT_PREFERENCES, RECOMMEND_CATEGORY_ID, 'sspai'),
  DEFAULT_PREFERENCES,
)
console.log('recommend category: ok')

// —— Task 10: 「本地推荐」内置预设 ——
const foryou = findBuiltinPreset(BUILTIN_FORYOU_ID)
assert.ok(foryou, '应存在本地推荐内置预设')
assert.equal(foryou!.builtin, true)
assert.ok(foryou!.snapshot.enabledSourceIds.length > 0, '候选池不应为空')
const foryouPrefs = applySnapshotToPrefs(DEFAULT_PREFERENCES, foryou!.snapshot)
assert.deepEqual(
  visibleCategories(foryouPrefs).map((category) => category.id),
  [RECOMMEND_CATEGORY_ID, 'mix'],
  '预设应只展示推荐 + 综合对照',
)
console.log('recommend preset: ok')

// —— Task 11: 旧数据迁移——未显式收录时保持隐藏 ——
const legacySnap = normalizeSnapshot({
  categoryOrder: ['mix', 'tech'],
  hiddenCategoryIds: [],
})
assert.ok(
  legacySnap.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID),
  '旧快照未收录推荐时应保持隐藏',
)
const foryouSnap = normalizeSnapshot(foryou!.snapshot)
assert.ok(!foryouSnap.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID))

const legacyPrefs = normalizePreferences({ categoryOrder: ['tech'], hiddenCategoryIds: [] })
assert.ok(legacyPrefs.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID))
assert.ok(
  !visibleCategories(normalizePreferences(null)).some(
    (category) => category.id === RECOMMEND_CATEGORY_ID,
  ),
  '默认门户不应突然出现推荐栏',
)

// 用户在分类管理里显式开启后，重启（归一化往返）不应被迁移重新藏起来
const freshPrefs = normalizePreferences(null)
const enabledRecommend = toggleCategoryVisible(freshPrefs, RECOMMEND_CATEGORY_ID)
assert.ok(
  visibleCategories(enabledRecommend).some((category) => category.id === RECOMMEND_CATEGORY_ID),
)
assert.ok(enabledRecommend.categoryOrder.includes(RECOMMEND_CATEGORY_ID))
const roundTrip = normalizePreferences(JSON.parse(JSON.stringify(enabledRecommend)))
assert.ok(
  visibleCategories(roundTrip).some((category) => category.id === RECOMMEND_CATEGORY_ID),
  '显式开启在持久化往返后应保持可见',
)
console.log('recommend migration: ok')

console.log('recommend: all ok')
