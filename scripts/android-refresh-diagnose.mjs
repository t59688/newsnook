#!/usr/bin/env node
/**
 * Read-only diagnostic for Xiaomi/HyperOS and AOSP high-refresh-rate regressions.
 *
 * Run with the physical phone connected and NewsNook in the foreground:
 *   node scripts/android-refresh-diagnose.mjs
 *   node scripts/android-refresh-diagnose.mjs --serial <adb-serial>
 *
 * Never writes settings, changes display modes, or reveals the device serial.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readDisplayMetrics } from './android-refresh-metrics.mjs'

function adbBinary() {
  const filename = process.platform === 'win32' ? 'adb.exe' : 'adb'
  const homes = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
    ...(process.platform === 'win32' ? ['D:\\Android\\Sdk', 'C:\\Android\\Sdk'] : []),
  ].filter(Boolean)
  for (const home of homes) {
    const file = join(home, 'platform-tools', filename)
    if (existsSync(file)) return file
  }
  return filename
}

const adb = adbBinary()
function run(args) {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 12 * 1024 * 1024, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || (result.stderr || result.stdout).trim())
  return result.stdout.replace(/\r/g, '')
}

const options = process.argv.slice(2)
const serialIdx = options.indexOf('--serial')
const serialArg = serialIdx >= 0 ? options[serialIdx + 1] : null
if (serialIdx >= 0 && !serialArg) throw new Error('--serial requires an adb device serial')

const connected = run(['devices', '-l']).split('\n').slice(1)
  .map(line => line.trim()).filter(line => /\sdevice(?:\s|$)/.test(line))
const phones = connected.filter(line => !line.startsWith('emulator-'))
let selected
if (serialArg) {
  selected = connected.find(line => line.split(/\s+/)[0] === serialArg)
  if (!selected) throw new Error('Requested device is not connected and authorized')
} else {
  const candidates = phones.length ? phones : connected
  if (candidates.length !== 1) {
    throw new Error('Connect exactly one phone (or pass --serial). Connected authorized devices: ' + candidates.length)
  }
  selected = candidates[0]
}
const serial = selected.split(/\s+/)[0]
const shell = (...args) => run(['-s', serial, 'shell', ...args]).trim()

const brand = shell('getprop', 'ro.product.brand')
const maker = shell('getprop', 'ro.product.manufacturer')
const androidVersion = shell('getprop', 'ro.build.version.release')
const buildSdk = shell('getprop', 'ro.build.version.sdk')
const display = shell('dumpsys', 'display')
const powerSave = shell('settings', 'get', 'global', 'low_power')
const miuiRate = shell('settings', 'get', 'secure', 'miui_refresh_rate')
const peakRate = shell('settings', 'get', 'system', 'peak_refresh_rate')
const activity = shell('dumpsys', 'activity', 'activities')
const foreground = activity.match(/^\s*(?:topResumedActivity|mResumedActivity)[:=]\s*[^\n]*?\s([\w.]+)\//m)?.[1]
const newsNookForeground = foreground === 'com.aizeek.newsnook' || foreground === 'com.aizeek.newsnook.debug'
const { renderRate, physicalRate, maximumRate, miuiMaxRate, votes } = readDisplayMetrics(display)

console.log('NewsNook refresh-rate diagnostics (read-only)')
console.log('Manufacturer / brand:', maker + ' / ' + brand)
console.log('Android version / SDK:', androidVersion + ' / ' + buildSdk)
console.log('Foreground:', newsNookForeground ? 'NewsNook' : 'Other app or unknown')
console.log('System render frame rate:', renderRate == null ? 'not exposed' : renderRate + ' Hz')
console.log('Physical display refresh rate:', physicalRate == null ? 'not exposed' : physicalRate + ' Hz')
console.log('Maximum supported display rate:', maximumRate || 'not exposed')
console.log('System peak_refresh_rate:', peakRate)
console.log('HyperOS miui_refresh_rate:', miuiRate)
console.log('Power saver (1=enabled):', powerSave)
if (votes.length) {
  console.log('Current display scheduler votes:')
  for (const line of votes) console.log('  ' + line.slice(0, 360))
}
if (!newsNookForeground) console.log('TIP: Open NewsNook and keep it in the foreground before sampling.')
if (!newsNookForeground) {
  console.log('RESULT: No NewsNook-specific conclusion: a different app is currently foreground.')
} else if (miuiMaxRate != null && renderRate != null && renderRate <= miuiMaxRate + 0.5 && miuiMaxRate < maximumRate - 0.5) {
  console.log('RESULT: The active HyperOS vote limits the render-rate range to ' + miuiMaxRate + ' Hz.')
} else if (maximumRate > 60.5 && renderRate !== null && renderRate <= 60.5) {
  console.log('RESULT: The system is currently scheduling at ~60 Hz despite a higher supported mode.')
} else if (renderRate > 60.5) {
  console.log('RESULT: The display is rendering above 60Hz. If scrolling is still ~60fps, inspect WebView rAF/compositor pacing.')
} else {
  console.log('RESULT: A high-rate display mode could not be confirmed from this sample.')
}
