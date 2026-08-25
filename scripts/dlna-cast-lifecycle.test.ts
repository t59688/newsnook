import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const plugin = read('android/app/src/main/java/com/aizeek/newsnook/DlnaCastPlugin.java')
const service = read('android/app/src/main/java/com/aizeek/newsnook/DlnaCastForegroundService.java')
const manifest = read('android/app/src/main/AndroidManifest.xml')
const player = read('src/components/InkVideoPlayer.tsx')
const castControls = read('src/components/inkVideoPlayer/useCastControls.ts')
const castOverlay = read('src/components/inkVideoPlayer/CastOverlay.tsx')
const castApi = read('src/lib/dlnaCast.ts')

assert.match(plugin, /setTransportUri\(device, url, title, format\)/)
assert.match(plugin, /confirmDirectPlayback\(device\)/)
assert.match(plugin, /mediaProxy\.openSession\(url, device\.host, device\.network\)/)
assert.ok(
  plugin.indexOf('setTransportUri(device, url, title, format)')
    < plugin.indexOf('mediaProxy.openSession(url, device.host, device.network)'),
  'direct cast must be attempted before the phone relay',
)
assert.match(plugin, /@PluginMethod\s+public void restore\(PluginCall call\)/)
assert.match(plugin, /DlnaCastForegroundService\.registerRelay/)
assert.doesNotMatch(plugin, /mediaProxy\.close\(\);/)

assert.match(service, /FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE/)
assert.match(service, /START_NOT_STICKY/)
assert.match(service, /PARTIAL_WAKE_LOCK/)
assert.match(service, /WIFI_MODE_FULL_HIGH_PERF/)

assert.match(manifest, /android\.permission\.FOREGROUND_SERVICE_CONNECTED_DEVICE/)
assert.match(manifest, /android:foregroundServiceType="connectedDevice"/)
assert.match(manifest, /android:stopWithTask="false"/)

assert.doesNotMatch(
  player,
  /if \(activeCast\) void stopDlnaCast\(activeCast\.id\)/,
  'unmounting InkVideoPlayer must not stop television playback',
)
assert.doesNotMatch(
  castControls,
  /if \(activeCast\) void stopDlnaCast\(activeCast\.id\)/,
  'unmounting the cast controls hook must not stop television playback',
)
assert.match(castOverlay, /电视独立播放/)
assert.match(castOverlay, /兼容模式/)
assert.match(castApi, /export type DlnaCastMode = 'direct' \| 'proxy'/)
assert.match(castApi, /restore\(\): Promise<DlnaCastRestoreResult>/)

console.log('DLNA cast lifecycle checks passed')
