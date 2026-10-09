/**
 * Battery status helpers for the immersive video chrome.
 * Usage: npx tsx scripts/battery-status.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

{
  const source = readFileSync(join(process.cwd(), 'src/lib/batteryStatus.ts'), 'utf8')
  assert.match(source, /subscribeBatteryStatus/)
  assert.match(source, /levelchange/)
  assert.match(source, /getNativeBattery/)
}

{
  const media = readFileSync(join(process.cwd(), 'src/lib/deviceMediaControls.ts'), 'utf8')
  assert.match(media, /getBattery\(\): Promise<\{ level: number; charging: boolean \}>/)
  assert.match(media, /export async function getNativeBattery/)
}

{
  const java = readFileSync(
    join(process.cwd(), 'android/app/src/main/java/com/aizeek/newsnook/DeviceMediaControlsPlugin.java'),
    'utf8',
  )
  assert.match(java, /public void getBattery\(PluginCall call\)/)
  assert.match(java, /ACTION_BATTERY_CHANGED/)
  assert.match(java, /EXTRA_LEVEL/)
  assert.match(java, /BATTERY_STATUS_CHARGING/)
}

{
  const player = readFileSync(join(process.cwd(), 'src/components/InkVideoPlayer.tsx'), 'utf8')
  assert.match(player, /subscribeBatteryStatus\(setBattery\)/)
  assert.match(player, /PlayerBatteryIcon/)
  assert.match(player, /status=\{battery\}/)
}

console.log('battery-status: ok')
