/**
 * 本地推荐：切词 / 画像 / 排序 / 冷启动退化，以及动态推荐分类的契约——
 * 候选池严格取预设启用信源、阅读达标才亮起、默认焦点不落在推荐、保留名校验。
 * 用法：npx tsx scripts/recommend.test.ts
 */
import assert from 'node:assert/strict'

import { feedArticleId, sourceIdOfArticleId } from '../src/lib/articleId'
import {
  RECOMMEND_LIMIT,
  RECOMMEND_MIN_SCOPED_DOCS,
  buildReadingProfile,
  collectReadArticles,
  isRecommendationReady,
  rankRecommendations,
  scopeSignalsToSources,
  tokenize,
} from '../src/lib/recommend'
import type { Article } from '../src/lib/types'
import {
  CATEGORIES,
  RECOMMEND_CATEGORY,
  RECOMMEND_CATEGORY_ID,
  isReservedCategoryLabel,
} from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  defaultFeedCategoryId,
  normalizePreferences,
  recommendationScopeSourceIds,
  sourceIdsForCategoryWithPrefs,
  toggleCategorySource,
  updateCustomCategory,
  visibleCategories,
  withRecommendCategory,
} from '../src/sources/preferences'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_PRESETS,
  normalizePresetsState,
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

// —— Task 9: 推荐是动态栏位，不进注册表；候选池严格取预设启用信源 ——
assert.ok(
  !CATEGORIES.some((category) => category.id === RECOMMEND_CATEGORY_ID),
  '注册表不应再包含推荐分类',
)
assert.equal(RECOMMEND_CATEGORY.id, RECOMMEND_CATEGORY_ID)
assert.ok(!RECOMMEND_CATEGORY.sourceIds?.length, '动态推荐分类不应有固定信源')

// 候选池 = 可见分类信源并集；综合贡献频道启用列表；隐藏分类的源不进池
const scopedPrefs = normalizePreferences({
  categoryOrder: ['hot', 'tech'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => !['hot', 'tech'].includes(id),
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

// 综合可见时贡献频道启用列表
const mixPrefs = normalizePreferences({
  categoryOrder: ['mix', 'hot'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => !['mix', 'hot'].includes(id),
  ),
})
const mixScope = recommendationScopeSourceIds(mixPrefs, ['sspai'])
assert.ok(mixScope.includes('sspai') && mixScope.includes('netease'))

// 严格性：池外不回落——空白布局（仅综合可见且频道未启用任何源）候选池为空
const blankPrefs = normalizePreferences({
  categoryOrder: ['mix'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => id !== 'mix'),
})
assert.deepEqual(recommendationScopeSourceIds(blankPrefs, []), [])

// 聚合分类不参与逐分类选源
assert.equal(
  toggleCategorySource(DEFAULT_PREFERENCES, RECOMMEND_CATEGORY_ID, 'sspai'),
  DEFAULT_PREFERENCES,
)
console.log('recommend scope: ok')

// —— Task 10: 阅读阈值——预设内阅读量达标才亮起，UI 不感知数值 ——
const readyScope = new Set(['netease', 'ithome'])
const readsOf = (sourceId: string, count: number) =>
  Array.from({ length: count }, (_v, i) => feedArticleId(sourceId, `https://example.com/${i}`))

assert.equal(sourceIdOfArticleId(feedArticleId('netease', 'https://a')), 'netease')
assert.equal(sourceIdOfArticleId('no-separator'), '', '不合规 id 应视为无法归属')

assert.equal(
  isRecommendationReady({ readIds: [], laterArticles: [] }, readyScope),
  false,
  '零阅读不应亮起',
)
assert.equal(
  isRecommendationReady(
    { readIds: readsOf('netease', RECOMMEND_MIN_SCOPED_DOCS - 1), laterArticles: [] },
    readyScope,
  ),
  false,
  '低于阈值不应亮起',
)
assert.equal(
  isRecommendationReady(
    { readIds: readsOf('netease', RECOMMEND_MIN_SCOPED_DOCS), laterArticles: [] },
    readyScope,
  ),
  true,
  '达到阈值应亮起',
)
assert.equal(
  isRecommendationReady(
    { readIds: readsOf('out-of-scope', RECOMMEND_MIN_SCOPED_DOCS * 10), laterArticles: [] },
    readyScope,
  ),
  false,
  '池外阅读再多也不算本预设的阅读行为',
)
assert.equal(
  isRecommendationReady({ readIds: readsOf('netease', 100), laterArticles: [] }, new Set()),
  false,
  '空候选池永远不亮起',
)

// 稍后读同样计入；同一篇既已读又在稍后读只计一次
const laterDocs = readsOf('ithome', RECOMMEND_MIN_SCOPED_DOCS - 1).map((id) =>
  article({ id, title: '稍后读', sourceId: 'ithome' }),
)
assert.equal(
  isRecommendationReady({ readIds: [laterDocs[0].id], laterArticles: laterDocs }, readyScope),
  false,
  '重复条目不应重复计数',
)
assert.equal(
  isRecommendationReady(
    { readIds: readsOf('netease', 1), laterArticles: laterDocs },
    readyScope,
  ),
  true,
  '已读与稍后读应合并计数',
)

// 画像信号裁剪：池外阅读不进画像，各预设互不串味
const mixedSignals = {
  readArticles: [
    article({ id: 'in-1', title: '池内', sourceId: 'netease' }),
    article({ id: 'out-1', title: '池外', sourceId: 'out-of-scope' }),
  ],
  laterArticles: [article({ id: 'out-2', title: '池外稍后读', sourceId: 'out-of-scope' })],
}
const scoped = scopeSignalsToSources(mixedSignals, readyScope)
assert.deepEqual(scoped.readArticles.map((item) => item.id), ['in-1'])
assert.deepEqual(scoped.laterArticles, [])
console.log('recommend readiness: ok')

// —— Task 11: 动态轨道——推荐亮起时置于首位，但默认焦点永远是第一个普通分类 ——
const portalPrefs = normalizePreferences(null)
const regular = visibleCategories(portalPrefs)
assert.ok(regular.length > 0)
assert.ok(!regular.some((category) => category.id === RECOMMEND_CATEGORY_ID))

assert.deepEqual(
  withRecommendCategory(regular, false).map((category) => category.id),
  regular.map((category) => category.id),
  '未达标时轨道不含推荐',
)
const railWithRecommend = withRecommendCategory(regular, true)
assert.equal(railWithRecommend[0].id, RECOMMEND_CATEGORY_ID, '亮起后推荐应在第一位')
assert.deepEqual(
  railWithRecommend.slice(1).map((category) => category.id),
  regular.map((category) => category.id),
  '插入推荐不得改变普通分类顺序',
)
assert.equal(
  defaultFeedCategoryId(railWithRecommend),
  regular[0].id,
  '默认选中必须是第一个普通分类，而非推荐',
)
assert.equal(defaultFeedCategoryId(regular), regular[0].id)
assert.equal(defaultFeedCategoryId([]), 'mix', '空轨道回落到综合')
console.log('recommend rail: ok')

// —— Task 12: 移除「本地推荐」预设与旧数据迁移 ——
assert.ok(
  !BUILTIN_PRESETS.some((preset) => preset.id === 'builtin-foryou' || preset.name === '本地推荐'),
  '不应再有独立的本地推荐预设',
)
for (const preset of BUILTIN_PRESETS) {
  assert.ok(
    !preset.snapshot.categoryOrder.includes(RECOMMEND_CATEGORY_ID) &&
      !preset.snapshot.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID),
    `${preset.id} 的快照不应引用推荐分类`,
  )
}

// 旧数据 activePresetId 指向已下线的本地推荐时回落到默认预设
const legacyState = normalizePresetsState({ activePresetId: 'builtin-foryou', userPresets: [] })!
assert.equal(legacyState.activePresetId, BUILTIN_DEFAULT_ID)

// 旧快照 / 旧偏好中的 recommend id 归一化时剔除，且轨道仍有可见分类
const legacySnap = normalizeSnapshot({ categoryOrder: ['recommend', 'tech'], hiddenCategoryIds: ['recommend'] })
assert.ok(!legacySnap.categoryOrder.includes(RECOMMEND_CATEGORY_ID))
assert.ok(!legacySnap.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID))

const legacyPrefs = normalizePreferences({
  categoryOrder: ['recommend', 'tech'],
  hiddenCategoryIds: ['recommend'],
})
assert.ok(!legacyPrefs.categoryOrder.includes(RECOMMEND_CATEGORY_ID))
assert.ok(!legacyPrefs.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID))
assert.ok(visibleCategories(legacyPrefs).length > 0, '迁移后首页仍需有可见分类')
assert.ok(!DEFAULT_PREFERENCES.hiddenCategoryIds.includes(RECOMMEND_CATEGORY_ID))
console.log('recommend migration: ok')

// —— Task 13: 保留名——自定义分类不得命名为「推荐」（创建与编辑均拦截）——
assert.equal(isReservedCategoryLabel('推荐'), true)
assert.equal(isReservedCategoryLabel(' 推荐 '), true, '首尾空白不应绕过校验')
assert.equal(isReservedCategoryLabel('科技推荐'), false)
assert.equal(isReservedCategoryLabel(''), false)

const reservedAdd = addCustomCategory(DEFAULT_PREFERENCES, {
  label: '推荐',
  sourceIds: ['ithome'],
})
assert.equal(reservedAdd.nextPrefs, DEFAULT_PREFERENCES, '创建保留名分类应被拒绝')
assert.equal(reservedAdd.newCategoryId, '')
assert.equal(
  addCustomCategory(DEFAULT_PREFERENCES, {
    label: '阅读精选',
    short: '推荐',
    sourceIds: ['ithome'],
  }).nextPrefs,
  DEFAULT_PREFERENCES,
  '短名占用保留名同样拒绝',
)

const { nextPrefs: withCustom, newCategoryId } = addCustomCategory(DEFAULT_PREFERENCES, {
  label: '深度专栏',
  short: '专栏',
  sourceIds: ['ithome'],
})
assert.ok(newCategoryId, '正常命名应能创建')
assert.equal(
  updateCustomCategory(withCustom, newCategoryId, { label: '推荐' }),
  withCustom,
  '编辑改名为保留名应被拒绝',
)
assert.equal(
  updateCustomCategory(withCustom, newCategoryId, { short: '推荐' }),
  withCustom,
  '编辑短名为保留名应被拒绝',
)
const renamed = updateCustomCategory(withCustom, newCategoryId, { label: '全球极客' })
assert.equal(
  renamed.customCategories?.find((category) => category.id === newCategoryId)?.label,
  '全球极客',
  '正常改名不受影响',
)
console.log('recommend reserved-name: ok')

console.log('recommend: all ok')
