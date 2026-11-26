import { scheduleIdleWork } from '../../lib/idleWork'
import { log } from '../../lib/logger'

interface MaintenanceOptions {
  schedule?: (work: () => void) => () => void
  everyHour?: (work: () => void) => () => void
  load?: () => Promise<{ refresh(): Promise<void> }>
}
/** Called only after the initial usable surface; no eager seed/IndexedDB import. */
export function startCatalogMaintenance(options: MaintenanceOptions = {}): () => void {
  let active = true
  const update = () => {
    if (!active) return
    // Updating the 38k-entry catalog must never deserialize, hash or index on
    // the application's main thread, including during idle startup work.
    const load = options.load ?? (async () => (await import('./workerClient')).getCatalogWorkerClient())
    void load().then((service) => active ? service.refresh() : undefined)
      .catch(() => { if (active) log.feed.debug('RSS catalog update deferred; local catalog retained') })
  }
  const cancelIdle = (options.schedule ?? scheduleIdleWork)(update)
  const cancelTimer = (options.everyHour ?? ((work) => {
    const id = globalThis.setInterval(work, 3_600_000)
    return () => globalThis.clearInterval(id)
  }))(update)
  return () => { active = false; cancelIdle(); cancelTimer() }
}
