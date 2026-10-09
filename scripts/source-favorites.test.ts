import assert from 'node:assert/strict'

import { FAVORITES_CATEGORY_ID } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  categorySourceIds,
  normalizePreferences,
  removeCategorySource,
  sourceIdsForCategoryWithPrefs,
  toggleFavoriteSource,
  visibleCategories,
  withFavoriteCategory,
  withRecommendCategory,
} from '../src/sources/preferences'
import { applySnapshotToPrefs, normalizeSnapshot, snapshotFromRuntime } from '../src/sources/presets'

const base = normalizePreferences(DEFAULT_PREFERENCES)
const favorited = toggleFavoriteSource(base, 'netease')
assert.deepEqual(favorited.favoriteSourceIds, ['netease'])
const categories = withFavoriteCategory(withRecommendCategory(visibleCategories(favorited), false), favorited.favoriteSourceIds)
assert.equal(categories[0]?.id, FAVORITES_CATEGORY_ID)
assert.deepEqual(sourceIdsForCategoryWithPrefs(FAVORITES_CATEGORY_ID, favorited, []), ['netease'])

const hotOnly = normalizePreferences({
  ...DEFAULT_PREFERENCES,
  categorySources: { ...DEFAULT_PREFERENCES.categorySources, hot: ['netease'] },
})
const removed = removeCategorySource(hotOnly, 'hot', 'netease')
assert.deepEqual(removed.categorySources.hot, [])
assert.deepEqual(categorySourceIds('hot', removed), [])
assert.deepEqual(sourceIdsForCategoryWithPrefs('hot', removed, ['ithome']), [])

const normalized = normalizePreferences({
  ...DEFAULT_PREFERENCES,
  categorySources: { hot: [] },
  favoriteSourceIds: ['netease', 'missing-source'],
})
assert.deepEqual(normalized.categorySources.hot, [])
assert.deepEqual(normalized.favoriteSourceIds, ['netease'])

const presetA = snapshotFromRuntime(toggleFavoriteSource(base, 'netease'), [])
const presetB = snapshotFromRuntime(toggleFavoriteSource(base, 'ithome'), [])
assert.deepEqual(applySnapshotToPrefs(base, presetA).favoriteSourceIds, ['netease'])
assert.deepEqual(applySnapshotToPrefs(base, presetB).favoriteSourceIds, ['ithome'])

const legacy = normalizeSnapshot({
  categoryOrder: ['hot'],
  hiddenCategoryIds: [],
  categorySources: { hot: [] },
  customCategories: [],
  enabledSourceIds: [],
})
assert.deepEqual(legacy.favoriteSourceIds, [])
assert.deepEqual(legacy.categorySources.hot, [])

console.log('source favorites: ok')
