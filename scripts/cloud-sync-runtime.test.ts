/**
 * 运行时接线：远端记录写回 Preferences / 启用信源 / 场景预设而不重载页面、
 * 设备本地设置不被远端覆盖、应用完不产生回声、「使用云端」整包替换。
 * 用法：npx tsx scripts/cloud-sync-runtime.test.ts
 */
import assert from 'node:assert/strict'

import type { SyncRecord } from '@newsnook/contracts'

import { fingerprintOf } from '../src/features/sync/fingerprint'
import type { LocalRuntimeState } from '../src/features/sync/merge'
import { SETTING_KEYS, projectLocalState } from '../src/features/sync/projection'
import { reconcileProjection } from '../src/features/sync/reconcile'
import { createRuntimeSyncAdapter } from '../src/features/sync/runtimeAdapter'
import { createInitialSyncState, readSyncState, writeSyncState } from '../src/features/sync/state'
import { advanceShadow } from '../src/features/sync/SyncEngine'
import { DEFAULT_PREFERENCES, addCustomSource, normalizePreferences } from '../src/sources/preferences'
import { buildFreshInstallPresetsState } from '../src/sources/presets'
import { SOURCES } from '../src/sources/registry'

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

console.log('Testing cloud sync runtime wiring...')

const BUILTIN_ENABLED = SOURCES.filter((source) => source.enabled).map((source) => source.id)

function baseRuntime(): LocalRuntimeState {
  return {
    prefs: normalizePreferences(DEFAULT_PREFERENCES),
    enabledIds: [...BUILTIN_ENABLED],
    presets: buildFreshInstallPresetsState(),
  }
}

let revision = 0
function record(
  entityType: SyncRecord['entityType'],
  entityId: string,
  payload: unknown,
  deleted = false,
): SyncRecord {
  revision += 1
  return {
    entityType,
    entityId,
    entityId2: undefined,
    payload: deleted ? null : payload,
    revision,
    deleted,
    updatedAt: Date.now(),
  } as unknown as SyncRecord
}

function harness(initial: LocalRuntimeState = baseRuntime()) {
  let runtime = initial
  let writes = 0
  const adapter = createRuntimeSyncAdapter({
    read: () => runtime,
    write: (next) => {
      writes += 1
      runtime = next
    },
  })
  return {
    adapter,
    get runtime() {
      return runtime
    },
    get writes() {
      return writes
    },
  }
}

// --- 远端记录写回运行时，无需重载 -------------------------------------------

{
  memory.clear()
  writeSyncState(createInitialSyncState('11111111-2222-4333-8444-555555555555'))

  const local = baseRuntime()
  local.prefs = { ...local.prefs, einkMode: true, wifiOnlyAutoLoadMedia: true }
  const scene = harness(local)

  const remotePresets = {
    ...buildFreshInstallPresetsState(),
    activePresetId: 'builtin-tech',
  }

  await scene.adapter.applyRemote([
    record('setting', SETTING_KEYS.theme, { value: 'dark' }),
    record('setting', SETTING_KEYS.recommend, { value: false }),
    record('setting', SETTING_KEYS.presets, { value: remotePresets }),
    record('subscription', BUILTIN_ENABLED[0]!, { kind: 'builtin', enabled: false, sortRank: '1' }, true),
  ])

  assert.equal(scene.writes, 1, '一次远端应用只回写一次运行时')
  assert.equal(scene.runtime.prefs.theme, 'dark', '远端主题生效')
  assert.equal(scene.runtime.prefs.recommendEnabled, false)
  assert.equal(
    scene.runtime.enabledIds.includes(BUILTIN_ENABLED[0]!),
    false,
    'tombstone 让本机取消订阅',
  )
  assert.equal(scene.runtime.presets.activePresetId, 'builtin-tech', '场景预设同步生效')

  // 设备本地设置不被远端触碰
  assert.equal(scene.runtime.prefs.einkMode, true, '墨水屏跟着本机硬件走')
  assert.equal(scene.runtime.prefs.wifiOnlyAutoLoadMedia, true, 'Wi-Fi 媒体策略跟着本机走')
}

// --- 应用远端记录后不产生回声 -----------------------------------------------

{
  memory.clear()
  writeSyncState(createInitialSyncState('11111111-2222-4333-8444-555555555555'))

  const scene = harness()
  const records = [
    record('setting', SETTING_KEYS.theme, { value: 'dark' }),
    record('setting', SETTING_KEYS.typography, {
      value: baseRuntime().prefs.typography,
    }),
  ]

  await scene.adapter.applyRemote(records)

  const state = readSyncState()
  const advanced = { ...state, shadow: advanceShadow(state.shadow, records) }
  const projection = await scene.adapter.project()
  const reconciled = reconcileProjection(projection, advanced)

  const echoed = reconciled.added.filter(
    (entry) => entry.entityType === 'setting' && entry.entityId === SETTING_KEYS.theme,
  )
  assert.equal(echoed.length, 0, '刚应用的远端设置不会被当成本地改动推回去')
  assert.equal(
    fingerprintOf({ value: 'dark' }),
    advanced.shadow['setting:theme']?.fingerprint,
    'shadow 与远端内容对齐',
  )
}

// --- 「使用云端数据」整包替换 -------------------------------------------------

{
  memory.clear()
  writeSyncState(createInitialSyncState('11111111-2222-4333-8444-555555555555'))

  const local = baseRuntime()
  const added = addCustomSource(local.prefs, {
    name: '只在本机的源',
    url: 'https://local-only.example.test/feed',
  })
  local.prefs = { ...added.nextPrefs, einkMode: true }
  local.enabledIds = [...local.enabledIds, added.newSourceId]

  const scene = harness(local)
  const cloudSourceId = 'custom-cloud-1'

  await scene.adapter.applyRemote(
    [
      record('subscription', cloudSourceId, {
        kind: 'custom',
        enabled: true,
        sortRank: '000001',
        name: '云端的源',
        label: '云端',
        group: 'custom',
        sourceKind: 'feed',
        url: 'https://cloud-only.example.test/feed',
        normalizedUrl: 'https://cloud-only.example.test/feed',
        createdAt: 1,
      }),
      record('setting', SETTING_KEYS.theme, { value: 'light' }),
    ],
    { replace: true },
  )

  const ids = scene.runtime.prefs.customSources.map((source) => source.id)
  assert.deepEqual(ids, [cloudSourceId], '本机独有的自建源被云端基线替换掉')
  assert.equal(scene.runtime.prefs.theme, 'light')
  assert.equal(scene.runtime.prefs.einkMode, true, '整包替换也不动设备本地设置')
}

// --- 同步状态持久化：Secret 明文不落盘 ---------------------------------------

{
  memory.clear()
  const state = createInitialSyncState('11111111-2222-4333-8444-555555555555')
  writeSyncState({
    ...state,
    firstSyncCompleted: true,
    outbox: [
      {
        mutationId: '22222222-3333-4444-8555-666666666666',
        entityType: 'secret',
        entityId: 'translation.openai.apiKey',
        operation: 'upsert',
        baseRevision: null,
        payload: { value: 'sk-should-never-persist' },
        fingerprint: 'abc',
      },
    ],
  })

  const raw = memory.getItem('newsnook:sync-state:v1') ?? ''
  assert.equal(raw.includes('sk-should-never-persist'), false, 'Secret 明文不进本地同步状态')

  const restored = readSyncState()
  assert.equal(restored.deviceId, '11111111-2222-4333-8444-555555555555', '设备身份跨重启稳定')
  assert.equal(restored.firstSyncCompleted, true)
  assert.equal(restored.outbox[0]?.payload, null)
}

// --- 未登录不产生任何同步动作 -------------------------------------------------

{
  // 引擎由 useCloudSync 在「有账户 + 已认证」时才创建；这里断言投影本身是纯读，
  // 不写任何存储，未登录时哪怕反复调用也不会留下痕迹。
  memory.clear()
  const projection = projectLocalState(baseRuntime())
  assert.ok(Object.keys(projection).length > 0)
  assert.equal(memory.length, 0, '投影不写存储')
}

console.log('All cloud sync runtime tests passed.')
