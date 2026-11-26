import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
const files = readdirSync('dist/assets')
const worker = files.find((f) => /^catalog\.worker-.*\.js$/.test(f))
const json = files.find((f) => /^seed-.*\.json$/.test(f))
assert.ok(worker, 'classic worker bundle must be present')
assert.ok(statSync('dist/assets/' + worker).size < 400_000,
  'classic worker must not embed all 38,957 feeds as executable JS')
assert.ok(json, 'offline bundled seed must remain a local JSON asset, not JS code')
const packed = readFileSync('dist/assets/' + json)
const source = readFileSync('src/features/rssCatalog/seed.json')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(packed), sha(source), 'offline seed must match the complete versioned catalog byte-for-byte')
assert.equal(files.some((f) => /^seed-.*\.js$/.test(f)), false,
  'the full catalog must not also be emitted as a second JavaScript chunk')
const workerScript = readFileSync('dist/assets/' + worker, 'utf8')
assert.ok(workerScript.startsWith('(function()'), 'WebView 69 must receive a classic IIFE Worker')
assert.equal(workerScript.includes('import.meta'), false, 'classic Worker cannot use import.meta')
assert.equal(workerScript.includes('?.'), false, 'Worker must remain compatible with Android WebView 69')
console.log('RSS catalog worker build size and single offline JSON asset: ok')
