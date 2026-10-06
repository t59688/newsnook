import { readAppStyles } from './helpers/readAppStyles'
/**
 * 视频全屏必须走原生藏栏；HTML requestFullscreen 在边到边 WebView 里只会让状态栏变透明浮层。
 * 用法：npx tsx scripts/native-fullscreen.test.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { setNativeFullScreen } from '../src/lib/nativeChrome'

type BridgeCall = { method: string; args: unknown[] }

function installBridge(methods: Record<string, (...args: unknown[]) => void>) {
  const calls: BridgeCall[] = []
  const bridge: Record<string, unknown> = {}
  for (const [name, fn] of Object.entries(methods)) {
    bridge[name] = (...args: unknown[]) => {
      calls.push({ method: name, args })
      fn(...args)
    }
  }
  ;(globalThis as any).window = globalThis
  ;(globalThis as any).NewsNookNative = bridge
  return { calls, bridge }
}

function clearBridge() {
  delete (globalThis as any).NewsNookNative
}

{
  const { calls } = installBridge({ setFullScreen: () => {} })
  setNativeFullScreen(true)
  setNativeFullScreen(false)
  assert.deepEqual(
    calls.map((call) => [call.method, ...call.args]),
    [
      ['setFullScreen', true],
      ['setFullScreen', false],
    ],
  )
  clearBridge()
}

{
  clearBridge()
  assert.doesNotThrow(() => setNativeFullScreen(true))
  assert.doesNotThrow(() => setNativeFullScreen(false))
}

{
  const player = readFileSync(
    join(process.cwd(), 'src/components/InkVideoPlayer.tsx'),
    'utf8',
  )
  const enterStart = player.indexOf('const enterPlayerFullscreen')
  const toggleStart = player.indexOf('const toggleFullscreen', enterStart)
  assert.ok(enterStart >= 0 && toggleStart > enterStart)
  const enterFullscreen = player.slice(enterStart, toggleStart)
  const nativeGuard = enterFullscreen.indexOf('Capacitor.isNativePlatform()')
  const domRequest = enterFullscreen.indexOf('root.requestFullscreen()')
  assert.ok(nativeGuard >= 0, 'Android player fullscreen must branch on Capacitor native runtime')
  assert.ok(domRequest > nativeGuard, 'DOM Fullscreen API must only be reached after the native guard')
  assert.match(enterFullscreen, /setFallbackFullscreen\(true\)/)
  assert.equal(
    (player.match(/root\.requestFullscreen\(\)/g) ?? []).length,
    1,
    'all player fullscreen entry paths must share the native-aware helper',
  )
}

{
  const player = readFileSync(
    join(process.cwd(), 'src/components/InkVideoPlayer.tsx'),
    'utf8',
  )
  const mediaControls = readFileSync(
    join(process.cwd(), 'src/lib/deviceMediaControls.ts'),
    'utf8',
  )
  const enterStart = player.indexOf('const enterPlayerFullscreen')
  const toggleStart = player.indexOf('const toggleFullscreen', enterStart)
  const enterFullscreen = player.slice(enterStart, toggleStart)
  assert.match(
    enterFullscreen,
    /await setVideoFullscreen\(true\)[\s\S]*setFallbackFullscreen\(true\)/,
    'the Capacitor media plugin must enter native fullscreen before the fixed surface is shown',
  )
  assert.match(
    mediaControls,
    /DeviceMediaControls\.setVideoFullscreen\(\{ active \}\)/,
    'video fullscreen must use a real Capacitor plugin call',
  )

  const activity = readFileSync(
    join(process.cwd(), 'android/app/src/main/java/com/aizeek/newsnook/MainActivity.java'),
    'utf8',
  )
  assert.match(
    activity,
    /Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.R[\s\S]*controller\.hide\(android\.view\.WindowInsets\.Type\.systemBars\(\)\)/,
    'API 30+ must use the framework WindowInsetsController',
  )
  assert.match(activity, /View\.SYSTEM_UI_FLAG_IMMERSIVE_STICKY/)
  assert.match(activity, /FLAG_FULLSCREEN/)
  assert.match(activity, /void setVideoFullscreen\(boolean fullScreen\)/)

  const plugin = readFileSync(
    join(process.cwd(), 'android/app/src/main/java/com/aizeek/newsnook/DeviceMediaControlsPlugin.java'),
    'utf8',
  )
  assert.match(plugin, /public void setVideoFullscreen\(PluginCall call\)/)
  assert.match(plugin, /\(\(MainActivity\) activity\)\.setVideoFullscreen\(active\)/)

  const css = readAppStyles()
  assert.match(css, /\.ink-video-top-chrome\s*\{[^}]*padding:\s*0\.5rem 0\.625rem 2rem/s)
  assert.match(css, /\.ink-video-bottom-chrome\s*\{[^}]*padding:\s*3rem 1rem 0\.25rem/s)
  assert.doesNotMatch(player, /ink-video-top-chrome[^\n]*var\(--sal/)

  const capConfig = readFileSync(join(process.cwd(), 'capacitor.config.ts'), 'utf8')
  assert.match(capConfig, /SystemBars:[\s\S]*insetsHandling:\s*'disable'/)
}

console.log('native fullscreen chrome: ok')
