import assert from 'node:assert/strict'

import { mapConcurrent } from '../src/lib/asyncPool'

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

console.log('Testing mapConcurrent peak concurrency...')

{
  let inFlight = 0
  let peak = 0
  const items = Array.from({ length: 12 }, (_, i) => i)

  await mapConcurrent(items, 3, async (item) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await sleep(20)
    inFlight -= 1
    return item * 2
  })

  assert.equal(peak, 3, `peak concurrency should be 3, got ${peak}`)
}

{
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    () =>
      mapConcurrent([1, 2, 3], 2, async (n) => n, controller.signal),
    (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
  )
}

{
  const results = await mapConcurrent([1, 2, 3], 2, async (n, index) => n + index)
  assert.deepEqual(results, [1, 3, 5])
}

{
  // abort 后应等 in-flight 收尾再 reject，且不再派发新任务
  let inFlight = 0
  let started = 0
  let finished = 0
  const controller = new AbortController()
  const items = Array.from({ length: 20 }, (_, i) => i)

  const run = mapConcurrent(
    items,
    4,
    async () => {
      started += 1
      inFlight += 1
      await sleep(40)
      inFlight -= 1
      finished += 1
    },
    controller.signal,
  )

  await sleep(25)
  controller.abort()

  await assert.rejects(
    () => run,
    (err: unknown) => err instanceof DOMException && err.name === 'AbortError',
  )

  assert.equal(inFlight, 0, 'in-flight should be 0 when mapConcurrent settles after abort')
  assert.equal(started, finished, 'every started task should finish before settle')
  assert.ok(started < items.length, `should stop dispatching new work, started=${started}`)
  assert.ok(started >= 1, 'at least one task should have started before abort')

  const startedAtSettle = started
  await sleep(80)
  assert.equal(started, startedAtSettle, 'no new tasks after settle')
  assert.equal(finished, startedAtSettle, 'no late finishes after settle')
}

console.log('async-pool tests passed')
