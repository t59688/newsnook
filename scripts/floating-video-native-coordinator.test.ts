import assert from 'node:assert/strict'
import { createLiveSuppressionCoordinator, createFloatingVideoOcclusionCoordinator, type FloatingVideoBounds } from '../src/features/floatingVideo/nativeSurfaceCoordinator'

const calls: boolean[] = []
const resolvers: Array<() => void> = []
const coordinator = createLiveSuppressionCoordinator(async (value) => {
  calls.push(value)
  await new Promise<void>(resolve => resolvers.push(resolve))
})
coordinator.set(true)
coordinator.set(false)
coordinator.set(true)
assert.deepEqual(calls, [true], 'must serialize native bridge calls')
resolvers.shift()?.()
await Promise.resolve()
await Promise.resolve()
coordinator.set(false)
for (let i = 0; i < 8 && resolvers.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(calls, [true, false], 'last desired state must win')
resolvers.shift()?.()
await coordinator.idle()
assert.deepEqual(calls, [true, false])
const cutouts: Array<FloatingVideoBounds | null> = []
const cutoutResolves: Array<() => void> = []
const overlay = createFloatingVideoOcclusionCoordinator(async rect => {
  cutouts.push(rect)
  await new Promise<void>(resolve => cutoutResolves.push(resolve))
})
const first = {left: 210, top: 330, width: 240, height: 135}
const duringDrag = {left: 180, top: 270, width: 240, height: 135}
const final = {left: 130, top: 220, width: 300, height: 169}
overlay.set(first)
overlay.set(duringDrag)
overlay.set(final)
assert.deepEqual(cutouts, [first], 'rapid drag updates cannot flood the native UI bridge')
cutoutResolves.shift()?.()
for (let i = 0; i < 10 && cutoutResolves.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(cutouts, [first, final], 'only the newest size/position is applied')
cutoutResolves.shift()?.()
await overlay.idle()
overlay.set({...final})
await overlay.idle()
assert.equal(cutouts.length, 2, 'identical geometry never relayouts the native browser')
overlay.set(null)
cutoutResolves.shift()?.()
await overlay.idle()
assert.equal(cutouts.at(-1), null, 'closing/restoring the float reveals the entire webpage')
console.log('floating-video-native-coordinator: occlusion follows drag, coalesces frames and clears on restore')
