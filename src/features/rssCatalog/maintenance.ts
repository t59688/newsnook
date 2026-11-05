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
    const load = options.load ?? (async () => (await import('./runtime')).rssCatalogService)
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
