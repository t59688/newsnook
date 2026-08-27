/**
 * 引擎与 NewsNook 运行时之间的适配层。
 *
 * 运行时真相仍然是 React 里的 `Preferences` / `enabled` / `presets`，
 * 这里只负责「读出来投影」「把远端结果写回去」，不新建第二套配置存储。
 * 写回时刻意保留设备本地设置：墨水屏、Wi-Fi 媒体、预存跟着硬件走，
 * 换一台设备同步下来的值不该把它们改掉。
 */

import type { SyncRecord } from '@newsnook/contracts'

import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '../../sources/preferences'
import { buildFreshInstallPresetsState } from '../../sources/presets'
import { applyRemoteRecords, type LocalRuntimeState } from './merge'
import { DEVICE_LOCAL_SETTING_FIELDS, projectLocalState } from './projection'
import {
  clearApplyJournal,
  readApplyJournal,
  readSyncState,
  writeApplyJournal,
  writeSyncState,
} from './state'
import type { SyncRuntimeAdapter } from './SyncEngine'

export interface RuntimeBridge {
  /** 当前运行时快照；必须是最新值，不能是渲染时闭包里的旧值 */
  read: () => LocalRuntimeState
  /** 把合并结果写回运行时（React state + 既有持久化路径） */
  write: (next: LocalRuntimeState) => void
}

/** 设备本地设置永远取本机的值 */
function keepDeviceLocal(next: Preferences, current: Preferences): Preferences {
  const merged = { ...next } as unknown as Record<string, unknown>
  const source = current as unknown as Record<string, unknown>
  for (const field of DEVICE_LOCAL_SETTING_FIELDS) {
    merged[field] = source[field]
  }
  return merged as unknown as Preferences
}

/**
 * 「使用云端数据」的基线：从出厂默认出发，云端没有的实体就等于没有，
 * 否则本机残留的订阅会以「云端也有」的姿态活下来。
 */
function replacementBase(current: LocalRuntimeState): LocalRuntimeState {
  return {
    prefs: keepDeviceLocal(normalizePreferences(DEFAULT_PREFERENCES), current.prefs),
    enabledIds: [],
    presets: buildFreshInstallPresetsState(),
  }
}

export function createRuntimeSyncAdapter(bridge: RuntimeBridge): SyncRuntimeAdapter {
  return {
    project: async () => projectLocalState(bridge.read()),

    applyRemote: async (records: SyncRecord[], options?: { replace?: boolean }) => {
      const current = bridge.read()
      const base = options?.replace ? replacementBase(current) : current
      const merged = applyRemoteRecords(base, records)
      bridge.write({ ...merged, prefs: keepDeviceLocal(merged.prefs, current.prefs) })
    },

    readState: readSyncState,
    writeState: writeSyncState,
    readApplyJournal,
    writeApplyJournal,
    clearApplyJournal,
  }
}
