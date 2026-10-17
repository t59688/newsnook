import assert from 'node:assert/strict'

import { createLogger, logController } from '../src/lib/logger.ts'

function withMockConsole(run: () => void): string[] {
  const lines: string[] = []
  const capture =
    (tag: string) =>
    (...args: unknown[]) => {
      lines.push(`${tag}:${args.map(String).join(' ')}`)
    }
  const original = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    debug: console.debug,
    log: console.log,
  }
  console.error = capture('error')
  console.warn = capture('warn')
  console.info = capture('info')
  console.debug = capture('debug')
  console.log = capture('log')
  try {
    run()
  } finally {
    console.error = original.error
    console.warn = original.warn
    console.info = original.info
    console.debug = original.debug
    console.log = original.log
  }
  return lines
}

logController.reset()
logController.setLevel('debug')

const http = createLogger('http')

withMockConsole(() => {
  http.debug('request', { url: 'https://example.com' })
  http.warn('slow')
  logController.disable('http')
  http.debug('hidden')
  logController.enable('http')
  http.debug('visible again')
})

logController.setLevel('warn')
withMockConsole(() => {
  http.debug('dropped by level')
  http.warn('kept')
})

logController.setLevel('silent')
withMockConsole(() => {
  http.error('also silent')
  http.warn('also silent')
})

logController.reset()
logController.setConfig({
  level: 'trace',
  namespaces: { sniffer: false, boot: true },
})

const sniffer = createLogger('sniffer')
const boot = createLogger('boot')

withMockConsole(() => {
  sniffer.info('blocked')
  boot.info('allowed')
})

const cfg = logController.getConfig()
assert.equal(cfg.level, 'trace')
assert.equal(cfg.namespaces.sniffer, false)
assert.equal(cfg.namespaces.boot, true)

// 云同步的两个命名空间可以单独关掉：出问题时只留同步日志，不被 HTTP 刷屏
logController.reset()
logController.setConfig({ level: 'debug', namespaces: { account: false } })

const account = createLogger('account')
const sync = createLogger('sync')

const cloudLines = withMockConsole(() => {
  account.info('blocked')
  sync.info('allowed')
  sync.warn('sync cycle failed', { code: 'RATE_LIMITED' })
})

assert.equal(
  cloudLines.some((line) => line.includes('blocked')),
  false,
  'account 命名空间可单独关闭',
)
assert.ok(cloudLines.some((line) => line.includes('[sync] allowed')))
assert.ok(cloudLines.some((line) => line.includes('sync cycle failed')))

logController.reset()

// Private shell must not persist debug settings or emit URLs, even if logging is enabled.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let privateStorageAccesses = 0
Object.defineProperty(globalThis, 'window', {configurable: true, value: {location: {hash: '#private-browser', search: '?log=trace'}}})
Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {
  getItem: () => {privateStorageAccesses++; return null},
  setItem: () => {privateStorageAccesses++},
  removeItem: () => {privateStorageAccesses++},
}})
try {
  const privateLines = withMockConsole(() => {
    logController.setLevel('trace')
    http.error('private URL https://private.example/secret')
    logController.reset()
    http.warn('private navigation failed')
  })
  assert.deepEqual(privateLines, [], 'private diagnostics cannot emit page URLs')
  assert.equal(privateStorageAccesses, 0, 'private logger never reads or writes persistent settings')
} finally {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  logController.reset()
}

console.log('logger: ok')
