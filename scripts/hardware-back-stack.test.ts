import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  clearHardwareBackLayersForTests,
  dismissTopHardwareBackLayer,
  hardwareBackLayerCount,
  registerHardwareBackLayer,
} from '../src/lib/hardwareBackStack'

clearHardwareBackLayersForTests()
const calls: string[] = []

const removeA = registerHardwareBackLayer(() => {
  calls.push('a')
  return true
})
const removeB = registerHardwareBackLayer(() => {
  calls.push('b')
  return true
})

assert.equal(hardwareBackLayerCount(), 2)
assert.equal(dismissTopHardwareBackLayer(), true)
assert.deepEqual(calls, ['b'], 'hardware back must dismiss the most recently registered visible layer first')

removeB()
assert.equal(dismissTopHardwareBackLayer(), true)
assert.deepEqual(calls, ['b', 'a'])
removeB()
removeA()
assert.equal(hardwareBackLayerCount(), 0)
assert.equal(dismissTopHardwareBackLayer(), false)

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const presetSource = readFileSync(new URL('../src/components/PresetSwitcher.tsx', import.meta.url), 'utf8')
const dialogSource = readFileSync(new URL('../src/components/ConfirmDialog.tsx', import.meta.url), 'utf8')
const contextMenuSource = readFileSync(new URL('../src/components/ContextActionMenu.tsx', import.meta.url), 'utf8')
const updateDialogSource = readFileSync(new URL('../src/features/appUpdate/UpdateDialog.tsx', import.meta.url), 'utf8')

assert.match(appSource, /dismissTopHardwareBackLayer\(\)/, 'App backButton chain must ask transient layers before navigation or exit')
assert.match(
  appSource,
  /backButton[\s\S]*dismissTopHardwareBackLayer\(\)[\s\S]*CapacitorApp\.exitApp\(\)/,
  'exitApp must remain the final fallback after transient overlays and routes',
)
assert.match(presetSource, /useHardwareBackLayer\(open/, 'PresetSwitcher sheet must consume Android back')
assert.match(dialogSource, /useHardwareBackLayer\(open/, 'shared dialogs must consume Android back')
assert.match(contextMenuSource, /useHardwareBackLayer\(open/, 'context menus must consume Android back')
assert.match(updateDialogSource, /useHardwareBackLayer\(open && Boolean\(release\)/, 'update dialog must consume Android back')

console.log('hardware-back-stack: ok')
