import assert from 'node:assert/strict'

import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  addCustomSource,
  allRegisteredCategories,
  categorySourceIds,
  deleteCustomCategory,
  describeSources,
  isCategoryVisible,
  normalizePreferences,
  orderedCategories,
  renameCategory,
  resetCategoryLayout,
  resolveCategory,
  updateCustomCategory,
  visibleCategories,
} from '../src/sources/preferences'

console.log('Testing custom category lifecycle...')

// 1. Initial state
assert.equal(DEFAULT_PREFERENCES.customCategories?.length ?? 0, 0)
const initialRegistered = allRegisteredCategories(DEFAULT_PREFERENCES)
const initialCount = initialRegistered.length

// 2. Add custom category
const { nextPrefs: prefsWithCustom, newCategoryId } = addCustomCategory(DEFAULT_PREFERENCES, {
  label: '深度专栏',
  short: '专栏',
  sourceIds: ['bbc-zh', 'mittr', 'wired'],
})

assert.ok(newCategoryId.startsWith('custom_'))
assert.equal(prefsWithCustom.customCategories?.length, 1)
assert.equal(prefsWithCustom.customCategories[0].label, '深度专栏')
assert.equal(prefsWithCustom.customCategories[0].short, '专栏')
assert.deepEqual(prefsWithCustom.customCategories[0].sourceIds, ['bbc-zh', 'mittr', 'wired'])

// Check registered and visible categories
const registeredAfterAdd = allRegisteredCategories(prefsWithCustom)
assert.equal(registeredAfterAdd.length, initialCount + 1)
assert.ok(registeredAfterAdd.some((c) => c.id === newCategoryId && c.isCustom))

const visibleAfterAdd = visibleCategories(prefsWithCustom)
assert.ok(visibleAfterAdd.some((c) => c.id === newCategoryId))
assert.ok(isCategoryVisible(newCategoryId, prefsWithCustom))

// 3. Update custom category
const updatedPrefs = updateCustomCategory(prefsWithCustom, newCategoryId, {
  label: '全球极客精选',
  short: '极客',
  sourceIds: ['mittr', 'wired', 'solidot'],
})

const updatedCategory = updatedPrefs.customCategories?.find((c) => c.id === newCategoryId)
assert.ok(updatedCategory)
assert.equal(updatedCategory.label, '全球极客精选')
assert.equal(updatedCategory.short, '极客')
assert.deepEqual(updatedCategory.sourceIds, ['mittr', 'wired', 'solidot'])

// 4. Persistence & Normalization roundtrip
const serialized = JSON.stringify(updatedPrefs)
const parsed = JSON.parse(serialized)
const normalized = normalizePreferences(parsed)

assert.equal(normalized.customCategories?.length, 1)
assert.equal(normalized.customCategories[0].id, newCategoryId)
assert.equal(normalized.customCategories[0].label, '全球极客精选')

// 5. Reset category layout (without deleting custom categories)
const resetSoft = resetCategoryLayout(updatedPrefs, { removeCustom: false })
assert.equal(resetSoft.customCategories?.length, 1)
assert.ok(orderedCategories(resetSoft).some((c) => c.id === newCategoryId))

// 6. Reset category layout (with deleting custom categories)
const resetHard = resetCategoryLayout(updatedPrefs, { removeCustom: true })
assert.equal(resetHard.customCategories?.length, 0)
assert.equal(allRegisteredCategories(resetHard).length, initialCount)

// 7. Delete custom category explicitly
const deletedPrefs = deleteCustomCategory(updatedPrefs, newCategoryId)
assert.equal(deletedPrefs.customCategories?.length, 0)
assert.ok(!orderedCategories(deletedPrefs).some((c) => c.id === newCategoryId))
assert.ok(!deletedPrefs.categoryOrder.includes(newCategoryId))
assert.ok(!deletedPrefs.hiddenCategoryIds.includes(newCategoryId))

// 8. 自建信源挂到自建分类：摘要必须能解析 label，不能误显示「未选择信源」
const { nextPrefs: prefsWithRss, newSourceId: customRssId } = addCustomSource(DEFAULT_PREFERENCES, {
  name: 'example.com',
  label: '示例',
  url: 'https://example.com/index.php',
})
const { nextPrefs: prefsRssCategory, newCategoryId: rssCategoryId } = addCustomCategory(prefsWithRss, {
  label: '123214',
  short: '1232',
  sourceIds: [customRssId],
})
assert.equal(describeSources([customRssId]), '未选择信源')
assert.equal(describeSources([customRssId], prefsRssCategory.customSources), '示例')
const rssResolved = resolveCategory(rssCategoryId, prefsRssCategory)
assert.deepEqual(rssResolved.sourceIds, [customRssId])
assert.equal(rssResolved.caption, '示例')

// 9. 内置分类重命名是当前预设的显示覆盖，不改注册表 id / 信源归属
const renamedBuiltinPrefs = normalizePreferences({
  ...DEFAULT_PREFERENCES,
  categoryNames: { 'cn-headlines': { label: '焦点新闻', short: '焦点' } },
})
const renamedBuiltin = resolveCategory('cn-headlines', renamedBuiltinPrefs)
assert.equal(renamedBuiltin.id, 'cn-headlines')
assert.equal(renamedBuiltin.label, '焦点新闻')
assert.equal(renamedBuiltin.short, '焦点')
assert.deepEqual(
  categorySourceIds('cn-headlines', renamedBuiltinPrefs),
  categorySourceIds('cn-headlines', DEFAULT_PREFERENCES),
)
const renamedViaAction = renameCategory(DEFAULT_PREFERENCES, 'cn-headlines', '今日焦点')
assert.equal(resolveCategory('cn-headlines', renamedViaAction).label, '今日焦点')
assert.equal(resolveCategory('cn-headlines', renamedViaAction).short, '今日焦点')

const currentPrefsWithoutNames = { ...DEFAULT_PREFERENCES } as Partial<typeof DEFAULT_PREFERENCES>
delete currentPrefsWithoutNames.categoryNames
assert.equal(
  resolveCategory('cn-headlines', currentPrefsWithoutNames as typeof DEFAULT_PREFERENCES).label,
  '国内要闻',
  '没有 categoryNames 时应回落当前 taxonomy 注册表名称',
)

console.log('custom category lifecycle: all tests passed successfully!')
