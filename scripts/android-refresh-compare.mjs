#!/usr/bin/env node
/**
 * On-device Debug vs Release refresh-policy differential.
 * Both packages must be installed. ADB launches each app and makes two
 * ordinary swipes, but never changes settings or application data.
 *
 * node scripts/android-refresh-compare.mjs [--serial DEVICE]
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readDisplayMetrics } from './android-refresh-metrics.mjs'

const sdkDirs = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
  ...(process.platform === 'win32' ? ['D:\\Android\\sdk', 'C:\\Android\\sdk'] : []),
].filter(Boolean)
const adb = sdkDirs.map(d => join(d, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'))
  .find(existsSync) || 'adb'
const run = args => {
  const result = spawnSync(adb, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 15e6, windowsHide: true })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || (result.stderr || result.stdout).trim())
  return result.stdout.replace(/\r/g, '')
}
const args = process.argv.slice(2)
const serialIndex = args.indexOf('--serial')
if (serialIndex >= 0 && !args[serialIndex + 1]) throw Error('--serial requires a device')
const devices = run(['devices']).split('\n').slice(1).filter(s => /\sdevice\b/.test(s)).map(s => s.trim().split(/\s+/)[0])
const physical = devices.filter(s => !s.startsWith('emulator-'))
const serial = serialIndex >= 0 ? args[serialIndex + 1] : (physical.length === 1 ? physical[0] : devices.length === 1 ? devices[0] : null)
if (!serial || !devices.includes(serial)) throw Error('Connect one authorized Android phone, or specify --serial')
const adbArgs = sub => ['-s', serial, ...sub]
const shell = (...commands) => run(adbArgs(['shell', ...commands])).trim()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const packages = ['com.aizeek.newsnook.debug', 'com.aizeek.newsnook']
const activityName = 'com.aizeek.newsnook.MainActivity'
const packageInfo = pkg => {
  const data = shell('dumpsys', 'package', pkg)
  return {
    version: data.match(/\bversionName=([^\s]+)/)?.[1] || '?',
    code: data.match(/\bversionCode=(\d+)/)?.[1] || '?',
    targetSdk: data.match(/\btargetSdk=(\d+)/)?.[1] || '?',
    debug: /\b(?:pkgFlags|flags)=\[[^\]]*\bDEBUGGABLE\b/.test(data),
  }
}
const sampleDisplay = sample => ({ sample, ...readDisplayMetrics(shell('dumpsys', 'display')) })
const wmSize = shell('wm','size')
const dims = wmSize.match(/Override size:\s*(\d+)x(\d+)/i)
  ?? wmSize.match(/Physical size:\s*(\d+)x(\d+)/i)
if (!dims) throw Error('Could not determine display size: ' + wmSize)
const [w,h] = dims.slice(1).map(Number)
const coords = [Math.round(w * .55), Math.round(h * .78), Math.round(h * .36)]
const swipe = () => new Promise((resolve,reject) => {
  const proc = spawn(adb, adbArgs(['shell', 'input', 'swipe',
    String(coords[0]), String(coords[1]), String(coords[0]), String(coords[2]), '650']),
    { stdio:'ignore', windowsHide:true })
  proc.once('error',reject)
  proc.once('exit', code => code === 0 ? resolve() : reject(Error('ADB swipe failed')))
})

console.log('NewsNook Debug vs Release refresh comparison')
console.log('Android',shell('getprop','ro.build.version.release'),
  'Manufacturer',shell('getprop','ro.product.manufacturer'),
  'Brand',shell('getprop','ro.product.brand'))
console.log('System peak_refresh_rate',shell('settings','get','system','peak_refresh_rate'))
console.log('HyperOS miui_refresh_rate',shell('settings','get','secure','miui_refresh_rate'))
console.log('Power saver',shell('settings','get','global','low_power'))
for (const pkg of packages) {
  if (!shell('pm','path',pkg).startsWith('package:')) {
    console.log('\n'+pkg, 'NOT INSTALLED (skipping)')
    continue
  }
  console.log('\n'+pkg, JSON.stringify(packageInfo(pkg)))
  shell('am','start','-W','-n',pkg+'/'+activityName)
  await sleep(1700)
  const activities = shell('dumpsys', 'activity', 'activities')
  const foreground = activities.match(/^\s*(?:topResumedActivity|mResumedActivity)[:=]\s*[^\n]*?\s([\w.]+)\//m)?.[1]
  if (foreground !== pkg) throw Error('Could not verify foreground package: ' + pkg)
  const samples = [sampleDisplay('before swipe')]
  for (let i=0;i<2;i++) {
    const swiping = swipe()
    await sleep(130)
    samples.push(sampleDisplay('during swipe '+(i+1)))
    await swiping
    await sleep(350)
  }
  for (const s of samples) {
    console.log(' ',s.sample, 'renderFrameRate=',s.renderRate ?? 'not exposed',
      'Hz, displayMode=',s.physicalRate ?? 'not exposed', 'Hz, MIUI max=',s.miuiMaxRate ?? 'not exposed', 'Hz')
    for (const vote of s.votes) console.log('   ',vote)
  }
}
console.log('\nInterpretation: Compare the two during-swipe renderFrameRate readings and MIUI votes.')
console.log('If Release has PRIORITY_MIUI_REFRESH_RATE max=60 while Debug has max=120,')
console.log('the system is capping that package independently of the app rendering code.')
console.log('If both display rates are 120Hz but Release content still runs at 60fps,')
console.log('capture WebView / SurfaceFlinger composition pacing for each package.')
console.log('A 60Hz-only emulator cannot establish a diagnosis for a 120Hz phone.')
