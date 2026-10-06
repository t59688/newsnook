import assert from 'node:assert/strict'

import {
  findSubscriptionDuplicate,
  replaceCustomSourceInstance,
  setCustomSourcePaused,
} from '../src/features/feedDiscovery/subscriptionActions'
import { buildPrestorePlan, seedPrestoreWindows } from '../src/features/prestore/model'
import {
  DEFAULT_PREFERENCES,
  automaticSourceIds,
  recommendationScopeSourceIds,
  sourceIdsForCategoryWithPrefs,
  type Preferences,
} from '../src/sources/preferences'
import {
  removeSourcesFromPresets,
  snapshotFromRuntime,
  type PresetsState,
} from '../src/sources/presets'

console.log('Testing feed discovery domain...')

const customId = 'custom_pause_test'
const customSource = {
  id: customId,
  name: '暂停测试',
  label: '暂停',
  group: 'custom' as const,
  kind: 'feed' as const,
  url: 'https://example.com/feed.xml',
  enabled: true,
  isCustom: true,
  createdAt: 123,
  paused: false,
  discovery: {
    providerId: 'rsshub-docs',
    entryId: 'route',
    generator: 'rsshub' as const,
    instanceId: 'a',
    routeKey: 'route',
    params: { user: 'abc' },
  },
}
const prefs: Preferences = {
  ...DEFAULT_PREFERENCES,
  customSources: [customSource],
  categorySources: {
    ...DEFAULT_PREFERENCES.categorySources,
    'cn-headlines': [customId],
  },
}
assert.deepEqual(sourceIdsForCategoryWithPrefs('cn-headlines', prefs, []), [customId])
assert.deepEqual(recommendationScopeSourceIds(prefs, [customId]).filter((id) => id === customId), [customId])

const paused = setCustomSourcePaused(prefs, customId, true)
assert.deepEqual(sourceIdsForCategoryWithPrefs('cn-headlines', paused, []), [customId])
assert.deepEqual(automaticSourceIds([customId], paused), [])
assert.equal(recommendationScopeSourceIds(paused, [customId]).includes(customId), false)
assert.equal(buildPrestorePlan('p', paused, [customId]).sources.some((item) => item.source.id === customId), false)
const retained = seedPrestoreWindows(buildPrestorePlan('p', paused, [customId]), {
  sources: { [customId]: { categoryId: 'cn-headlines', articleIds: ['cached'] } },
  articles: { cached: { title: 'already cached' } },
}, 10)
assert.deepEqual(retained.sources[customId]?.articleIds, ['cached'], 'pause must retain prestore windows without scheduling network')

assert.equal(
  findSubscriptionDuplicate(prefs, {
    url: 'https://another.example.com/generated.xml',
    discovery: {
      providerId: 'other',
      entryId: 'other',
      generator: 'rsshub',
      instanceId: 'b',
      routeKey: 'route',
      params: { user: 'abc' },
    },
  })?.kind,
  'generator-route',
)

const switched = replaceCustomSourceInstance(
  prefs,
  customId,
  'https://new.example.com/feed.xml',
  {
    ...customSource.discovery,
    instanceId: 'b',
  },
)
const switchedSource = switched.customSources?.[0]
assert.equal(switchedSource?.id, customId)
assert.equal(switchedSource?.name, customSource.name)
assert.equal(switchedSource?.createdAt, 123)
assert.equal(switchedSource?.url, 'https://new.example.com/feed.xml')
assert.equal(switchedSource?.discovery?.instanceId, 'b')

const snapshot = snapshotFromRuntime(prefs, [customId])
const presetState: PresetsState = {
  schemaVersion: 2,
  activePresetId: 'user-test',
  userPresets: [
    {
      id: 'user-test',
      name: '测试',
      builtin: false,
      updatedAt: 1,
      snapshot,
    },
  ],
  builtinOverrides: {},
}
const cleanedPresets = removeSourcesFromPresets(presetState, [customId])
assert.equal(cleanedPresets.userPresets[0].snapshot.enabledSourceIds.includes(customId), false)
assert.equal(
  Object.values(cleanedPresets.userPresets[0].snapshot.categorySources).some((ids) => ids.includes(customId)),
  false,
)
assert.equal(cleanedPresets.userPresets[0].snapshot.favoriteSourceIds?.includes(customId), false)

console.log('feed discovery domain: ok')
