import { removeKeys } from '../../lib/storage'
import { log } from '../../lib/logger'

let cleanup: Promise<void> | null = null

/** Remove the retired full catalog cache; never open or create its database. */
export function clearLegacyDiscoveryCache(): Promise<void> {
  if (cleanup) return cleanup
  removeKeys(['feed-discovery-config'])
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  cleanup = new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('newsnook:feed-discovery')
    request.onsuccess = () => resolve()
    request.onerror = () => { log.storage.warn('Legacy discovery cache cleanup failed'); cleanup = null; resolve() }
    request.onblocked = () => { log.storage.warn('Legacy discovery cache cleanup blocked by another open page'); cleanup = null; resolve() }
  })
  return cleanup
}
