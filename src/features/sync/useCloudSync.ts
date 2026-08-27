/**
 * 把同步引擎接到 React 运行时。
 *
 * 触发策略（无轮询、无 WebSocket）：
 *   登录成功 / 已登录冷启动 · 本地改动 debounce · 回到前台 · 网络恢复 · 手动
 *
 * 未登录时这个 hook 什么都不做：不创建引擎、不发请求、不影响任何本地阅读路径。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { SyncConflict } from '@newsnook/contracts'

import { log } from '../../lib/logger'
import type { Preferences } from '../../sources/preferences'
import type { PresetsState } from '../../sources/presets'
import type { AccountAdapter } from '../account/types'
import type { LocalRuntimeState } from './merge'
import { notifySyncEvent } from './nativeNotification'
import { projectLocalState } from './projection'
import { createRuntimeSyncAdapter } from './runtimeAdapter'
import { readSyncState } from './state'
import { SyncEngine, type SyncEvent, type SyncReason, type SyncStatus } from './SyncEngine'
import { createHttpSyncTransport } from './transport'

/** 本地改动合并窗口：连续调整设置时只在停手后推一次 */
const LOCAL_CHANGE_DEBOUNCE_MS = 1500
/** 刚应用完远端记录的静默窗口，避免应用动作自己再触发一轮同步 */
const APPLY_QUIET_MS = 400

export interface CloudSyncArgs {
  /** 未登录时传 null；引擎随之销毁 */
  account: AccountAdapter | null
  authenticated: boolean
  runtime: LocalRuntimeState
  replacePreferences: (next: Preferences) => void
  replaceEnabledIds: (ids: string[]) => void
  replacePresets: (next: PresetsState) => void
  onEvent?: (event: SyncEvent) => void
}

export interface CloudSyncApi {
  status: SyncStatus
  conflicts: SyncConflict[]
  engine: SyncEngine | null
  syncNow: () => Promise<void>
  refreshConflicts: () => Promise<void>
  resolveConflict: (id: string, resolution: 'accept_local' | 'accept_server') => Promise<void>
}

const IDLE_STATUS: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  conflictCount: 0,
  nextRetryAt: null,
  firstSyncCompleted: false,
}

function devicePlatform(): 'android' | 'web' {
  return Capacitor.getPlatform() === 'android' ? 'android' : 'web'
}

function appVisibility(): 'foreground' | 'background' {
  if (typeof document === 'undefined') return 'background'
  return document.visibilityState === 'visible' ? 'foreground' : 'background'
}

function deviceName(): string {
  if (typeof navigator === 'undefined') return 'NewsNook'
  const ua = navigator.userAgent
  const model = /Android[^;]*;\s*([^)]+)\)/.exec(ua)?.[1]?.split(' Build')[0]
  return (model ?? (devicePlatform() === 'android' ? 'Android' : 'Web')).slice(0, 60)
}

export function useCloudSync(args: CloudSyncArgs): CloudSyncApi {
  const {
    account,
    authenticated,
    runtime,
    replacePreferences,
    replaceEnabledIds,
    replacePresets,
    onEvent,
  } = args

  const [status, setStatus] = useState<SyncStatus>(IDLE_STATUS)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])

  // 引擎在后台异步跑，必须读到「此刻」的运行时，而不是创建时闭包里的快照
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime

  const applyingUntil = useRef(0)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  const writeRuntime = useCallback(
    (next: LocalRuntimeState) => {
      applyingUntil.current = Date.now() + APPLY_QUIET_MS
      replacePreferences(next.prefs)
      replaceEnabledIds(next.enabledIds)
      replacePresets(next.presets)
    },
    [replaceEnabledIds, replacePreferences, replacePresets],
  )

  const engine = useMemo(() => {
    if (!account || !authenticated) return null

    const adapter = createRuntimeSyncAdapter({
      read: () => runtimeRef.current,
      write: writeRuntime,
    })

    const transport = createHttpSyncTransport({
      fetchCloud: account.fetchCloud,
      identity: () => ({
        deviceId: readSyncState().deviceId,
        deviceName: deviceName(),
        platform: devicePlatform(),
        appVersion: __APP_VERSION__,
      }),
    })

    return new SyncEngine({
      adapter,
      transport,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      onEvent: (event) => {
        if (event.type === 'status') setStatus(event.status)
        if (event.type === 'conflicts') setConflicts(event.conflicts)
        onEventRef.current?.(event)
        // 前台一律走应用内 Toast；只有应用不在前台时才考虑通知栏
        void notifySyncEvent(event, appVisibility())
      },
    })
  }, [account, authenticated, writeRuntime])

  useEffect(() => {
    if (!engine) {
      setStatus(IDLE_STATUS)
      setConflicts([])
      return
    }
    setStatus(engine.getStatus())
    void engine.sync('startup')
  }, [engine])

  // 本地改动：投影指纹变了才算数，避免阅读态变化（已读、缓存）也去打服务端
  const projectionKey = useMemo(() => {
    if (!engine) return ''
    const projection = projectLocalState(runtime)
    return Object.keys(projection)
      .sort()
      .map((key) => `${key}=${projection[key]!.fingerprint}`)
      .join('|')
  }, [engine, runtime])

  const lastProjectionKey = useRef<string | null>(null)

  useEffect(() => {
    if (!engine || !projectionKey) return
    if (lastProjectionKey.current === null) {
      lastProjectionKey.current = projectionKey
      return
    }
    if (lastProjectionKey.current === projectionKey) return
    lastProjectionKey.current = projectionKey

    // 刚刚才把远端结果写回运行时：这次变化不是用户改的，不必回推
    if (Date.now() < applyingUntil.current) return

    const timer = window.setTimeout(() => {
      void engine.sync('local-change')
    }, LOCAL_CHANGE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [engine, projectionKey])

  // 回到前台
  useEffect(() => {
    if (!engine) return

    const onForeground = () => {
      void engine.sync('foreground')
    }

    if (Capacitor.isNativePlatform()) {
      let handle: { remove: () => Promise<void> } | undefined
      let disposed = false
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onForeground()
      }).then((registered) => {
        if (disposed) void registered.remove()
        else handle = registered
      })
      return () => {
        disposed = true
        void handle?.remove()
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') onForeground()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [engine])

  // 网络恢复
  useEffect(() => {
    if (!engine) return
    const onOnline = () => {
      log.sync.debug('network back online, syncing')
      void engine.sync('network')
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [engine])

  const syncNow = useCallback(async () => {
    if (!engine) return
    await engine.sync('manual' satisfies SyncReason)
  }, [engine])

  const refreshConflicts = useCallback(async () => {
    if (!engine) return
    await engine.refreshConflicts()
  }, [engine])

  const resolveConflict = useCallback(
    async (id: string, resolution: 'accept_local' | 'accept_server') => {
      if (!engine) return
      await engine.resolveConflict(id, resolution)
    },
    [engine],
  )

  return { status, conflicts, engine, syncNow, refreshConflicts, resolveConflict }
}
