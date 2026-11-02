import assert from 'node:assert/strict'

import {
  DEFAULT_PREFERENCES,
  addCustomCategory,
  addCustomSource,
  addSourcesToCategory,
  categoriesForSource,
  categorySourceIds,
  moveSourceBetweenCategories,
  moveSourcesToCategory,
  normalizePreferences,
  removeCategorySource,
  toggleCategorySource,
  updateCustomCategory,
  deleteCustomSource,
} from '../src/sources/preferences'
import { setCustomSourcesPaused } from '../src/features/feedDiscovery/subscriptionActions'
import { applySnapshotToPrefs, snapshotFromRuntime } from '../src/sources/presets'

function addSource(prefs: typeof DEFAULT_PREFERENCES, name: string, url: string, categoryId?: string) {
  return addCustomSource(prefs, { name, label: name, url }, categoryId)
}

const first = addSource(DEFAULT_PREFERENCES, 'Alpha', 'https://alpha.example/feed.xml', 'tech-media')
const second = addSource(first.nextPrefs, 'Beta', 'https://beta.example/feed.xml', 'world-zh')
const third = addSource(second.nextPrefs, 'Gamma', 'https://gamma.example/feed.xml')
const alphaId = first.newSourceId
const betaId = second.newSourceId
const gammaId = third.newSourceId

// Add is additive, deduplicated, and preserves existing category membership.
const added = addSourcesToCategory(third.nextPrefs, [alphaId, alphaId, gammaId, 'missing'], 'world-zh')
assert.deepEqual(categorySourceIds('tech-media', added), categorySourceIds('tech-media', third.nextPrefs))
assert.ok(categorySourceIds('world-zh', added).includes(alphaId))
assert.ok(categorySourceIds('world-zh', added).includes(gammaId))
assert.equal(categorySourceIds('world-zh', added).filter((id) => id === alphaId).length, 1)
assert.deepEqual(categoriesForSource(added, alphaId), ['world-zh', 'tech-media'])
assert.strictEqual(addSourcesToCategory(added, [alphaId], 'world-zh'), added, 'adding an existing member is a no-op')
assert.strictEqual(addSourcesToCategory(added, [alphaId], 'mix'), added, 'aggregate categories cannot be targets')
assert.strictEqual(addSourcesToCategory(added, [alphaId], 'missing-category'), added)

// Moving a source between two categories removes only the source category membership.
const movedOne = moveSourceBetweenCategories(added, alphaId, 'tech-media', 'world-zh')
assert.ok(!categorySourceIds('tech-media', movedOne).includes(alphaId))
assert.ok(categorySourceIds('world-zh', movedOne).includes(alphaId))
assert.ok(categorySourceIds('world-zh', movedOne).includes(betaId))
assert.deepEqual(categoriesForSource(movedOne, alphaId), ['world-zh'])
assert.strictEqual(moveSourceBetweenCategories(movedOne, alphaId, 'mix', 'tech-media'), movedOne)
assert.strictEqual(moveSourceBetweenCategories(movedOne, alphaId, 'world-zh', 'world-zh'), movedOne)
assert.strictEqual(moveSourceBetweenCategories(movedOne, 'missing', 'world-zh', 'tech-media'), movedOne)

// Batch move is exclusive across all ordinary categories, but leaves aggregate data derived.
const custom = addCustomCategory(added, {
  label: '个人精选',
  short: '精选',
  sourceIds: [alphaId, betaId],
})
const customCategoryId = custom.newCategoryId
const beforeCustom = categorySourceIds(customCategoryId, custom.nextPrefs)
assert.ok(beforeCustom.includes(alphaId))
const customWithGamma = toggleCategorySource(custom.nextPrefs, customCategoryId, gammaId)
assert.ok(customWithGamma.customCategories?.find((category) => category.id === customCategoryId)?.sourceIds?.includes(gammaId))
const customWithoutGamma = removeCategorySource(customWithGamma, customCategoryId, gammaId)
assert.ok(!customWithoutGamma.customCategories?.find((category) => category.id === customCategoryId)?.sourceIds?.includes(gammaId))
const movedBatch = moveSourcesToCategory(custom.nextPrefs, [alphaId, gammaId, alphaId, 'missing'], 'tech-media')
assert.deepEqual(categoriesForSource(movedBatch, alphaId), ['tech-media'])
assert.deepEqual(categoriesForSource(movedBatch, gammaId), ['tech-media'])
assert.ok(!categorySourceIds(customCategoryId, movedBatch).includes(alphaId))
assert.ok(categorySourceIds(customCategoryId, movedBatch).includes(betaId))
assert.ok(categorySourceIds('world-zh', movedBatch).includes(betaId))
assert.ok(categorySourceIds('tech-media', movedBatch).includes(alphaId))
assert.strictEqual(moveSourcesToCategory(movedBatch, [alphaId], 'mix'), movedBatch)
assert.strictEqual(moveSourcesToCategory(movedBatch, ['missing'], 'tech-media'), movedBatch)

// Moving the last source out leaves a valid empty custom category, not the first built-in category.
const emptyCustom = moveSourcesToCategory(custom.nextPrefs, [alphaId, betaId], 'tech-media')
assert.deepEqual(categorySourceIds(customCategoryId, emptyCustom), [])
assert.deepEqual(categoriesForSource(emptyCustom, alphaId), ['tech-media'])
assert.ok(emptyCustom.customCategories?.some((category) => category.id === customCategoryId))
const normalizedEmpty = normalizePreferences(JSON.parse(JSON.stringify(emptyCustom)))
assert.deepEqual(categorySourceIds(customCategoryId, normalizedEmpty), [])
assert.ok(normalizedEmpty.customCategories?.some((category) => category.id === customCategoryId), 'empty custom category survives preferences normalization')
const renamedEmpty = updateCustomCategory(normalizedEmpty, customCategoryId, { label: '空分类' })
assert.equal(renamedEmpty.customCategories?.find((category) => category.id === customCategoryId)?.label, '空分类')
const afterDeletingUnrelatedSource = deleteCustomSource(emptyCustom, gammaId)
assert.ok(afterDeletingUnrelatedSource.customCategories?.some((category) => category.id === customCategoryId), 'deleting another source preserves an already-empty category')
const emptySnapshot = snapshotFromRuntime(emptyCustom, [])
const restoredEmptySnapshot = applySnapshotToPrefs(emptyCustom, emptySnapshot)
assert.deepEqual(categorySourceIds(customCategoryId, restoredEmptySnapshot), [], 'empty custom category survives preset snapshot roundtrip')
assert.ok(restoredEmptySnapshot.customCategories?.some((category) => category.id === customCategoryId))

// Batch pause changes only selected custom sources and preserves all other metadata.
const paused = setCustomSourcesPaused(third.nextPrefs, [alphaId, gammaId, alphaId, 'missing'], true)
assert.equal(paused.customSources?.find((source) => source.id === alphaId)?.paused, true)
assert.equal(paused.customSources?.find((source) => source.id === gammaId)?.paused, true)
assert.equal(paused.customSources?.find((source) => source.id === betaId)?.paused, false)
assert.equal(paused.customSources?.find((source) => source.id === alphaId)?.url, 'https://alpha.example/feed.xml')
assert.equal(paused.customSources?.find((source) => source.id === alphaId)?.name, 'Alpha')
assert.strictEqual(setCustomSourcesPaused(paused, [alphaId, gammaId], true), paused)
const resumed = setCustomSourcesPaused(paused, [alphaId], false)
assert.equal(resumed.customSources?.find((source) => source.id === alphaId)?.paused, false)
assert.equal(resumed.customSources?.find((source) => source.id === gammaId)?.paused, true)

console.log('subscription category management: ok')
