import assert from 'node:assert/strict'
import { constrainWindow, initialWindow } from '../src/features/floatingVideo/geometry'

const bounds = { x: 8, y: 32, width: 374, height: 740 }
const rect = initialWindow(bounds, 16 / 9)
assert.equal(rect.width, 224.4)
assert.ok(rect.x >= bounds.x && rect.y >= bounds.y)
const huge = constrainWindow({ x: -100, y: 900, width: 2000 }, bounds, 16 / 9)
assert.equal(huge.width, 374)
assert.equal(huge.x, 8)
assert.ok(huge.y + huge.height <= bounds.y + bounds.height)
const tiny = constrainWindow({ x: 0, y: 0, width: 200 }, { x: 8, y: 8, width: 90, height: 80 }, 9 / 16)
assert.ok(tiny.width <= 90 && tiny.height <= 80)
assert.ok(tiny.width > 0 && tiny.height > 44)
const portrait = constrainWindow({ x: 8, y: 32, width: 300 }, bounds, 9 / 16)
assert.ok(Math.abs((portrait.height - 44) / portrait.width - 16 / 9) < 0.001)
console.log('floating-video-geometry: ok')
