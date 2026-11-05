import assert from 'node:assert/strict'
import { CatalogWorkerClient } from '../src/features/rssCatalog/workerClient'
import type { CatalogWindow } from '../src/features/rssCatalog/searchEngine'

class FakeWorker {
  readonly sent: unknown[] = []
  listeners: Record<string, Array<(event: unknown) => void>> = {}
  addEventListener(type: string, cb: (event: unknown) => void) {
    ;(this.listeners[type] ??= []).push(cb)
  }
  postMessage(request: unknown) { this.sent.push(request) }
  emit(type: string, event: unknown) { for (const cb of this.listeners[type] ?? []) cb(event) }
}
const fake = new FakeWorker()
const client = new CatalogWorkerClient(fake as unknown as Worker)
const a = client.query({ query: '汽车', limit: 30 })
const b = client.query({ query: '汽车', limit: 60 })
assert.equal(fake.sent.length, 2)
const reqs = fake.sent as Array<{id: number; type: string}>
assert.equal(reqs[0].type, 'query')
assert.notEqual(reqs[0].id, reqs[1].id)
const page: CatalogWindow = { total: 38_957, feeds: [] }
fake.emit('message', { data: { type: 'result', id: reqs[1].id, result: { ...page, summary: {count:38_957,categories:[],languages:[]} } } })
assert.equal((await b).total, 38_957)
fake.emit('message', { data: { type: 'result', id: reqs[0].id, result: { ...page, total:2, summary: {count:38_957,categories:[],languages:[]} } } })
assert.equal((await a).total, 2)
let updates = 0
const stop = client.subscribe(() => updates++)
fake.emit('message', { data: { type: 'updated' } })
assert.equal(updates, 1)
stop()
fake.emit('message', { data: { type: 'updated' } })
assert.equal(updates, 1)
const pending = client.query({ query: 'offline' })
fake.emit('error', new Error('Worker load failure'))
await assert.rejects(pending, /Worker/)
await assert.rejects(client.query({}), /Worker/, 'invalid worker fails closed instead of hanging')
console.log('RSS catalog worker request correlation and failure recovery: ok')
