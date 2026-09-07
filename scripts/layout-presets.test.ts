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
assert.equal(BUILTIN_PRESETS.length, 7)

// 「本地推荐」独立预设已下线：推荐改为每个预设内达标后自动出现的动态栏
// （契约见 scripts/recommend.test.ts）
assert.equal(findBuiltinPreset('builtin-foryou'), undefined)
assert.ok(!BUILTIN_PRESETS.some((preset) => preset.snapshot.categoryOrder.includes('recommend')))

const portal = normalizeSnapshot(findBuiltinPreset('builtin-default')!.snapshot)
assert.deepEqual(
  portal.categoryOrder.filter((id) => !portal.hiddenCategoryIds.includes(id)),
  [
    'hot',
    'exclusive',
    'ent',
    'sports',
    'tech',
    'finance',
    'intl',
    'health',
    'science',
    'fun',
    'ent-world',
    'sports-world',
    'tech-world',
    'finance-world',
    'intl-world',
    'health-world',
    'science-world',
  ],
)
assert.ok(portal.hiddenCategoryIds.includes('mix'))
assert.deepEqual(portal.enabledSourceIds, [])
assert.ok(!portal.hiddenCategoryIds.includes('ent'))
assert.ok(!portal.hiddenCategoryIds.includes('exclusive'))
assert.ok(portal.hiddenCategoryIds.includes('ai'))
assert.ok(portal.hiddenCategoryIds.includes('game'))
assert.deepEqual(portal.categorySources.hot, ['netease'])
assert.deepEqual(portal.categorySources.ent, ['netease-ent'])
assert.deepEqual(portal.categorySources['ent-world'], ['gnews-ent'])
assert.deepEqual(portal.categorySources.sports, [
  'netease-sports',
  'netease-football',
  'netease-cn-football',
])
assert.deepEqual(portal.categorySources.intl, ['bbc-zh', 'dw-top', 'theinitium', 'bbc-zh-world'])
assert.deepEqual(portal.categorySources['intl-world'], [
  'gnews-world',
  'scmp-china',
  'npr',
  'guardian-world',
])
assert.ok(portal.categorySources.tech?.includes('netease-auto'))
assert.ok(portal.categorySources.tech?.includes('ruanyifeng'))
assert.ok(portal.categorySources.finance?.includes('netease-stock'))
assert.ok(portal.categorySources.science?.includes('netease-wuli'))
assert.ok(!portal.categorySources.tech?.includes('gnews-tech'))

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
assert.ok(visible.has('ai-media-world') && visible.has('tech-depth-world'))
assert.ok(!visible.has('fun'))
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
  'pytorch',
  'arena',
])
assert.deepEqual(techSnap.categorySources['ai-media'], ['qbitai', 'jiqizhixin', 'aiera', 'leiphone'])
assert.deepEqual(techSnap.categorySources['ai-media-world'], [
  'mittr-ai',
  'verge-ai',
  'ieee-ai',
  'venturebeat-ai',
  'synced',
  'marktechpost',
])
assert.deepEqual(techSnap.categorySources['ai-depth'], [
  'zhidx',
  'baoyu',
  'xixiaoyao',
  '42zhangjing',
])
assert.ok(techSnap.categorySources['ai-depth-world']?.includes('oneusefulthing'))
assert.deepEqual(techSnap.categorySources['ai-community'], [
  'uisdc-aigc',
  'v2ex',
  'paperweekly',
  'woshipm-ai',
])
assert.deepEqual(techSnap.categorySources['ai-community-world'], ['hn'])
assert.ok(techSnap.categorySources.tech?.includes('netease-phone'))
assert.ok(techSnap.categorySources.tech?.includes('ithome'))
assert.ok(!techSnap.categorySources.tech?.includes('v2ex'))
assert.ok(techSnap.categorySources['tech-depth']?.includes('qianhei'))
assert.ok(!techSnap.categorySources['tech-depth']?.includes('paulgraham'))
assert.ok(techSnap.categorySources['tech-depth-world']?.includes('paulgraham'))
assert.deepEqual(techSnap.enabledSourceIds, [])
assert.ok(techSnap.hiddenCategoryIds.includes('mix'))
assert.deepEqual(
  techSnap.categoryOrder.filter((id) => !techSnap.hiddenCategoryIds.includes(id)),
  [
    'ai-media',
    'ai-depth',
    'ai-community',
    'tech',
    'science',
    'tech-depth',
    'ai-media-world',
    'ai-depth-world',
    'ai-community-world',
    'tech-depth-world',
    'ai-openai',
    'ai-claude',
    'ai',
  ],
)

const depth = normalizeSnapshot(findBuiltinPreset('builtin-depth')!.snapshot)
assert.ok(depth.categorySources['tech-depth-world']?.includes('quanta'))
assert.ok(depth.categorySources['tech-depth-world']?.includes('stratechery'))
assert.ok(!depth.categorySources['tech-depth']?.includes('quanta'))
assert.ok(depth.categorySources.intl?.includes('theinitium'))
assert.ok(!depth.categorySources.intl?.includes('foreign-affairs'))
assert.ok(depth.categorySources['intl-world']?.includes('foreign-affairs'))
assert.ok(depth.categorySources['intl-world']?.includes('sinocism'))
assert.ok(depth.categorySources['astral-codex-ten']?.includes('astral-codex-ten'))
assert.ok(depth.categorySources.theue?.includes('theue'))
assert.ok(depth.categorySources.tech?.includes('v2ex'))
assert.deepEqual(depth.enabledSourceIds, [])
assert.deepEqual(
  depth.categoryOrder.filter((id) => !depth.hiddenCategoryIds.includes(id)),
  [
    'theue',
    'intl',
    'tech',
    'science',
    'intl-world',
    'tech-depth-world',
    'astral-codex-ten',
    'marginalian',
    'aldaily',
  ],
)
assert.ok(depth.hiddenCategoryIds.includes('mix'))

const biz = normalizeSnapshot(findBuiltinPreset('builtin-biz')!.snapshot)
assert.ok(biz.categorySources.finance?.includes('latepost'))
assert.ok(biz.categorySources.finance?.includes('netease-biz'))
assert.ok(biz.categorySources.tech?.includes('netease-auto'))
assert.ok(biz.categorySources.intl?.includes('dw-top'))
assert.ok(!biz.categorySources.intl?.includes('bloomberg-opinion'))
assert.ok(biz.categorySources['intl-world']?.includes('bloomberg-opinion'))
assert.deepEqual(biz.enabledSourceIds, [])
assert.ok(biz.hiddenCategoryIds.includes('mix'))
assert.equal(
  biz.categoryOrder.filter((id) => !biz.hiddenCategoryIds.includes(id))[0],
  'finance',
)

const world = normalizeSnapshot(findBuiltinPreset('builtin-world')!.snapshot)
assert.ok(world.categorySources.intl?.includes('theinitium'))
assert.ok(world.categorySources.intl?.includes('bbc-zh'))
assert.ok(world.categorySources.intl?.includes('bbc-zh-china'))
assert.ok(!world.categorySources.intl?.includes('foreign-affairs'))
assert.ok(world.categorySources['intl-world']?.includes('foreign-affairs'))
assert.ok(world.categorySources['tech-depth-world']?.includes('quanta'))
assert.ok(!world.categorySources.science?.includes('gnews-science'))
assert.ok(world.categorySources['science-world']?.includes('gnews-science'))
assert.deepEqual(world.enabledSourceIds, [])
assert.ok(world.hiddenCategoryIds.includes('mix'))
assert.equal(world.categoryOrder.filter((id) => !world.hiddenCategoryIds.includes(id))[0], 'intl')

const mindful = normalizeSnapshot(findBuiltinPreset('builtin-mindful')!.snapshot)
assert.ok(mindful.categorySources.science?.includes('guokr'))
assert.ok(mindful.categorySources.tech?.includes('v2ex'))
assert.ok(mindful.categorySources.edu?.includes('netease-edu'))
assert.ok(mindful.categorySources.blog?.includes('netease-blog'))
assert.ok(mindful.categorySources.theue?.includes('theue'))
assert.ok(mindful.categorySources.zhihu?.includes('zhihu-daily'))
assert.deepEqual(mindful.enabledSourceIds, [])
assert.equal(mindful.categoryOrder[0], 'science')
assert.ok(mindful.hiddenCategoryIds.includes('mix'))
assert.deepEqual(
  mindful.categoryOrder.filter((id) => !mindful.hiddenCategoryIds.includes(id)),
  ['science', 'tech', 'edu', 'theue', 'zhihu', 'blog', 'fun'],
)

const fun = normalizeSnapshot(findBuiltinPreset('builtin-fun')!.snapshot)
assert.ok(fun.categorySources.fun?.includes('netease-fun'))
assert.ok(fun.categorySources.ent?.includes('netease-ent'))
assert.ok(!fun.categorySources.ent?.includes('gnews-ent'))
assert.deepEqual(fun.categorySources['ent-world'], ['gnews-ent'])
assert.ok(fun.categorySources.travel?.includes('netease-travel'))
assert.deepEqual(fun.enabledSourceIds, [])
assert.equal(fun.categoryOrder[0], 'fun')
assert.deepEqual(
  fun.categoryOrder.filter((id) => !fun.hiddenCategoryIds.includes(id)),
  ['fun', 'ent', 'game', 'history', 'travel', 'zhihu', 'ent-world'],
)
assert.ok(fun.hiddenCategoryIds.includes('mix'))

for (const preset of BUILTIN_PRESETS) {
  const snap = normalizeSnapshot(preset.snapshot)
  assert.ok(snap.hiddenCategoryIds.includes('mix'), `${preset.id} must hide mix`)
  assert.deepEqual(snap.enabledSourceIds, [], `${preset.id} must not use mix enabled list`)
}

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
  ['intl', 'hot', 'science', 'intl-world', 'tech-depth-world', 'science-world'],
)

const depthApply = activatePreset(migrated, 'builtin-depth')!
const depthPrefs = applySnapshotToPrefs(DEFAULT_PREFERENCES, depthApply.snapshot)
assert.deepEqual(
  visibleCategories(depthPrefs).map((c) => c.id),
  [
    'theue',
    'intl',
    'tech',
    'science',
    'intl-world',
    'tech-depth-world',
    'astral-codex-ten',
    'marginalian',
    'aldaily',
  ],
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


