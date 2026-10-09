import { projectLocalState } from '../src/features/sync/projection'
import { applyRemoteRecords } from '../src/features/sync/merge'
import { buildFreshInstallPresetsState } from '../src/sources/presets'
import { subscriptionPayloadSchema } from '@newsnook/contracts'
import assert from 'node:assert/strict'
import { normalizeCatalogProfile, catalogProfileFor, normalizeFrameworkHint } from '../src/features/siteCatalog/profile'
import { addCustomSource, updateCustomSource, normalizePreferences, DEFAULT_PREFERENCES } from '../src/sources/preferences'
const url = 'https://example.test/sub/'
const profile = { version: 1, rulesRevision: 1, siteRoot: 'https://example.test/', engine: 'typecho', categories: [{ title: '分类', url: '/sub/category/news/' }], search: { method: 'POST', url: '/sub/search', form: { q: '{query}', scope: 'post', csrf_token: 'do-not-save' } } }
const safe = normalizeCatalogProfile(profile, url)!
assert.equal(safe.search?.form?.csrf_token, undefined)
assert.equal(safe.categories[0].url, 'https://example.test/sub/category/news/')
assert.equal(normalizeCatalogProfile({ ...profile, version: 2 }, url), undefined)
assert.equal(normalizeCatalogProfile({ ...profile, siteRoot: 'https://other.test/' }, url), undefined)
assert.equal(normalizeCatalogProfile({ ...profile, search: { method: 'GET', url: 'javascript:alert(1)' } }, url)?.search, undefined)
const added = addCustomSource(DEFAULT_PREFERENCES, { name: '目录', url, kind: 'web-catalog', catalogProfile: safe })
const prefs = normalizePreferences(JSON.parse(JSON.stringify(added.nextPrefs)))
assert.deepEqual(prefs.customSources?.[0].catalogProfile, safe, 'configuration restore retains profile')
const edited = updateCustomSource(prefs, added.newSourceId, { url: 'https://new.test/' })
assert.equal(edited.customSources?.[0].id, added.newSourceId, 'editing URL preserves existing identity')
assert.equal(edited.customSources?.[0].catalogProfile, undefined, 'old route rules cleared after URL changes')
const reprobed = updateCustomSource(prefs, added.newSourceId, { catalogProfile: { ...safe, engine: 'wordpress' } })
assert.equal(reprobed.customSources?.[0].catalogProfile?.engine, 'wordpress')
console.log('site catalog configuration: ok')

const local = { prefs, enabledIds: [added.newSourceId], presets: buildFreshInstallPresetsState() }
const projected = Object.values(projectLocalState(local))
const entity = projected.find((entity) => entity.entityId === added.newSourceId)!
assert.deepEqual(subscriptionPayloadSchema.parse(entity.payload).catalogProfile, safe, 'cloud schema retains optional pure profile')
const records = projected.map((entity, index) => ({ ...entity, revision: index + 1, deleted: false, updatedAt: 0 }))
const remote = applyRemoteRecords({ ...local, prefs: DEFAULT_PREFERENCES, enabledIds: [] }, records)
assert.deepEqual(remote.prefs.customSources?.find((source) => source.id === added.newSourceId)?.catalogProfile, safe, 'sync restores the profile using stable source id')

const future = { ...safe, version: 2, extraFeature: { mode: 'future' } }
const importedFuture = normalizePreferences({ ...prefs, customSources: [{ ...prefs.customSources![0], catalogProfile: future }] })
assert.equal(importedFuture.customSources?.[0].catalogProfile, undefined)
assert.deepEqual(importedFuture.customSources?.[0].catalogProfileOpaque, future)
assert.deepEqual(normalizePreferences(JSON.parse(JSON.stringify(importedFuture))).customSources?.[0].catalogProfileOpaque, future, 'future data survives repeated restore')
const futureEntity = Object.values(projectLocalState({ ...local, prefs: importedFuture })).find((entity) => entity.entityId === added.newSourceId)!
assert.deepEqual(futureEntity.payload.catalogProfile, future)
const malformed = { ...prefs.customSources![0], url: 'bad-url', catalogProfile: undefined }
assert.deepEqual(normalizePreferences({ ...prefs, customSources: [malformed] }).customSources, [], 'invalid restored catalog URL cannot enter browser UI')
assert.deepEqual(normalizePreferences({ ...prefs, customSources: [{ ...malformed, kind: 'web-video' }] }).customSources, [], 'legacy kind alias cannot bypass URL validation')
assert.equal(catalogProfileFor(malformed).engine, 'generic', 'direct runtime fallback does not crash on malformed URL')
assert.equal(catalogProfileFor({ ...malformed, catalogProfile: safe }).engine, 'generic', 'invalid base with a saved profile degrades safely')
assert.equal(normalizeCatalogProfile({ ...profile, search: { method: 'GET', url: '/search?csrf_token=session-only&q={query}' } }, url)?.search, undefined)
assert.equal(normalizeFrameworkHint({ framework: 'wordpress', searchTemplate: '/search?nonce=session-only&q={query}' }, url)?.searchTemplate, undefined)
for (const key of ['PHPSESSID', 'JSESSIONID', 'session_id']) {
  assert.equal(normalizeCatalogProfile({ ...profile, search: { method: 'GET', url: `/search?${key}=session-only&q={query}` } }, url)?.search, undefined)
  assert.equal(normalizeFrameworkHint({ framework: 'wordpress', searchTemplate: `/search?${key}=session-only&q={query}` }, url)?.searchTemplate, undefined)
}
