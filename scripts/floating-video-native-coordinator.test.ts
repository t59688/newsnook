import assert from 'node:assert/strict'
import { createLiveSuppressionCoordinator } from '../src/features/floatingVideo/nativeSurfaceCoordinator'

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
console.log('floating-video-native-coordinator: ok')
