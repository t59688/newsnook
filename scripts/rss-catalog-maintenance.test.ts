import assert from 'node:assert/strict'
import { startCatalogMaintenance } from '../src/features/rssCatalog/maintenance'
let idle: (() => void) | undefined
let tick: (() => void) | undefined
let disposed = 0
let loads = 0
let refreshes = 0
const stop = startCatalogMaintenance({
  schedule: (work) => { idle = work; return () => { disposed++ } },
  everyHour: (work) => { tick = work; return () => { disposed++ } },
  load: async () => { loads++; return { refresh: async () => { refreshes++ } } },
})
assert.equal(loads, 0, 'does not eagerly load the catalog')
idle!()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(refreshes, 1)
tick!()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(refreshes, 2)
stop()
tick!()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(refreshes, 2, 'disposed maintenance never requests the catalog')
assert.equal(disposed, 2)
console.log('rss catalog idle maintenance: ok')
