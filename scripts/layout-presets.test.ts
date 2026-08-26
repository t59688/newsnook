/**
 * 场景预设核心：快照 normalize / 互转 / 生命周期。
 * 用法：npx tsx scripts/layout-presets.test.ts
 */
import assert from 'node:assert/strict'

import { CATEGORIES } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  addCustomSource,
  categorySourceIds,
  resolveCategory,
  visibleCategories,
} from '../src/sources/preferences'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_PRESETS,
  BUILTIN_TECH_ID,
  MIGRATE_LAYOUT_PRESET_ID,
  USER_DEFAULT_LAYOUT_ID,
  activatePreset,
  applySnapshotToPrefs,
  buildFreshInstallPresetsState,
  buildMigratedPresetsState,
  createBlankUserPreset,
  deleteUserPreset,
  duplicateSourcesAcrossCategories,
  emptyLayoutSnapshot,
  findBuiltinPreset,
  isBuiltinOverridden,
  mixThemeOverlap,
  normalizePresetsState,
  normalizeSnapshot,
  renameUserPreset,
  resolvePreset,
  restoreBuiltinFactory,
  saveAsUserPreset,
  snapshotFromRuntime,
  updateActiveSnapshot,
  updateUserPresetSnapshot,
} from '../src/sources/presets'

// —— Task 1: normalize + 互转 ——
const snap = normalizeSnapshot({
  categoryOrder: ['mix', 'tech', 'ghost-cat'],
  hiddenCategoryIds: ['science', 'ghost-cat'],
  categorySources: { tech: ['ithome', 'nope'], ghost: ['ithome'] },
  customCategories: [
    {
      id: 'custom_1',
      label: '我的',
      short: '我的',
      caption: 'x',
      isCustom: true,
      sourceIds: ['ithome', 'missing'],
    },
  ],
  enabledSourceIds: ['ithome', 'ithome', 'missing'],
})

assert.deepEqual(snap.categoryOrder, ['mix', 'tech'])
assert.ok(!snap.hiddenCategoryIds.includes('ghost-cat'))
assert.deepEqual(snap.categorySources.tech, ['ithome'])
assert.equal(snap.customCategories[0].sourceIds?.[0], 'ithome')
assert.deepEqual(snap.enabledSourceIds, ['ithome'])

const { nextPrefs: prefsWithCustomRss, newSourceId: customRssId } = addCustomSource(
  DEFAULT_PREFERENCES,
  {
    name: 'example.com',
    label: '示例',
    url: 'https://example.com/index.php',
  },
)
const { nextPrefs: prefsCustomLayout, newCategoryId: customCatId } = addCustomCategory(
  prefsWithCustomRss,
  { label: '123214', short: '1232', sourceIds: [customRssId] },
)
const customSnap = snapshotFromRuntime(prefsCustomLayout, [customRssId, 'ithome'])
const savedCustomCat = customSnap.customCategories.find((category) => category.id === customCatId)
assert.ok(savedCustomCat, 'snapshot must keep custom category that only has custom sources')
assert.deepEqual(savedCustomCat.sourceIds, [customRssId])
assert.ok(customSnap.enabledSourceIds.includes(customRssId))
assert.ok(customSnap.categoryOrder.includes(customCatId))

const restoredPrefs = applySnapshotToPrefs(prefsCustomLayout, customSnap)
assert.deepEqual(categorySourceIds(customCatId, restoredPrefs), [customRssId])
assert.equal(resolveCategory(customCatId, restoredPrefs).caption, '示例')

const ghostCustomSnap = normalizeSnapshot({
  customCategories: [
    {
      id: 'custom_only_rss',
      label: '仅自建',
      short: '自建',
      caption: 'x',
      isCustom: true,
      sourceIds: [customRssId, 'missing'],
    },
  ],
  enabledSourceIds: [customRssId, 'missing'],
  categorySources: { tech: ['ithome', customRssId] },
})
assert.deepEqual(ghostCustomSnap.customCategories[0].sourceIds, [customRssId])
assert.deepEqual(ghostCustomSnap.enabledSourceIds, [customRssId])
assert.deepEqual(ghostCustomSnap.categorySources.tech, ['ithome', customRssId])

const prefs = {
  ...DEFAULT_PREFERENCES,
  typography: { ...DEFAULT_PREFERENCES.typography, fontScale: 1.22 },
}
const runtime = snapshotFromRuntime(prefs, ['sspai', 'ithome'])
const next = applySnapshotToPrefs(prefs, {
  ...runtime,
  categoryOrder: ['ai', 'mix'],
  hiddenCategoryIds: ['fun'],
  enabledSourceIds: ['qbitai'],
})
assert.deepEqual(next.categoryOrder, ['ai', 'mix'])
assert.equal(next.typography.fontScale, 1.22)

console.log('layout-presets core: ok')

// —— Task 2: builtins ——
assert.equal(BUILTIN_PRESETS.length, 8)

// 本地推荐预设：推荐 + 综合对照，无逐分类信源（详细契约见 scripts/recommend.test.ts）
const foryou = findBuiltinPreset('builtin-foryou')!
assert.deepEqual(foryou.snapshot.categoryOrder, ['recommend', 'mix'])
assert.deepEqual(foryou.snapshot.categorySources, {})
assert.ok(foryou.snapshot.enabledSourceIds.length > 0)

const portal = normalizeSnapshot(findBuiltinPreset('builtin-default')!.snapshot)
assert.deepEqual(portal.categoryOrder, [
  'mix',
  'hot',
  'ent',
  'sports',
  'tech',
  'finance',
  'intl',
  'health',
  'science',
  'fun',
])
assert.ok(!portal.hiddenCategoryIds.includes('ent'))
assert.ok(!portal.hiddenCategoryIds.includes('sports'))
assert.ok(portal.hiddenCategoryIds.includes('ai'))
assert.ok(portal.hiddenCategoryIds.includes('ai-openai'))
assert.ok(portal.hiddenCategoryIds.includes('ai-claude'))
assert.ok(portal.hiddenCategoryIds.includes('ai-media'))
assert.ok(portal.hiddenCategoryIds.includes('ai-depth'))
assert.ok(portal.hiddenCategoryIds.includes('ai-community'))
assert.ok(portal.hiddenCategoryIds.includes('game'))
assert.deepEqual(portal.categorySources.intl, ['bbc-zh', 'dw-top', 'scmp-china', 'theinitium', 'gnews-world'])
assert.deepEqual(portal.categorySources.hot, ['netease'])
assert.deepEqual(portal.categorySources.ent, ['netease-ent', 'gnews-ent'])
assert.ok(!portal.enabledSourceIds.includes('gnews-world'))

for (const preset of BUILTIN_PRESETS) {
  const dupes = duplicateSourcesAcrossCategories(preset.snapshot.categorySources)
  assert.deepEqual(dupes, [], `${preset.id} has cross-category source dupes: ${dupes.join(',')}`)
  const overlap = mixThemeOverlap(
    preset.snapshot.categorySources,
    preset.snapshot.enabledSourceIds,
  )
  assert.deepEqual(
    overlap,
    [],
    `${preset.id} mix overlaps theme sources: ${overlap.join(',')}`,
  )
}

const categoryDefaults: Record<string, string[]> = {}
for (const category of CATEGORIES) {
  if (category.sourceIds?.length) categoryDefaults[category.id] = [...category.sourceIds]
}
assert.deepEqual(
  duplicateSourcesAcrossCategories(categoryDefaults),
  [],
  'CATEGORIES base source lists must be mutually exclusive',
)

const tech = findBuiltinPreset('builtin-tech')!
const techSnap = normalizeSnapshot(tech.snapshot)
const visible = new Set(
  CATEGORIES.map((c) => c.id).filter((id) => !techSnap.hiddenCategoryIds.includes(id)),
)
assert.ok(visible.has('tech') && visible.has('ai') && visible.has('ai-media'))
assert.ok(visible.has('ai-openai') && visible.has('ai-claude'))
assert.ok(visible.has('ai-depth') && visible.has('ai-community'))
assert.ok(!visible.has('fun'))
// AI 六栏：OpenAI / Claude / 实验室 / 业界 / 深读 / 社区
assert.deepEqual(techSnap.categorySources['ai-openai'], ['openai-news', 'openai-cookbook'])
assert.deepEqual(techSnap.categorySources['ai-claude'], [
  'anthropic',
  'claude-blog',
  'claude-customers',
  'claude-academy-use-cases',
  'claude-academy-tutorials',
])
assert.deepEqual(techSnap.categorySources.ai, [
  'google-ai',
  'deepmind',
  'huggingface',
  'arena',
])
assert.deepEqual(techSnap.categorySources['ai-media'], [
  'qbitai',
  'jiqizhixin',
  'aiera',
  'mittr-ai',
])
assert.deepEqual(techSnap.categorySources['ai-depth'], [
  'zhidx',
  'baoyu',
  'xixiaoyao',
  '42zhangjing',
  'oneusefulthing',
  'latent-space',
])
assert.deepEqual(techSnap.categorySources['ai-community'], ['uisdc-aigc', 'v2ex', 'hn'])
// 其余 AI 源留在分类里可发现但默认关闭
assert.ok(!techSnap.categorySources.ai?.includes('pytorch'))
assert.ok(!techSnap.categorySources['ai-depth']?.includes('paperweekly'))
assert.ok(!techSnap.categorySources['ai-community']?.includes('paperweekly'))
assert.ok(techSnap.categorySources['tech-depth']?.includes('paulgraham'))
assert.ok(!techSnap.categorySources['tech-depth']?.includes('hn'))
assert.ok(!techSnap.categorySources.tech?.includes('v2ex'))
assert.ok(techSnap.categorySources.tech?.includes('ithome'))
// 综合不再兜一长串源：无独占源则隐藏综合
assert.deepEqual(techSnap.enabledSourceIds, [])
assert.ok(techSnap.hiddenCategoryIds.includes('mix'))
assert.deepEqual(
  techSnap.categoryOrder.filter((id) => !techSnap.hiddenCategoryIds.includes(id)),
  [
    'ai-openai',
    'ai-claude',
    'ai',
    'ai-media',
    'ai-depth',
    'ai-community',
    'tech-depth',
    'tech',
    'science',
  ],
)

const depth = normalizeSnapshot(findBuiltinPreset('builtin-depth')!.snapshot)
assert.ok(depth.categorySources['tech-depth']?.includes('quanta'))
assert.ok(depth.categorySources['tech-depth']?.includes('stratechery'))
assert.ok(depth.categorySources['tech-depth']?.includes('vitalik'))
assert.ok(depth.categorySources.intl?.includes('foreign-affairs'))
assert.ok(depth.categorySources.intl?.includes('sinocism'))
assert.ok(depth.categorySources.intl?.includes('theinitium'))
assert.ok(depth.categorySources['astral-codex-ten']?.includes('astral-codex-ten'))
assert.ok(depth.categorySources.marginalian?.includes('marginalian'))
assert.ok(depth.categorySources.aldaily?.includes('aldaily'))
assert.ok(depth.categorySources.theue?.includes('theue'))
assert.ok(depth.categorySources.tech?.includes('v2ex'))
assert.deepEqual(depth.enabledSourceIds, [])
assert.deepEqual(
  depth.categoryOrder.filter((id) => !depth.hiddenCategoryIds.includes(id)),
  ['tech-depth', 'intl', 'astral-codex-ten', 'marginalian', 'aldaily', 'theue', 'tech'],
)
assert.ok(depth.hiddenCategoryIds.includes('mix'))

const biz = normalizeSnapshot(findBuiltinPreset('builtin-biz')!.snapshot)
assert.ok(biz.categorySources.finance?.includes('latepost'))
assert.ok(biz.categorySources.finance?.includes('jazzyear'))
assert.ok(biz.categorySources.finance?.includes('kr36'))
assert.ok(biz.categorySources.intl?.includes('bloomberg-opinion'))
assert.ok(biz.categorySources.intl?.includes('theinitium'))
assert.ok(!biz.enabledSourceIds.includes('latepost'))
assert.ok(biz.enabledSourceIds.includes('eastmoney-news'))
assert.equal(biz.categoryOrder[1], 'finance')

const world = normalizeSnapshot(findBuiltinPreset('builtin-world')!.snapshot)
assert.ok(world.categorySources.intl?.includes('foreign-affairs'))
assert.ok(world.categorySources.intl?.includes('theinitium'))
assert.ok(world.categorySources.intl?.includes('bbc-zh'))
assert.ok(world.categorySources['tech-depth']?.includes('quanta'))
assert.ok(world.categorySources.science?.includes('gnews-science'))
assert.ok(!world.enabledSourceIds.includes('foreign-affairs'))
assert.ok(world.enabledSourceIds.includes('bbc-zh-china'))
assert.equal(world.categoryOrder[0], 'mix')
assert.equal(world.categoryOrder[1], 'intl')

const mindful = normalizeSnapshot(findBuiltinPreset('builtin-mindful')!.snapshot)
assert.ok(mindful.categorySources.science?.includes('guokr'))
assert.ok(mindful.categorySources.tech?.includes('v2ex'))
assert.ok(mindful.categorySources.theue?.includes('theue'))
assert.ok(mindful.categorySources.zhihu?.includes('zhihu-daily'))
assert.deepEqual(mindful.enabledSourceIds, [])
assert.equal(mindful.categoryOrder[0], 'science')
assert.equal(mindful.categoryOrder[2], 'theue')
assert.equal(mindful.categoryOrder[3], 'zhihu')
assert.ok(mindful.hiddenCategoryIds.includes('mix'))

const fun = normalizeSnapshot(findBuiltinPreset('builtin-fun')!.snapshot)
assert.ok(fun.categorySources.fun?.includes('netease-fun'))
assert.ok(fun.categorySources.ent?.includes('netease-ent'))
assert.ok(fun.categorySources.ent?.includes('gnews-ent'))
assert.ok(fun.categorySources.game?.includes('netease-game'))
assert.ok(fun.categorySources.history?.includes('netease-history'))
assert.ok(fun.categorySources.zhihu?.includes('zhihu-daily'))
assert.deepEqual(fun.enabledSourceIds, [])
assert.ok(!fun.categorySources.antique)
assert.equal(fun.categoryOrder[0], 'fun')
assert.deepEqual(
  fun.categoryOrder.filter((id) => !fun.hiddenCategoryIds.includes(id)),
  ['fun', 'ent', 'game', 'history', 'zhihu'],
)
assert.ok(fun.hiddenCategoryIds.includes('mix'))

console.log('layout-presets builtins: ok')

// —— Task 3: lifecycle ——
const migrated = buildMigratedPresetsState(DEFAULT_PREFERENCES, ['ithome'])
assert.equal(migrated.activePresetId, BUILTIN_DEFAULT_ID)
assert.equal(migrated.userPresets.length, 0)
assert.ok(isBuiltinOverridden(migrated, BUILTIN_DEFAULT_ID))
assert.deepEqual(resolvePreset(migrated, BUILTIN_DEFAULT_ID)?.snapshot.enabledSourceIds, ['ithome'])

const fresh = buildFreshInstallPresetsState()
assert.equal(fresh.activePresetId, BUILTIN_DEFAULT_ID)
assert.equal(fresh.userPresets.length, 0)
assert.equal(Object.keys(fresh.builtinOverrides).length, 0)

const { state: afterSave, preset } = saveAsUserPreset(
  migrated,
  resolvePreset(migrated, BUILTIN_DEFAULT_ID)!.snapshot,
  '科技副本',
)
assert.equal(preset.name, '科技副本')
assert.equal(preset.builtin, false)
assert.equal(afterSave.activePresetId, preset.id)
assert.ok(isBuiltinOverridden(afterSave, BUILTIN_DEFAULT_ID))

const untouched = updateUserPresetSnapshot(afterSave, BUILTIN_DEFAULT_ID, {
  ...preset.snapshot,
  categoryOrder: ['ai'],
})
assert.equal(untouched, afterSave)

const editedBuiltin = updateActiveSnapshot(
  { ...fresh, activePresetId: BUILTIN_DEFAULT_ID },
  { ...findBuiltinPreset(BUILTIN_DEFAULT_ID)!.snapshot, hiddenCategoryIds: ['mix'] },
)
assert.equal(editedBuiltin.userPresets.length, 0)
assert.ok(isBuiltinOverridden(editedBuiltin, BUILTIN_DEFAULT_ID))
assert.ok(resolvePreset(editedBuiltin, BUILTIN_DEFAULT_ID)!.snapshot.hiddenCategoryIds.includes('mix'))

const restored = restoreBuiltinFactory(editedBuiltin, BUILTIN_DEFAULT_ID)!
assert.equal(restored.applied, true)
assert.ok(!isBuiltinOverridden(restored.state, BUILTIN_DEFAULT_ID))

const onlyOne = {
  ...fresh,
  activePresetId: preset.id,
  userPresets: [preset],
}
const afterDelete = deleteUserPreset(onlyOne, preset.id)
assert.equal(afterDelete.activePresetId, BUILTIN_DEFAULT_ID)
assert.equal(afterDelete.userPresets.length, 0)

const activated = activatePreset(migrated, BUILTIN_TECH_ID)!
assert.equal(activated.state.activePresetId, BUILTIN_TECH_ID)
assert.equal(activated.state.userPresets.length, migrated.userPresets.length)
assert.equal(resolvePreset(activated.state, activated.state.activePresetId)?.builtin, true)

const worldApply = activatePreset(migrated, 'builtin-world')!
const worldPrefs = applySnapshotToPrefs(DEFAULT_PREFERENCES, worldApply.snapshot)
assert.deepEqual(
  visibleCategories(worldPrefs).map((c) => c.id),
  ['mix', 'intl', 'hot', 'tech-depth', 'science'],
)

const depthApply = activatePreset(migrated, 'builtin-depth')!
const depthPrefs = applySnapshotToPrefs(DEFAULT_PREFERENCES, depthApply.snapshot)
assert.deepEqual(
  visibleCategories(depthPrefs).map((c) => c.id),
  ['tech-depth', 'intl', 'astral-codex-ten', 'marginalian', 'aldaily', 'theue', 'tech'],
)

const blank = createBlankUserPreset(fresh, '空白台')
assert.equal(blank.preset.basedOnBuiltinId, undefined)
assert.deepEqual(blank.preset.snapshot, emptyLayoutSnapshot())
assert.equal(blank.state.activePresetId, blank.preset.id)

const renamedBuiltin = renameUserPreset(fresh, BUILTIN_DEFAULT_ID, '门户改名')
assert.equal(renamedBuiltin, fresh)

const folded = normalizePresetsState({
  activePresetId: USER_DEFAULT_LAYOUT_ID,
  userPresets: [
    {
      id: USER_DEFAULT_LAYOUT_ID,
      name: '我的布局',
      builtin: false,
      basedOnBuiltinId: BUILTIN_DEFAULT_ID,
      snapshot: { ...findBuiltinPreset(BUILTIN_DEFAULT_ID)!.snapshot, hiddenCategoryIds: ['mix'] },
      updatedAt: 1,
    },
    {
      id: 'user_renamed_tech',
      name: '周末科技',
      builtin: false,
      basedOnBuiltinId: BUILTIN_TECH_ID,
      snapshot: findBuiltinPreset(BUILTIN_TECH_ID)!.snapshot,
      updatedAt: 2,
    },
  ],
})!
assert.equal(folded.activePresetId, BUILTIN_DEFAULT_ID)
assert.ok(isBuiltinOverridden(folded, BUILTIN_DEFAULT_ID))
assert.equal(folded.userPresets.length, 1)
assert.equal(folded.userPresets[0].name, '周末科技')

const migratedLegacy = normalizePresetsState({
  activePresetId: MIGRATE_LAYOUT_PRESET_ID,
  userPresets: [
    {
      id: MIGRATE_LAYOUT_PRESET_ID,
      name: '我的布局',
      builtin: false,
      snapshot: snapshotFromRuntime(DEFAULT_PREFERENCES, ['ithome']),
      updatedAt: 3,
    },
  ],
})!
assert.equal(migratedLegacy.activePresetId, BUILTIN_DEFAULT_ID)
assert.equal(migratedLegacy.userPresets.length, 0)
assert.deepEqual(resolvePreset(migratedLegacy, BUILTIN_DEFAULT_ID)?.snapshot.enabledSourceIds, [
  'ithome',
])

console.log('layout-presets lifecycle: ok')
console.log('layout-presets: all ok')


