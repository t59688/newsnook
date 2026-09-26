/**
 * Taxonomy v3 preset contracts:
 * - eight mutually-exclusive built-in preset domains
 * - at most eight visible categories per built-in
 * - every non-workspace built-in source is assigned exactly once
 * - legacy/user layouts are preserved as custom layouts instead of being guessed into v2 categories
 */
import assert from 'node:assert/strict'

import {
  CATEGORIES,
  CATEGORY_TAXONOMY_VERSION,
  duplicateCategorizedSourceIds,
  duplicateCategoryLabels,
  uncoveredSourceIds,
} from '../src/sources/categories'
import { LEGACY_CATEGORY_DEFINITIONS } from '../src/sources/legacyTaxonomy'
import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  addCustomSource,
  categorySourceIds,
  normalizePreferences,
  resolveCategory,
  visibleCategories,
} from '../src/sources/preferences'
import {
  BUILTIN_AI_ID,
  BUILTIN_BIZ_ID,
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEPTH_ID,
  BUILTIN_LIFE_ID,
  BUILTIN_PRESETS,
  BUILTIN_SCIENCE_ID,
  BUILTIN_TECH_ID,
  BUILTIN_WORLD_ID,
  MIGRATE_LAYOUT_PRESET_ID,
  PRESETS_SCHEMA_VERSION,
  activatePreset,
  applySnapshotToPrefs,
  buildFreshInstallPresetsState,
  buildMigratedPresetsState,
  createBlankUserPreset,
  deleteUserPreset,
  duplicateCategoriesAcrossBuiltins,
  duplicateSourcesAcrossBuiltins,
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
  unassignedBuiltinPresetSourceIds,
  updateActiveSnapshot,
  updateUserPresetSnapshot,
} from '../src/sources/presets'
import { SOURCES } from '../src/sources/registry'

const visibleIds = (presetId: string) => {
  const snapshot = normalizeSnapshot(findBuiltinPreset(presetId)!.snapshot)
  return snapshot.categoryOrder.filter((id) => !snapshot.hiddenCategoryIds.includes(id))
}

const legacyHiddenExcept = (...visible: string[]) => {
  const keep = new Set(visible)
  return [
    'mix',
    ...LEGACY_CATEGORY_DEFINITIONS.map((category) => category.id).filter((id) => !keep.has(id)),
  ]
}

// —— Current snapshot normalize / custom source lifecycle ——
const snap = normalizeSnapshot({
  categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
  categoryOrder: ['mix', 'tech-digital', 'ghost-cat'],
  hiddenCategoryIds: ['science-general', 'ghost-cat'],
  categorySources: { 'tech-digital': ['ithome', 'nope'], ghost: ['ithome'] },
  customCategories: [],
  enabledSourceIds: ['ithome', 'ithome', 'missing'],
})

assert.deepEqual(snap.categoryOrder, ['mix', 'tech-digital'])
assert.ok(!snap.hiddenCategoryIds.includes('ghost-cat'))
assert.deepEqual(snap.categorySources['tech-digital'], ['ithome'])
assert.deepEqual(snap.enabledSourceIds, ['ithome'])
assert.equal(snap.categoryTaxonomyVersion, CATEGORY_TAXONOMY_VERSION)

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
  { label: '我的订阅', short: '我的', sourceIds: [customRssId] },
)
const customSnap = snapshotFromRuntime(prefsCustomLayout, [customRssId, 'ithome'])
const savedCustomCat = customSnap.customCategories.find((category) => category.id === customCatId)
assert.ok(savedCustomCat)
assert.deepEqual(savedCustomCat.sourceIds, [customRssId])
assert.ok(customSnap.enabledSourceIds.includes(customRssId))

const restoredPrefs = applySnapshotToPrefs(prefsCustomLayout, customSnap)
assert.deepEqual(categorySourceIds(customCatId, restoredPrefs), [customRssId])
assert.equal(resolveCategory(customCatId, restoredPrefs).caption, '示例')

const renamedRuntime = {
  ...DEFAULT_PREFERENCES,
  categoryNames: { 'tech-digital': { label: '数码前沿', short: '数码' } },
}
const renamedSnap = snapshotFromRuntime(renamedRuntime, ['ithome'])
const renamedRestored = applySnapshotToPrefs(DEFAULT_PREFERENCES, renamedSnap)
assert.equal(resolveCategory('tech-digital', renamedRestored).label, '数码前沿')

console.log('layout-presets core: ok')

// —— Taxonomy partition invariants ——
assert.equal(BUILTIN_PRESETS.length, 8)
const legacyCategoryIds = new Set(LEGACY_CATEGORY_DEFINITIONS.map((category) => category.id))
assert.deepEqual(
  CATEGORIES.map((category) => category.id).filter((id) => legacyCategoryIds.has(id)),
  [],
  'taxonomy v2 ids must not overlap v1 ids; migration must stay unambiguous',
)
assert.deepEqual(duplicateCategorizedSourceIds(), [])
assert.deepEqual(duplicateCategoryLabels(), [])
assert.deepEqual(uncoveredSourceIds(), [])
assert.deepEqual(duplicateCategoriesAcrossBuiltins(), [])
assert.deepEqual(duplicateSourcesAcrossBuiltins(), [])
assert.deepEqual(unassignedBuiltinPresetSourceIds(), [])

// Information-architecture guardrails: built-in rails stay scan-friendly instead of growing into dumps.
for (const category of CATEGORIES.filter((item) => item.id !== 'mix')) {
  assert.ok(
    (category.sourceIds?.length ?? 0) >= 1,
    `${category.id} must not be an empty built-in category`,
  )
  assert.ok(
    (category.sourceIds?.length ?? 0) <= 6,
    `${category.id} is too broad (${category.sourceIds?.length ?? 0} sources); split it by a real reading intent`,
  )
}

const categoryForSource = (sourceId: string) =>
  CATEGORIES.find((category) => category.sourceIds?.includes(sourceId))?.id
const highOverlapPairs = [
  ['netease-tech', 'netease-phone'],
  ['netease-tech', 'netease-digital'],
  ['netease-sports', 'netease-nba'],
  ['netease-sports', 'netease-cba'],
  ['netease-sports', 'netease-football'],
  ['netease-sports', 'netease-cn-football'],
  ['mittr', 'mittr-ai'],
  ['verge', 'verge-ai'],
  ['scmp-news', 'scmp-china'],
] as const
for (const [left, right] of highOverlapPairs) {
  assert.notEqual(
    categoryForSource(left),
    categoryForSource(right),
    `${left} / ${right} are parent/sub or high-overlap channels and must not share one rail`,
  )
}
assert.equal(categoryForSource('zhihu-daily'), 'depth-books')
assert.equal(CATEGORIES.find((category) => category.id === 'depth-books')?.label, '中文精选')
assert.equal(categoryForSource('swarma'), 'science-research')
assert.equal(categoryForSource('netease-diqiu'), 'science-earth')
assert.equal(categoryForSource('lil-log'), 'ai-engineering')
assert.equal(
  CATEGORIES.find((category) => category.id === 'ai-labs')?.label,
  '厂商资讯',
  'AI 前沿的厂商分类必须使用“资讯”，不能误写成“咨询”',
)

const nonWorkspaceSources = SOURCES.filter((source) => !source.workspaceOnly)
assert.equal(nonWorkspaceSources.length, 153)
assert.equal(SOURCES.find((source) => source.id === 'zhihu-community')?.workspaceOnly, true)

const assignedSourceIds = BUILTIN_PRESETS.flatMap((preset) =>
  Object.values(preset.snapshot.categorySources).flat(),
)
assert.equal(assignedSourceIds.length, 153)
assert.ok(!assignedSourceIds.includes('zhihu-community'))
assert.equal(new Set(assignedSourceIds).size, assignedSourceIds.length)

for (const preset of BUILTIN_PRESETS) {
  const visible = visibleIds(preset.id)
  assert.ok(visible.length >= 1 && visible.length <= 8, preset.name + ' category count=' + visible.length)
  assert.ok(preset.snapshot.hiddenCategoryIds.includes('mix'), preset.name + ' must hide mix')
  assert.deepEqual(preset.snapshot.enabledSourceIds, [])
  assert.deepEqual(duplicateSourcesAcrossCategories(preset.snapshot.categorySources), [])
  assert.deepEqual(mixThemeOverlap(preset.snapshot.categorySources, preset.snapshot.enabledSourceIds), [])
}

assert.deepEqual(visibleIds(BUILTIN_DEFAULT_ID), [
  'cn-headlines',
  'cn-select',
  'cn-public',
  'cn-dialogue',
  'cn-opinion',
  'cn-external',
])
assert.deepEqual(visibleIds(BUILTIN_WORLD_ID), [
  'world-zh',
  'world-zh-press',
  'world-news',
  'world-news-press',
  'world-asia',
  'world-opinion',
])
assert.deepEqual(visibleIds(BUILTIN_BIZ_ID), [
  'biz-market',
  'biz-finance',
  'biz-company',
  'biz-startup',
  'biz-industry',
  'biz-global',
])
assert.deepEqual(visibleIds(BUILTIN_TECH_ID), [
  'tech-digital',
  'tech-media',
  'tech-news',
  'tech-tools',
  'tech-dev',
  'tech-longform',
])
assert.deepEqual(visibleIds(BUILTIN_AI_ID), [
  'ai-media-cn',
  'ai-thinking',
  'ai-labs',
  'ai-ecosystem',
  'ai-practice',
  'ai-media-en',
  'ai-engineering',
  'ai-watch',
])
assert.deepEqual(visibleIds(BUILTIN_SCIENCE_ID), [
  'science-general',
  'science-research',
  'science-basic',
  'science-earth',
  'science-health',
])
assert.deepEqual(visibleIds(BUILTIN_DEPTH_ID), [
  'depth-reporting',
  'depth-books',
  'depth-knowledge',
  'depth-culture',
  'depth-blogs',
])
assert.deepEqual(visibleIds(BUILTIN_LIFE_ID), [
  'life-sports',
  'life-basketball',
  'life-football',
  'life-running',
  'life-ent',
  'life-games',
  'life-fun',
  'life-travel',
])

const expectedPresetSourceCounts = new Map([
  [BUILTIN_DEFAULT_ID, 11],
  [BUILTIN_WORLD_ID, 22],
  [BUILTIN_BIZ_ID, 17],
  [BUILTIN_TECH_ID, 23],
  [BUILTIN_AI_ID, 39],
  [BUILTIN_SCIENCE_ID, 13],
  [BUILTIN_DEPTH_ID, 13],
  [BUILTIN_LIFE_ID, 15],
])
for (const preset of BUILTIN_PRESETS) {
  const count = Object.values(preset.snapshot.categorySources).flat().length
  assert.equal(count, expectedPresetSourceCounts.get(preset.id), preset.name + ' source count')
}

assert.deepEqual(
  visibleCategories(DEFAULT_PREFERENCES).map((category) => category.id),
  visibleIds(BUILTIN_DEFAULT_ID),
)

console.log('layout-presets builtins: ok')

// —— Taxonomy v2 -> v3: newly split built-in rails must not leak into saved user layouts ——
const v3AddedIds = [
  'cn-select',
  'world-zh-press',
  'world-news-press',
  'biz-startup',
  'tech-news',
  'ai-ecosystem',
]
const v2SavedSnapshot = normalizeSnapshot({
  categoryTaxonomyVersion: 2,
  categoryOrder: ['tech-digital', 'tech-media'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => !['tech-digital', 'tech-media', ...v3AddedIds].includes(id),
  ),
  categorySources: {
    'tech-digital': ['ithome', 'ifanr'],
    'tech-media': ['geekpark', 'mittr'],
  },
  customCategories: [],
  enabledSourceIds: [],
  favoriteSourceIds: [],
})
assert.equal(v2SavedSnapshot.categoryTaxonomyVersion, CATEGORY_TAXONOMY_VERSION)
assert.deepEqual(v2SavedSnapshot.categoryOrder, ['tech-digital', 'tech-media'])
for (const id of v3AddedIds) {
  assert.ok(v2SavedSnapshot.hiddenCategoryIds.includes(id), `${id} must stay hidden in migrated v2 layouts`)
}
assert.deepEqual(v2SavedSnapshot.categorySources['tech-digital'], ['ithome', 'ifanr'])
assert.deepEqual(v2SavedSnapshot.categorySources['tech-media'], ['geekpark', 'mittr'])

const v2SavedPrefs = normalizePreferences({
  categoryTaxonomyVersion: 2,
  categoryOrder: ['tech-digital', 'tech-media'],
  hiddenCategoryIds: CATEGORIES.map((category) => category.id).filter(
    (id) => !['tech-digital', 'tech-media', ...v3AddedIds].includes(id),
  ),
  categorySources: {
    'tech-digital': ['ithome', 'ifanr'],
    'tech-media': ['geekpark', 'mittr'],
  },
})
assert.equal(v2SavedPrefs.categoryTaxonomyVersion, CATEGORY_TAXONOMY_VERSION)
for (const id of v3AddedIds) {
  assert.ok(v2SavedPrefs.hiddenCategoryIds.includes(id), `${id} must stay hidden in migrated v2 prefs`)
}
assert.deepEqual(
  visibleCategories(v2SavedPrefs).map((category) => category.id),
  ['tech-digital', 'tech-media'],
)

// —— Legacy Preferences: preserve exact visible layout as custom categories ——
const legacyPrefs = normalizePreferences({
  categoryOrder: ['hot', 'tech', 'custom_keep'],
  hiddenCategoryIds: legacyHiddenExcept('hot', 'tech'),
  categorySources: {
    hot: ['netease'],
    tech: ['ithome', 'sspai'],
  },
  categoryNames: {
    tech: { label: '我的科技', short: '科技' },
  },
  customCategories: [
    {
      id: 'custom_keep',
      label: '我自己的',
      short: '自定义',
      caption: '',
      sourceIds: ['jandan'],
      isCustom: true,
    },
  ],
  customSources: [],
  favoriteSourceIds: ['ithome'],
})

assert.equal(legacyPrefs.categoryTaxonomyVersion, CATEGORY_TAXONOMY_VERSION)
assert.deepEqual(
  visibleCategories(legacyPrefs).map((category) => category.id),
  ['legacy-v1-hot', 'legacy-v1-tech', 'custom_keep'],
)
assert.equal(resolveCategory('legacy-v1-tech', legacyPrefs).label, '我的科技')
assert.deepEqual(categorySourceIds('legacy-v1-tech', legacyPrefs), ['ithome', 'sspai'])
assert.deepEqual(categorySourceIds('custom_keep', legacyPrefs), ['jandan'])
assert.deepEqual(legacyPrefs.favoriteSourceIds, ['ithome'])
assert.ok(legacyPrefs.hiddenCategoryIds.includes('cn-headlines'))

const migratedRuntime = buildMigratedPresetsState(legacyPrefs, ['ithome'])
assert.equal(migratedRuntime.schemaVersion, PRESETS_SCHEMA_VERSION)
assert.equal(migratedRuntime.activePresetId, MIGRATE_LAYOUT_PRESET_ID)
assert.equal(migratedRuntime.userPresets.length, 1)
assert.equal(migratedRuntime.userPresets[0].name, '升级前布局')
assert.deepEqual(
  visibleCategories(applySnapshotToPrefs(DEFAULT_PREFERENCES, migratedRuntime.userPresets[0].snapshot))
    .map((category) => category.id),
  ['legacy-v1-hot', 'legacy-v1-tech', 'custom_keep'],
)

const migratedLegacyOverride = normalizePresetsState({
  activePresetId: 'builtin-tech',
  userPresets: [],
  builtinOverrides: {
    'builtin-tech': {
      categoryOrder: ['tech'],
      hiddenCategoryIds: legacyHiddenExcept('tech'),
      categorySources: { tech: ['ithome', 'sspai'] },
      customCategories: [],
      enabledSourceIds: [],
      favoriteSourceIds: [],
    },
  },
})!
assert.equal(migratedLegacyOverride.schemaVersion, PRESETS_SCHEMA_VERSION)
assert.equal(migratedLegacyOverride.userPresets.length, 1)
assert.match(migratedLegacyOverride.userPresets[0].name, /旧布局/)
assert.equal(migratedLegacyOverride.activePresetId, migratedLegacyOverride.userPresets[0].id)
assert.deepEqual(
  migratedLegacyOverride.userPresets[0].snapshot.customCategories
    .find((category) => category.id.startsWith('legacy-v1-tech'))
    ?.sourceIds,
  ['ithome', 'sspai'],
)

const oldBuiltinOnly = normalizePresetsState({
  activePresetId: 'builtin-world',
  userPresets: [],
  builtinOverrides: {},
})!
assert.equal(oldBuiltinOnly.activePresetId, BUILTIN_DEFAULT_ID)

console.log('layout-presets migration: ok')

// —— Current lifecycle ——
const fresh = buildFreshInstallPresetsState()
assert.equal(fresh.schemaVersion, PRESETS_SCHEMA_VERSION)
assert.equal(fresh.activePresetId, BUILTIN_DEFAULT_ID)
assert.equal(fresh.userPresets.length, 0)
assert.equal(Object.keys(fresh.builtinOverrides).length, 0)

const defaultSnapshot = resolvePreset(fresh, BUILTIN_DEFAULT_ID)!.snapshot
const { state: afterSave, preset } = saveAsUserPreset(fresh, defaultSnapshot, '我的中国资讯')
assert.equal(preset.builtin, false)
assert.equal(afterSave.activePresetId, preset.id)

const untouched = updateUserPresetSnapshot(afterSave, BUILTIN_DEFAULT_ID, {
  ...preset.snapshot,
  categoryOrder: ['cn-headlines'],
})
assert.equal(untouched, afterSave)

const editedBuiltin = updateActiveSnapshot(
  { ...fresh, activePresetId: BUILTIN_DEFAULT_ID },
  {
    ...findBuiltinPreset(BUILTIN_DEFAULT_ID)!.snapshot,
    hiddenCategoryIds: [
      ...findBuiltinPreset(BUILTIN_DEFAULT_ID)!.snapshot.hiddenCategoryIds,
      'cn-dialogue',
    ],
  },
)
assert.ok(isBuiltinOverridden(editedBuiltin, BUILTIN_DEFAULT_ID))

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

const activated = activatePreset(fresh, BUILTIN_AI_ID)!
assert.equal(activated.state.activePresetId, BUILTIN_AI_ID)
assert.deepEqual(
  visibleCategories(applySnapshotToPrefs(DEFAULT_PREFERENCES, activated.snapshot)).map(
    (category) => category.id,
  ),
  visibleIds(BUILTIN_AI_ID),
)

const blank = createBlankUserPreset(fresh, '空白台')
assert.deepEqual(blank.preset.snapshot, emptyLayoutSnapshot())
assert.equal(blank.state.activePresetId, blank.preset.id)

const renamedBuiltin = renameUserPreset(fresh, BUILTIN_DEFAULT_ID, '内置改名')
assert.equal(renamedBuiltin, fresh)

console.log('layout-presets lifecycle: ok')
console.log('layout-presets: all ok')
