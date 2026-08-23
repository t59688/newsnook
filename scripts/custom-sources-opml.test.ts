import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

const window = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  document: window.document,
})

import {
  discoverFeedsFromHtml,
  exportOpml,
  OPML_IMPORT_SOFT_LIMIT,
  OPML_STARTER_TEMPLATE,
  parseOpml,
} from '../src/lib/opml'
import {
  DEFAULT_PREFERENCES,
  addCustomSource,
  allRegisteredSources,
  batchImportSourcesAndCategories,
  deleteCustomSource,
  deleteCustomSources,
  normalizePreferences,
  sourceIdsForCategoryWithPrefs,
  updateCustomSource,
} from '../src/sources/preferences'
import { SOURCES, findSource } from '../src/sources/registry'

console.log('Testing Custom Sources & OPML Import/Export Lifecycle...')

// 1. Initial State
assert.equal(DEFAULT_PREFERENCES.customSources?.length ?? 0, 0)
const initialSourceCount = SOURCES.length
assert.equal(allRegisteredSources(DEFAULT_PREFERENCES).length, initialSourceCount)

// 2. Add Custom Source
const customSourceDraft = {
  name: '阮一峰的网络日志',
  label: '阮一峰',
  url: 'https://www.ruanyifeng.com/blog/atom.xml',
  siteUrl: 'https://www.ruanyifeng.com/blog/',
}

const { nextPrefs: prefsWithSource, newSourceId } = addCustomSource(
  DEFAULT_PREFERENCES,
  customSourceDraft,
  'tech', // auto-bind to tech category
)

assert.ok(newSourceId.startsWith('custom_'))
assert.equal(prefsWithSource.customSources?.length, 1)
assert.equal(prefsWithSource.customSources[0].name, '阮一峰的网络日志')
assert.equal(prefsWithSource.customSources[0].label, '阮一峰')
assert.equal(prefsWithSource.customSources[0].url, 'https://www.ruanyifeng.com/blog/atom.xml')
assert.equal(prefsWithSource.customSources[0].isCustom, true)
assert.equal(prefsWithSource.customSources[0].group, 'custom')

// Check registry lookup
const allSourcesAfterAdd = allRegisteredSources(prefsWithSource)
assert.equal(allSourcesAfterAdd.length, initialSourceCount + 1)
assert.ok(allSourcesAfterAdd.some((s) => s.id === newSourceId && s.isCustom))

const found = findSource(newSourceId, prefsWithSource.customSources)
assert.ok(found)
assert.equal(found.id, newSourceId)
assert.equal(found.name, '阮一峰的网络日志')

// Check category binding
const techSources = sourceIdsForCategoryWithPrefs('tech', prefsWithSource)
assert.ok(techSources.includes(newSourceId))

// 3. Update Custom Source
const updatedPrefs = updateCustomSource(prefsWithSource, newSourceId, {
  name: '阮一峰博客',
  label: '阮博客',
  url: 'https://feed.ruanyifeng.com/atom.xml',
})
assert.equal(updatedPrefs.customSources?.[0].name, '阮一峰博客')
assert.equal(updatedPrefs.customSources?.[0].label, '阮博客')
assert.equal(updatedPrefs.customSources?.[0].url, 'https://feed.ruanyifeng.com/atom.xml')

// 4. Persistence & Normalization roundtrip
const serialized = JSON.stringify(updatedPrefs)
const parsed = JSON.parse(serialized)
const normalized = normalizePreferences(parsed)

assert.equal(normalized.customSources?.length, 1)
assert.equal(normalized.customSources[0].id, newSourceId)
assert.equal(normalized.customSources[0].name, '阮一峰博客')

// 5. HTML Feed Auto-Discovery
const sampleHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>My Awesome Tech Blog</title>
  <link rel="alternate" type="application/rss+xml" title="Main RSS Feed" href="/rss.xml" />
  <link rel="alternate" type="application/atom+xml" title="Atom Feed" href="https://example.com/atom.xml" />
</head>
<body>
  <h1>Welcome</h1>
</body>
</html>
`

const discoveredFeeds = discoverFeedsFromHtml(sampleHtml, 'https://example.com/blog/')
assert.equal(discoveredFeeds.length, 2)
assert.equal(discoveredFeeds[0].title, 'Main RSS Feed')
assert.equal(discoveredFeeds[0].url, 'https://example.com/rss.xml')
assert.equal(discoveredFeeds[1].title, 'Atom Feed')
assert.equal(discoveredFeeds[1].url, 'https://example.com/atom.xml')

// 6. OPML Parsing (Nested Categories & Flat)
const sampleOpml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>My Subscriptions</title>
  </head>
  <body>
    <outline text="独立博客" title="独立博客">
      <outline type="rss" text="酷 壳 – CoolShell" title="酷 壳 – CoolShell" xmlUrl="https://coolshell.cn/feed" htmlUrl="https://coolshell.cn"/>
      <outline type="rss" text="云风的 BLOG" title="云风的 BLOG" xmlUrl="https://blog.codingnow.com/atom.xml" htmlUrl="https://blog.codingnow.com/"/>
    </outline>
    <outline type="rss" text="Hacker News" title="Hacker News" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com"/>
  </body>
</opml>`

const opmlParsed = parseOpml(sampleOpml)
assert.equal(opmlParsed.sources.length, 3)
assert.equal(opmlParsed.categories.length, 1)
assert.equal(opmlParsed.categories[0].sourceIds.length, 2)
const coolshellId = opmlParsed.sources.find((s) => s.url === 'https://coolshell.cn/feed')?.id
const codingnowId = opmlParsed.sources.find((s) => s.url === 'https://blog.codingnow.com/atom.xml')?.id
assert.ok(coolshellId && opmlParsed.categories[0].sourceIds.includes(coolshellId))
assert.ok(codingnowId && opmlParsed.categories[0].sourceIds.includes(codingnowId))

assert.equal(OPML_IMPORT_SOFT_LIMIT, 100)

{
  const starter = parseOpml(OPML_STARTER_TEMPLATE)
  assert.equal(starter.title, '我的订阅')
  assert.equal(starter.sources.length, 1)
  assert.equal(starter.sources[0].url, 'https://example.com/feed.xml')
  assert.equal(starter.categories.length, 1)
  assert.equal(starter.categories[0].label, '分类名')
}

console.log('✓ OPML starter template parses for text-editor import')

// 7. Batch Import Sources & Categories
const batchPrefs = batchImportSourcesAndCategories(
  DEFAULT_PREFERENCES,
  opmlParsed.sources,
  opmlParsed.categories,
)
assert.equal(batchPrefs.customSources?.length, 3)
assert.equal(batchPrefs.customCategories?.length, 1)
const importedCategory = batchPrefs.customCategories?.[0]
assert.ok(importedCategory)
assert.equal(importedCategory.label, '独立博客')
assert.equal(importedCategory.sourceIds.length, 2)

// Verify category sources resolve correctly
const categorySources = sourceIdsForCategoryWithPrefs(importedCategory.id, batchPrefs)
assert.equal(categorySources.length, 2)
categorySources.forEach((srcId) => {
  const s = findSource(srcId, batchPrefs.customSources)
  assert.ok(s)
  assert.ok(s.isCustom)
})

// 8. OPML Exporting
const exportedXml = exportOpml(batchPrefs, false)
assert.ok(exportedXml.includes('<?xml version="1.0" encoding="UTF-8"?>'))
assert.ok(exportedXml.includes('<opml version="2.0">'))
assert.ok(exportedXml.includes('text="独立博客"'))
assert.ok(exportedXml.includes('xmlUrl="https://coolshell.cn/feed"'))
assert.ok(exportedXml.includes('xmlUrl="https://blog.codingnow.com/atom.xml"'))

// Re-parse exported XML to ensure lossless roundtrip
const reparsedOpml = parseOpml(exportedXml)
assert.equal(reparsedOpml.sources.length, 3)
assert.equal(reparsedOpml.categories.length, 1)
assert.equal(reparsedOpml.categories[0].label, '独立博客')

// 9. Delete Custom Source
const afterDeletePrefs = deleteCustomSource(batchPrefs, batchPrefs.customSources![0].id)
assert.equal(afterDeletePrefs.customSources?.length, 2)
// Custom category should have deleted source removed from its sourceIds
const catAfterDelete = afterDeletePrefs.customCategories?.[0]
assert.equal(catAfterDelete?.sourceIds.length, 1)

// 10. Batch delete is atomic and cleans every category reference in one update
const batchDeleteIds = [...importedCategory.sourceIds]
const afterBatchDeletePrefs = deleteCustomSources(batchPrefs, batchDeleteIds)
assert.equal(afterBatchDeletePrefs.customSources?.length, 1)
assert.equal(afterBatchDeletePrefs.customCategories?.length, 0)
assert.ok(
  afterBatchDeletePrefs.customSources?.some(
    (source) => source.url === 'https://news.ycombinator.com/rss',
  ),
)
assert.ok(
  Object.values(afterBatchDeletePrefs.categorySources).every((sourceIds) =>
    sourceIds.every((sourceId) => !batchDeleteIds.includes(sourceId)),
  ),
)

// Unknown ids are a no-op, so callers can safely submit a stale selection snapshot.
assert.strictEqual(deleteCustomSources(batchPrefs, ['custom_missing']), batchPrefs)

console.log('Custom Sources & OPML tests: ALL PASSED SUCCESSFULLY!')
