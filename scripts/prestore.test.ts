import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  buildPrestorePlan,
  mergeRollingWindow,
  prestoreCandidateLimit,
  resumableVisitedSources,
  seedPrestoreWindows,
  type PrestoreSyncCursor,
} from '../src/features/prestore/model'
import { CATEGORIES } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  type Preferences,
} from '../src/sources/preferences'

assert.deepEqual(normalizePreferences({}).prestore, {
  enabled: false,
  perSourceLimit: 10,
})
assert.deepEqual(
  normalizePreferences({ prestore: { enabled: true, perSourceLimit: 100 } }).prestore,
  { enabled: true, perSourceLimit: 100 },
)
assert.equal(
  normalizePreferences({ prestore: { enabled: true, perSourceLimit: 999 } }).prestore.perSourceLimit,
  10,
)

assert.deepEqual(
  mergeRollingWindow(
    ['new-3', 'new-2', 'old-100', 'old-99'],
    ['old-100', 'old-99', 'old-98', 'old-97'],
    5,
  ),
  ['new-3', 'new-2', 'old-100', 'old-99', 'old-98'],
)

// Failed fresh bodies do not punch holes: previous durable entries fill the window.
assert.deepEqual(
  mergeRollingWindow(['new-10', 'new-9'], ['old-5', 'old-4', 'old-3', 'old-2'], 4),
  ['new-10', 'new-9', 'old-5', 'old-4'],
)

assert.deepEqual(mergeRollingWindow(['a', 'a', 'b'], ['b', 'c'], 3), ['a', 'b', 'c'])
assert.equal(prestoreCandidateLimit(10), 13)
assert.equal(prestoreCandidateLimit(50), 63)
assert.equal(prestoreCandidateLimit(100), 125)
assert.equal(prestoreCandidateLimit(200), 160)

const visible = new Set(['tech', 'ai'])
const prefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['tech', 'ai'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => !visible.has(id)),
  categorySources: {
    tech: ['sspai', 'ithome'],
    ai: ['sspai', 'openai-news'],
  },
}
const plan = buildPrestorePlan('test-preset', prefs, [])
assert.deepEqual(
  plan.sources.map((target) => `${target.categoryId}:${target.source.id}`),
  ['tech:sspai', 'tech:ithome', 'ai:openai-news'],
)
assert.equal(plan.presetId, 'test-preset')
assert.ok(plan.key.startsWith('test-preset:'))

const mixVisible = new Set(['mix', 'tech', 'ai'])
const mixPrefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['mix', 'tech', 'ai'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter((id) => !mixVisible.has(id)),
  categorySources: {
    tech: ['sspai'],
    ai: ['openai-news'],
  },
}
const mixPlan = buildPrestorePlan(
  'mix-preset',
  mixPrefs,
  ['sspai', 'ithome', 'openai-news'],
)
assert.deepEqual(
  mixPlan.sources.map((target) => `${target.categoryId}:${target.source.id}`),
  ['tech:sspai', 'ai:openai-news', 'mix:ithome'],
)

// 断点续传：只有计划、预设与每源篇数都没变时才能接着上次跑。
const cursor: PrestoreSyncCursor = {
  planKey: plan.key,
  presetId: plan.presetId,
  perSourceLimit: 100,
  visitedSourceIds: ['sspai', 'ithome', 'removed-source'],
  updatedAt: Date.now(),
}
assert.deepEqual(
  [...resumableVisitedSources(cursor, plan, 100)],
  ['sspai', 'ithome'],
)
assert.equal(resumableVisitedSources(cursor, plan, 20).size, 0)
assert.equal(resumableVisitedSources({ ...cursor, planKey: 'other' }, plan, 100).size, 0)
assert.equal(resumableVisitedSources({ ...cursor, presetId: 'other' }, plan, 100).size, 0)
assert.equal(resumableVisitedSources(null, plan, 100).size, 0)
assert.equal(resumableVisitedSources(undefined, plan, 100).size, 0)

// 检查点铺底：上一轮内容先按当前计划搬进草稿，中途提交才不会抹掉已有正文。
const previousManifest = {
  sources: {
    sspai: { categoryId: 'tech' as const, articleIds: ['s1', 's2', 's3', 'missing'] },
    ithome: { categoryId: 'tech' as const, articleIds: ['i1'] },
    dropped: { categoryId: 'tech' as const, articleIds: ['d1'] },
  },
  articles: { s1: 1, s2: 2, s3: 3, i1: 4, d1: 5 },
}
const seeded = seedPrestoreWindows(plan, previousManifest, 2)
assert.deepEqual(seeded.sources, {
  sspai: { categoryId: 'tech', articleIds: ['s1', 's2'] },
  ithome: { categoryId: 'tech', articleIds: ['i1'] },
})
// 计划外的信源不铺底；缺正文条目的 id 直接跳过。
assert.deepEqual(seeded.articles, { s1: 1, s2: 2, i1: 4 })
assert.deepEqual(seedPrestoreWindows(plan, null, 10), { sources: {}, articles: {} })

// 中断恢复的三处约定：service 每源落检查点、跑完清空游标；hook 见到游标就续传；
// store 能把游标读回来。逻辑本身依赖 Filesystem，这里守住调用契约不被改回原样。
{
  const service = readFileSync(join(process.cwd(), 'src/features/prestore/service.ts'), 'utf8')
  const loopStart = service.indexOf('for (let sourceIndex = 0')
  const checkpointCall = service.indexOf('await checkpoint()')
  const finalCommit = service.indexOf('await commitPrestoreManifest(manifest)')
  assert.ok(loopStart > 0 && checkpointCall > loopStart, '检查点必须在信源循环内提交')
  assert.ok(finalCommit > checkpointCall, '最终提交在循环之后')
  assert.match(service, /commitPrestoreManifest\(manifest, \{ cleanupOrphans: false \}\)/)
  assert.match(service, /buildManifest\(null\)/)
  assert.match(service, /resumableVisitedSources\(previous\?\.sync, plan, perSourceLimit\)/)
  assert.match(service, /claimPrestoredBody\(article\)/)
}

{
  const hook = readFileSync(join(process.cwd(), 'src/features/prestore/usePrestore.ts'), 'utf8')
  assert.match(hook, /const resumable = !planChanged && Boolean\(manifest\?\.sync\)/)
  assert.match(hook, /if \(!manualPending && !planChanged && !stale && !resumable\) return/)
  assert.match(hook, /if \(activeControllerRef\.current\) return\s*\n\s*requestAutoSync\(\)/)
}

{
  const store = readFileSync(join(process.cwd(), 'src/features/prestore/store.ts'), 'utf8')
  assert.match(store, /sync: normalizeSyncCursor\(raw\.sync\)/)
  assert.match(store, /options\.cleanupOrphans !== false/)
  assert.match(store, /export async function claimPrestoredBody/)
}

console.log('prestore: ok')
