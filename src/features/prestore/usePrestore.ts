import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'

import { log } from '../../lib/logger'
import type { Preferences } from '../../sources/preferences'
import { buildPrestorePlan } from './model'
import { syncPrestore, type PrestoreProgress } from './service'
import {
  clearPrestore,
  emptyPrestoreSnapshot,
  loadPrestoreManifest,
  loadPrestoreSnapshot,
  type PrestoreSnapshot,
} from './store'

const AUTO_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000
const AUTO_START_DELAY_MS = 3000
const PROGRESS_THROTTLE_MS = 120

interface UsePrestoreArgs {
  prefs: Preferences
  enabledIds: string[]
  presetId: string
  /** Feed refresh / reader foreground work wins over automatic prestore. */
  suspend?: boolean
}

export interface UsePrestoreResult {
  sourceCount: number
  snapshot: PrestoreSnapshot
  articleIds: ReadonlySet<string>
  syncing: boolean
  progress: PrestoreProgress | null
  error: string | null
  syncNow: () => void
  clear: () => Promise<void>
}

async function networkAvailable(): Promise<boolean> {
  try {
    return (await Network.getStatus()).connected
  } catch {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function usePrestore({
  prefs,
  enabledIds,
  presetId,
  suspend = false,
}: UsePrestoreArgs): UsePrestoreResult {
  const plan = useMemo(
    () => buildPrestorePlan(presetId, prefs, enabledIds),
    [enabledIds, prefs, presetId],
  )
  const [snapshot, setSnapshot] = useState<PrestoreSnapshot>(emptyPrestoreSnapshot)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<PrestoreProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [autoTriggerSequence, setAutoTriggerSequence] = useState(0)
  const [manualTriggerSequence, setManualTriggerSequence] = useState(0)
  const [foreground, setForeground] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  )
  const handledManualSequenceRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)
  const activeRunPromiseRef = useRef<Promise<void> | null>(null)
  const lastProgressAtRef = useRef(0)
  const lastProgressSourceRef = useRef('')

  useEffect(() => {
    let disposed = false
    void loadPrestoreSnapshot().then((next) => {
      if (!disposed) setSnapshot(next)
    })
    return () => {
      disposed = true
    }
  }, [])

  const requestAutoSync = useCallback(() => {
    setAutoTriggerSequence((sequence) => sequence + 1)
  }, [])

  const syncNow = useCallback(() => {
    setManualTriggerSequence((sequence) => sequence + 1)
  }, [])

  useEffect(() => {
    let disposed = false
    const removers: Array<() => Promise<void> | void> = []

    void Network.addListener('networkStatusChange', (status) => {
      if (!status.connected) {
        activeControllerRef.current?.abort()
        return
      }
      // 正在同步时不要因为一次网络切换重启整轮：当前进度还在跑，打断只会丢进度。
      if (activeControllerRef.current) return
      requestAutoSync()
    }).then((handle) => {
      if (disposed) void handle.remove()
      else removers.push(() => handle.remove())
    })

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        setForeground(isActive)
        if (!isActive) {
          activeControllerRef.current?.abort()
          return
        }
        // 回前台本身会通过 foreground 依赖重跑 effect；同步中就别再多推一次。
        if (activeControllerRef.current) return
        requestAutoSync()
      }).then((handle) => {
        if (disposed) void handle.remove()
        else removers.push(() => handle.remove())
      })
    } else if (typeof document !== 'undefined') {
      const onVisibility = () => {
        const visible = document.visibilityState === 'visible'
        setForeground(visible)
        if (!visible) {
          activeControllerRef.current?.abort()
          return
        }
        if (activeControllerRef.current) return
        requestAutoSync()
      }
      document.addEventListener('visibilitychange', onVisibility)
      removers.push(() => document.removeEventListener('visibilitychange', onVisibility))
    }

    return () => {
      disposed = true
      removers.forEach((remove) => void remove())
    }
  }, [requestAutoSync])

  useEffect(() => {
    activeControllerRef.current?.abort()
    activeControllerRef.current = null

    const manualPending = manualTriggerSequence > handledManualSequenceRef.current
    if (
      !prefs.prestore.enabled ||
      plan.sources.length === 0 ||
      !foreground ||
      (suspend && !manualPending)
    ) {
      setSyncing(false)
      setProgress(null)
      return
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const controller = new AbortController()
    activeControllerRef.current = controller

    const run = async () => {
      const manifest = await loadPrestoreManifest()
      if (controller.signal.aborted) return
      const planChanged =
        manifest?.planKey !== plan.key ||
        manifest?.perSourceLimit !== prefs.prestore.perSourceLimit ||
        manifest?.presetId !== presetId
      // 上一轮被中断时清单里留有断点游标，恢复前台/网络后立刻续传，
      // 不必等下一个 4 小时窗口。计划变了则本来就要整轮重来。
      const resumable = !planChanged && Boolean(manifest?.sync)
      const stale = !manifest || Date.now() - manifest.updatedAt >= AUTO_SYNC_INTERVAL_MS
      if (!manualPending && !planChanged && !stale && !resumable) return

      if (manualPending) handledManualSequenceRef.current = manualTriggerSequence
      const connected = await networkAvailable()
      if (controller.signal.aborted) return
      if (!connected) {
        if (!disposed && manualPending) setError('当前无网络，无法补齐预存')
        return
      }

      setSyncing(true)
      setProgress(null)
      setError(null)
      lastProgressAtRef.current = 0
      lastProgressSourceRef.current = ''

      try {
        await syncPrestore({
          plan,
          perSourceLimit: prefs.prestore.perSourceLimit,
          signal: controller.signal,
          extraSources: prefs.customSources,
          onProgress: (next) => {
            if (disposed || controller.signal.aborted) return
            const now = Date.now()
            const sourceChanged = next.sourceId !== lastProgressSourceRef.current
            const terminal = next.phase === 'source-complete'
            if (!sourceChanged && !terminal && now - lastProgressAtRef.current < PROGRESS_THROTTLE_MS) {
              return
            }
            lastProgressAtRef.current = now
            lastProgressSourceRef.current = next.sourceId
            setProgress(next)
          },
        })
        if (!disposed && !controller.signal.aborted) {
          setSnapshot(await loadPrestoreSnapshot())
        }
      } catch (syncError) {
        if (controller.signal.aborted || isAbortError(syncError)) return
        log.storage.warn('Prestore sync failed', syncError)
        if (!disposed) {
          setError(syncError instanceof Error ? syncError.message : '预存更新失败')
        }
      } finally {
        if (!disposed) setSyncing(false)
      }
    }

    const execute = () => {
      const promise = run()
      activeRunPromiseRef.current = promise
      void promise.finally(() => {
        if (activeRunPromiseRef.current === promise) activeRunPromiseRef.current = null
        if (activeControllerRef.current === controller) activeControllerRef.current = null
      })
    }

    if (manualPending) execute()
    else timer = setTimeout(execute, AUTO_START_DELAY_MS)

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      controller.abort()
      if (activeControllerRef.current === controller) activeControllerRef.current = null
    }
  }, [
    autoTriggerSequence,
    foreground,
    manualTriggerSequence,
    plan.key,
    plan.sources.length,
    prefs.customSources,
    prefs.prestore.enabled,
    prefs.prestore.perSourceLimit,
    presetId,
    suspend,
  ])

  const clear = useCallback(async () => {
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    const activeRun = activeRunPromiseRef.current
    if (activeRun) await activeRun.catch(() => undefined)
    setSyncing(false)
    setProgress(null)
    setError(null)
    await clearPrestore()
    setSnapshot(await loadPrestoreSnapshot())
  }, [])

  return {
    sourceCount: plan.sources.length,
    snapshot,
    articleIds: snapshot.articleIds,
    syncing,
    progress,
    error,
    syncNow,
    clear,
  }
}
