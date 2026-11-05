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
// Legacy taxonomy ids are materialized as custom categories before preferences
// reach the runtime. Removing the last member keeps that migrated category valid.
const migratedHotId = 'legacy-v1-hot'
assert.deepEqual(categorySourceIds(migratedHotId, hotOnly), ['netease'])
const removed = removeCategorySource(hotOnly, migratedHotId, 'netease')
assert.deepEqual(categorySourceIds(migratedHotId, removed), [])
assert.ok(removed.customCategories?.some((category) => category.id === migratedHotId && category.sourceIds?.length === 0))
assert.deepEqual(sourceIdsForCategoryWithPrefs(migratedHotId, removed, ['ithome']), [])

const normalized = normalizePreferences({
  ...DEFAULT_PREFERENCES,
  categorySources: { hot: [] },
  favoriteSourceIds: ['netease', 'missing-source'],
})
assert.equal(Object.prototype.hasOwnProperty.call(normalized.categorySources, 'hot'), false)
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
assert.equal(Object.prototype.hasOwnProperty.call(legacy.categorySources, 'hot'), false)

console.log('source favorites: ok')
