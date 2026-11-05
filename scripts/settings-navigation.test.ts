import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { settingsBackRoute, type SettingsRoute } from '../src/lib/settingsNavigation'

for (const returnTo of ['presets', 'me', undefined] as const) {
  for (const name of ['category-sources', 'category-edit', 'channels'] as const) {
    const child: SettingsRoute = { name, categoryId: 'tech-media', returnTo }
    const category = settingsBackRoute(child)
    assert.deepEqual(category, { name: 'categories', returnTo }, `${name} must preserve the category page's origin`)
    assert.deepEqual(settingsBackRoute(category!), returnTo === 'presets' ? { name: 'presets' } : null,
      'returning from a child must not add, skip or change the next parent')
  }
}
for (const [route, parent] of [
  [{ name: 'presets' }, null],
  [{ name: 'changelog' }, { name: 'about' }],
  [{ name: 'licenses' }, { name: 'about' }],
  [{ name: 'custom-scheme' }, { name: 'appearance' }],
  [{ name: 'feed-store', returnTo: 'custom-sources' }, { name: 'custom-sources' }],
  [{ name: 'feed-store' }, null],
  [{ name: 'ai', returnTo: 'translation' }, { name: 'translation' }],
  [{ name: 'ai', returnTo: 'read-aloud' }, { name: 'read-aloud' }],
  [{ name: 'ai' }, null],
] as const) {
  assert.deepEqual(settingsBackRoute(route), parent)
}

// Verify the real App uses the tested rules for buttons and Android back, and
// carries the origin through every category child entry and source inspection.
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const hardwareBack = app.slice(app.indexOf("CapacitorApp.addListener('backButton'"), app.indexOf('void CapacitorApp.minimizeApp()'))
assert.match(hardwareBack, /setSettingsRoute\(settingsBackRoute\(settingsRoute\)\)/)
const categorySection = app.slice(app.indexOf('<CategorySettingsScreen'), app.indexOf('const renderTab'))
assert.match(categorySection, /onBack=\{\(\) => setSettingsRoute\(settingsBackRoute\(settingsRoute\)\)\}/)
for (const entry of ['onEditSources', 'onEditCategory', 'onNewCategory', 'onOpenChannels']) {
  assert.match(categorySection, new RegExp(`${entry}=\\{[^\\n]*returnTo: settingsRoute\\.returnTo`))
}
assert.match(app, /onInspect=\{\(id\) => openSourceFeed\(id, settingsRoute\)\}/)
console.log('Settings navigation: category origins, nested round trips, parent routes and Android/header wiring passed')
