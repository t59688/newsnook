import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { NewsSource } from '../../sources/registry'
import type { CatalogSnapshot } from './session'
import { CatalogSession } from './session'

export function useCatalogSession(source?: NewsSource) {
  const session = useMemo(() => source ? new CatalogSession(source) : undefined, [source])
  const state = useSyncExternalStore(session?.subscribe ?? (() => () => {}), () => session?.snapshot ?? EMPTY)
  useEffect(() => () => session?.cancel(), [session])
  return { session, state }
}
const EMPTY: CatalogSnapshot = { loading: false, exhausted: true, index: -1, history: [] }
