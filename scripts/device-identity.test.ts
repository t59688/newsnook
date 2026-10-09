import assert from 'node:assert/strict'

import {
  assignDeviceId,
  deviceDisplayName,
  devicePlatform,
  resolveDeviceId,
} from '../src/features/sync/deviceIdentity'
import { createInitialSyncState, readSyncState, writeSyncState } from '../src/features/sync/state'
import { loadPersistedDeviceId, savePersistedDeviceId } from '../src/lib/storage'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory })

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; 2210132C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
})

memory.clear()
const first = resolveDeviceId()
assert.match(first, /^[0-9a-f-]{36}$/)
assert.equal(loadPersistedDeviceId(), first)

memory.clear()
savePersistedDeviceId('11111111-2222-4333-8444-555555555555')
assert.equal(resolveDeviceId(), '11111111-2222-4333-8444-555555555555')

writeSyncState(
  createInitialSyncState('22222222-3333-4444-8555-666666666666'),
)
assert.equal(readSyncState().deviceId, '22222222-3333-4444-8555-666666666666')
assert.equal(loadPersistedDeviceId(), '22222222-3333-4444-8555-666666666666')

removeSyncStateOnly()
assert.equal(
  resolveDeviceId(),
  '22222222-3333-4444-8555-666666666666',
  'sync-state 丢失后仍应复用独立持久化的 deviceId',
)

assert.equal(deviceDisplayName(), '2210132C')
assert.equal(devicePlatform(), 'android')

function removeSyncStateOnly(): void {
  memory.removeItem('newsnook:sync-state:v1')
}

assignDeviceId('33333333-4444-4555-8666-777777777777')
assert.equal(loadPersistedDeviceId(), '33333333-4444-4555-8666-777777777777')

console.log('device-identity: ok')
