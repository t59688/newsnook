import assert from 'node:assert/strict'
import { scheduleAfterPaint } from '../src/lib/idleWork'

const windowEvents = new Map<string, Set<() => void>>()
const documentEvents = new Map<string, Set<() => void>>()
let nextId = 0
const frames = new Map<number, () => void>()
const timers = new Map<number, () => void>()
let visibility: 'visible' | 'hidden' = 'visible'
function events(target: Map<string, Set<() => void>>) {
  return {
    addEventListener(type: string, fn: () => void) { (target.get(type) ?? target.set(type, new Set()).get(type)!).add(fn) },
    removeEventListener(type: string, fn: () => void) { target.get(type)?.delete(fn) },
  }
}
Object.assign(globalThis, {
  window: {
    ...events(windowEvents),
    requestAnimationFrame(fn: () => void) { const id = ++nextId; frames.set(id, fn); return id },
    cancelAnimationFrame(id: number) { frames.delete(id) },
    setTimeout(fn: () => void) { const id = ++nextId; timers.set(id, fn); return id },
    clearTimeout(id: number) { timers.delete(id) },
  },
  document: { ...events(documentEvents), get visibilityState() { return visibility } },
})
function flushFrames() { const work = [...frames.values()]; frames.clear(); work.forEach(fn => fn()) }
function flushTimers() { const work = [...timers.values()]; timers.clear(); work.forEach(fn => fn()) }
function dispatch(target: Map<string, Set<() => void>>, type: string) { [...target.get(type) ?? []].forEach(fn => fn()) }

const order: number[] = []
scheduleAfterPaint(() => order.push(1))
assert.deepEqual(order, [], 'no synchronous parsing/writes on the tap path')
flushFrames()
assert.deepEqual(order, [], 'work still awaits the completed frame')
flushTimers()
assert.deepEqual(order, [1], 'persist after the first frame')

scheduleAfterPaint(() => order.push(2))
visibility = 'hidden'
dispatch(documentEvents, 'visibilitychange')
assert.deepEqual(order, [1, 2], 'Android background flushes pending history without waiting for a frame')
flushFrames(); flushTimers()
assert.deepEqual(order, [1, 2], 'background flush runs exactly once')
visibility = 'visible'
scheduleAfterPaint(() => order.push(3))
dispatch(windowEvents, 'pagehide')
assert.deepEqual(order, [1, 2, 3], 'pagehide persists pending opens')
const cancel = scheduleAfterPaint(() => order.push(4))
cancel(); flushFrames(); flushTimers()
assert.deepEqual(order, [1, 2, 3], 'cancelled work does not run')
assert.equal(windowEvents.get('pagehide')?.size, 0, 'listeners are cleaned up')
assert.equal(documentEvents.get('visibilitychange')?.size, 0, 'visibility listeners are cleaned up')
console.log('after-paint-work: first paint, background/pagehide durability, exactly-once and cancellation OK')
