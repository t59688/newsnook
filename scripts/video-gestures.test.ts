import { readAppStyles } from './helpers/readAppStyles'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AXIS_LOCK_PX,
  LEVEL_FULL_SWING_RATIO,
  MAX_VIDEO_SCALE,
  SEEK_FULL_WIDTH_SEC,
  THUMB_ZONE_TOP_RATIO,
  clampLevel,
  clampVideoPan,
  clampVideoScale,
  clampSeekTarget,
  isThumbZone,
  levelOffset,
  normalizeVideoRotation,
  pinchScale,
  resolveGesture,
  seekOffsetSeconds,
  videoPointForRotation,
  videoSurfaceForRotation,
} from '../src/lib/videoGestures'

const surface = { width: 800, height: 400 }
const thumbTop = surface.height * THUMB_ZONE_TOP_RATIO

assert.equal(isThumbZone(thumbTop - 1, surface.height), false)
assert.equal(isThumbZone(thumbTop, surface.height), true)
assert.equal(isThumbZone(surface.height, surface.height), true)
assert.equal(isThumbZone(surface.height + 1, surface.height), false)
assert.equal(isThumbZone(10, 0), false)

assert.equal(resolveGesture(4, 4, 100, surface), 'none')
assert.equal(resolveGesture(AXIS_LOCK_PX + 5, 2, 100, surface), 'seek')
assert.equal(resolveGesture(-(AXIS_LOCK_PX + 5), 2, 700, surface), 'seek')
// 左下竖滑 = 亮度，右下竖滑 = 音量
assert.equal(resolveGesture(2, -(AXIS_LOCK_PX + 5), 100, surface), 'brightness')
assert.equal(resolveGesture(2, AXIS_LOCK_PX + 5, 700, surface), 'volume')
// 正中线归右侧，即音量
assert.equal(resolveGesture(2, -40, surface.width / 2, surface), 'volume')
// 明显的对角线保持未锁定
assert.equal(resolveGesture(30, 30, 100, surface), 'none')

assert.equal(seekOffsetSeconds(surface.width, surface.width, 600), SEEK_FULL_WIDTH_SEC)
assert.equal(seekOffsetSeconds(-surface.width / 2, surface.width, 600), -SEEK_FULL_WIDTH_SEC / 2)
// 短视频按自身时长封顶，整屏横滑不会一下划到远超片长的位置
assert.equal(seekOffsetSeconds(surface.width, surface.width, 40), 40)
assert.equal(seekOffsetSeconds(100, 0, 600), 0)
assert.equal(seekOffsetSeconds(100, surface.width, 0), 0)
assert.equal(seekOffsetSeconds(100, surface.width, Number.NaN), 0)

assert.equal(clampSeekTarget(10, 30, 600), 40)
assert.equal(clampSeekTarget(10, -30, 600), 0)
assert.equal(clampSeekTarget(590, 30, 600), 600)
assert.equal(clampSeekTarget(10, 30, 0), 0)

const fullSwing = surface.height * LEVEL_FULL_SWING_RATIO
assert.equal(levelOffset(-fullSwing, surface.height), 1)
assert.equal(levelOffset(fullSwing / 2, surface.height), -0.5)
assert.equal(levelOffset(-40, 0), 0)

assert.equal(clampLevel(1.4), 1)
assert.equal(clampLevel(-0.2), 0)
assert.equal(clampLevel(0.35), 0.35)
assert.equal(clampLevel(Number.NaN), 0)

assert.equal(clampVideoScale(0.5), 1)
assert.equal(clampVideoScale(2.5), 2.5)
assert.equal(clampVideoScale(8), MAX_VIDEO_SCALE)
assert.equal(pinchScale(1, 100, 250), 2.5)
assert.equal(pinchScale(2, 0, 300), 2)
assert.equal(normalizeVideoRotation(90), 90)
assert.equal(normalizeVideoRotation(450), 90)
assert.equal(normalizeVideoRotation(-90), 270)

const portraitSurface = { width: 400, height: 800 }
const landscapeVideo = { width: 1920, height: 1080 }
const rotatedSurface = videoSurfaceForRotation(portraitSurface, 90)
assert.deepEqual(rotatedSurface, { width: 800, height: 400 })
assert.deepEqual(videoPointForRotation(100, 300, portraitSurface, 90), { x: 300, y: 300 })
assert.deepEqual(videoPointForRotation(100, 300, portraitSurface, 180), { x: 300, y: 500 })
assert.deepEqual(videoPointForRotation(100, 300, portraitSurface, 270), { x: 500, y: 100 })
assert.deepEqual(
  clampVideoPan(500, -500, rotatedSurface, landscapeVideo, 1),
  { x: 0, y: 0 },
  '适应模式不允许把画面拖出黑边',
)
const zoomedPan = clampVideoPan(500, -500, rotatedSurface, landscapeVideo, 2)
assert.ok(Math.abs(zoomedPan.x - 311.111) < 0.01)
assert.equal(zoomedPan.y, -200)

{
  const css = readAppStyles()
  assert.match(
    css,
    /\.ink-video-abs-center\s*\{[^}]*transform:\s*translate\(-50%,\s*-50%\)/,
    '播放键居中必须用经典 transform；Android 12 WebView (Chrome 91) 没有 CSS translate 属性',
  )
  const player = readFileSync(
    join(process.cwd(), 'src/components/InkVideoPlayer.tsx'),
    'utf8',
  )
  const playButton = player.slice(player.indexOf('aria-label="播放"'))
  assert.match(playButton.slice(0, 900), /ink-video-abs-center/)
  assert.doesNotMatch(
    playButton.slice(0, 900),
    /-translate-x-1\/2/,
    '播放键不得依赖 Tailwind v4 的 -translate-*（会编译成 translate 属性）',
  )

  assert.match(
    css,
    /\.ink-video-y-center\s*\{[^}]*transform:\s*translateY\(-50%\)/,
    '进度轨居中必须用经典 transform，兼容 Chrome 69+ WebView',
  )
  assert.match(
    css,
    /\.ink-seek\s*\{[^}]*-webkit-appearance:\s*none/,
    '旧 Android WebView 的 range 必须显式关闭 WebKit 原生外观',
  )

  const seekStart = player.indexOf('{/* Seek Bar Row */}')
  const controlsStart = player.indexOf('{/* Controls Row */}', seekStart)
  assert.ok(seekStart >= 0 && controlsStart > seekStart)
  const seekBar = player.slice(seekStart, controlsStart)
  assert.doesNotMatch(
    seekBar,
    /-translate-y-1\/2/,
    '进度条不得依赖 Tailwind v4 的独立 translate 属性',
  )
  assert.doesNotMatch(
    seekBar,
    /Thumb dot|style=\{\{ left:/,
    '进度圆点只能由 range thumb 绘制，不能再叠一层 DOM 圆点',
  )
  assert.equal((seekBar.match(/type="range"/g) ?? []).length, 1)
}

console.log('video-gestures: ok')
