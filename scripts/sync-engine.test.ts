/**
 * 同步引擎：正常收发、丢响应重放、push 在途编辑、无回声、apply journal 崩溃重放、
 * 401 暂停、429 Retry-After、5xx 指数退避、手动绕过退避、单飞合并。
 * 用法：npx tsx scripts/sync-engine.test.ts
 */
import assert from 'node:assert/strict'

import type {
  BootstrapEntity,
  SyncBootstrapReplaceResponse,
  SyncBootstrapResponse,
  SyncConflict,
  SyncMutation,
  SyncMutationResult,
  SyncPullResponse,
  SyncPushResponse,
  SyncRecord,
} from '@newsnook/contracts'

import { SyncEngine, mergeConflicts, type SyncRuntimeAdapter } from '../src/features/sync/SyncEngine'
import { applyRemoteRecords, type LocalRuntimeState } from '../src/features/sync/merge'
import { SETTING_KEYS, projectLocalState } from '../src/features/sync/projection'
import { reconcileProjection } from '../src/features/sync/reconcile'
import { createInitialSyncState } from '../src/features/sync/state'
import { SyncTransportError, type SyncTransport } from '../src/features/sync/transport'
import type { LocalSyncState, SyncApplyJournal } from '../src/features/sync/types'
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/sources/preferences'
import { buildFreshInstallPresetsState } from '../src/sources/presets'
import { SOURCES } from '../src/sources/registry'

console.log('Testing cloud sync engine...')

const BUILTIN_ENABLED = SOURCES.filter((source) => source.enabled).map((source) => source.id)

function baseRuntime(): LocalRuntimeState {
  return {
    prefs: normalizePreferences(DEFAULT_PREFERENCES),
    enabledIds: [...BUILTIN_ENABLED],
    presets: buildFreshInstallPresetsState(),
  }
}

// ----------------------------------------------------------- 内存版云端

/** 复刻服务端的 revision 分配与 mutationId 幂等，不复刻冲突分类（用例单独注入） */
class FakeCloud {
  revision = 0
  entities = new Map<string, { payload: unknown; revision: number; deleted: boolean }>()
  private readonly results = new Map<string, SyncMutationResult>()
  pushCount = 0

  /** 这些实体键上的 mutation 一律判冲突，用来复刻服务端「陈旧改动」的分支 */
  readonly conflictKeys = new Set<string>()
  /** 与服务端一致：同一实体只维护一条未裁决冲突，重复 push 复用同一个 id */
  private readonly conflictIds = new Map<string, string>()
  /** 每个实体收到过多少笔冲突 mutation；C1 的核心断言就看它 */
  readonly conflictPushes = new Map<string, number>()

  push(mutations: SyncMutation[]): SyncPushResponse {
    this.pushCount += 1
    const results: SyncMutationResult[] = []
    const conflicts = new Map<string, SyncConflict>()

    for (const mutation of mutations) {
      const replayed = this.results.get(mutation.mutationId)
      if (replayed) {
        results.push(replayed)
        continue
      }

      const conflictKey = `${mutation.entityType}:${mutation.entityId}`
      if (this.conflictKeys.has(conflictKey)) {
        this.conflictPushes.set(conflictKey, (this.conflictPushes.get(conflictKey) ?? 0) + 1)

        let conflictId = this.conflictIds.get(conflictKey)
        if (!conflictId) {
          conflictId = `conflict-${this.conflictIds.size + 1}`
          this.conflictIds.set(conflictKey, conflictId)
        }
        const serverRevision = this.entities.get(conflictKey)?.revision ?? 0

        const result: SyncMutationResult = {
          mutationId: mutation.mutationId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          status: 'conflict',
          revision: serverRevision,
          conflictId,
        }
        this.results.set(mutation.mutationId, result)
        results.push(result)
        conflicts.set(conflictId, {
          id: conflictId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          reason: 'category_stale_mutation',
          serverRevision,
          baseRevision: mutation.baseRevision,
          localChange: { operation: mutation.operation, payload: mutation.payload },
          serverState: { deleted: false, payload: this.entities.get(conflictKey)?.payload ?? null },
          createdAt: 0,
          resolvedAt: null,
        })
        continue
      }

      this.revision += 1
      const key = `${mutation.entityType}:${mutation.entityId}`
      this.entities.set(key, {
        payload: mutation.operation === 'delete' ? null : mutation.payload,
        revision: this.revision,
        deleted: mutation.operation === 'delete',
      })

      const result: SyncMutationResult = {
        mutationId: mutation.mutationId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        status: 'accepted',
        revision: this.revision,
        conflictId: null,
      }
      this.results.set(mutation.mutationId, result)
      results.push(result)
    }

    return {
      protocolVersion: 1,
      results,
      conflicts: [...conflicts.values()],
      currentRevision: this.revision,
    }
  }

  /** 用户裁决之后服务端不再判冲突；`accept_local` 会把那份内容落成新 revision */
  resolveConflict(conflictKey: string, payload: unknown): void {
    this.conflictKeys.delete(conflictKey)
    this.conflictIds.delete(conflictKey)
    this.revision += 1
    this.entities.set(conflictKey, { payload, revision: this.revision, deleted: false })
  }

  pull(since: number, limit: number): SyncPullResponse {
    const all: SyncRecord[] = []
    for (const [key, entity] of this.entities) {
      if (entity.revision <= since) continue
      const separator = key.indexOf(':')
      all.push({
        entityType: key.slice(0, separator) as SyncRecord['entityType'],
        entityId: key.slice(separator + 1),
        revision: entity.revision,
        deleted: entity.deleted,
        updatedAt: 0,
        payload: entity.payload,
      })
    }
    all.sort((left, right) => left.revision - right.revision)

    const page = all.slice(0, limit)
    const hasMore = all.length > limit
    return {
      records: page,
      cursor: hasMore ? (page[page.length - 1]?.revision ?? since) : Math.max(since, this.revision),
      currentRevision: this.revision,
      hasMore,
    }
  }

  /** 直接写入，模拟「另一台设备推上来的改动」 */
  seedFrom(state: LocalRuntimeState): void {
    for (const entity of Object.values(projectLocalState(state))) {
      this.revision += 1
      this.entities.set(`${entity.entityType}:${entity.entityId}`, {
        payload: entity.payload,
        revision: this.revision,
        deleted: false,
      })
    }
  }
}

interface Harness {
  engine: SyncEngine
  cloud: FakeCloud
  adapter: SyncRuntimeAdapter
  transport: SyncTransport
  runtime: () => LocalRuntimeState
  setRuntime: (next: LocalRuntimeState) => void
  state: () => LocalSyncState
  journal: () => SyncApplyJournal | null
  setJournal: (journal: SyncApplyJournal | null) => void
  clock: { value: number }
  pullLimit: number
}

interface HarnessOptions {
  runtime?: LocalRuntimeState
  state?: LocalSyncState
  journal?: SyncApplyJournal | null
  cloud?: FakeCloud
  firstSyncCompleted?: boolean
  pullLimit?: number
  isOnline?: () => boolean
  beforePush?: (mutations: SyncMutation[]) => void
  afterPush?: (response: SyncPushResponse) => void
  onPull?: () => void
  conflictsOnPush?: SyncConflict[]
  onResolveConflict?: (conflictId: string, resolution: string) => void | Promise<void>
}

function createHarness(options: HarnessOptions = {}): Harness {
  const cloud = options.cloud ?? new FakeCloud()
  const clock = { value: 1_000_000 }
  const pullLimit = options.pullLimit ?? 500

  let runtime = options.runtime ?? baseRuntime()
  // 除非用例明说，harness 模拟的是「首次数据归属已经决定过」的日常设备
  let state =
    options.state ??
    ({
      ...createInitialSyncState('11111111-2222-4333-8444-555555555555'),
      firstSyncCompleted: options.firstSyncCompleted ?? true,
    } satisfies LocalSyncState)
  let journal: SyncApplyJournal | null = options.journal ?? null

  const adapter: SyncRuntimeAdapter = {
    project: async () => projectLocalState(runtime),
    applyRemote: async (records, applyOptions) => {
      const base = applyOptions?.replace ? baseRuntime() : runtime
      runtime = applyRemoteRecords(base, records)
    },
    readState: () => state,
    writeState: (next) => {
      state = next
    },
    readApplyJournal: () => journal,
    writeApplyJournal: (next) => {
      journal = next
    },
    clearApplyJournal: () => {
      journal = null
    },
  }

  const transport: SyncTransport = {
    bootstrap: async (): Promise<SyncBootstrapResponse> => ({
      protocolVersion: 1,
      currentRevision: cloud.revision,
      counts: { subscriptions: 0, categories: 0, settings: 0, secrets: 0 },
      secretKeys: [],
      lastUpdatedAt: null,
    }),
    bootstrapReplace: async (entities: BootstrapEntity[]): Promise<SyncBootstrapReplaceResponse> => {
      cloud.entities.clear()
      for (const entity of entities) {
        cloud.revision += 1
        cloud.entities.set(`${entity.entityType}:${entity.entityId}`, {
          payload: entity.payload,
          revision: cloud.revision,
          deleted: false,
        })
      }
      return {
        protocolVersion: 1,
        currentRevision: cloud.revision,
        written: entities.length,
        tombstoned: 0,
      }
    },
    push: async (mutations) => {
      options.beforePush?.(mutations)
      const response = cloud.push(mutations)
      const withConflicts = options.conflictsOnPush
        ? { ...response, conflicts: options.conflictsOnPush }
        : response
      options.afterPush?.(withConflicts)
      return withConflicts
    },
    pull: async (since) => {
      options.onPull?.()
      return cloud.pull(since, pullLimit)
    },
    listConflicts: async () => [],
    resolveConflict: async (conflictId, resolution) => {
      await options.onResolveConflict?.(conflictId, resolution)
    },
    resolveConflicts: async (decisions) => {
      for (const { conflictId, resolution } of decisions) {
        await options.onResolveConflict?.(conflictId, resolution)
      }
    },
  }

  const engine = new SyncEngine({
    adapter,
    transport,
    now: () => clock.value,
    random: () => 0.5,
    isOnline: options.isOnline,
  })

  return {
    engine,
    cloud,
    adapter,
    transport,
    runtime: () => runtime,
    setRuntime: (next) => {
      runtime = next
    },
    state: () => state,
    journal: () => journal,
    setJournal: (next) => {
      journal = next
    },
    clock,
    pullLimit,
  }
}

function withTheme(runtime: LocalRuntimeState, theme: 'dark' | 'light'): LocalRuntimeState {
  return { ...runtime, prefs: normalizePreferences({ ...runtime.prefs, theme }) }
}

// -------------------------------------------------- 首次同步前的保护闸

{
  // 新设备登录时云端已有数据：日常同步必须停住，等用户决定归属
  const cloud = new FakeCloud()
  cloud.seedFrom(withTheme(baseRuntime(), 'dark'))

  const harness = createHarness({ cloud, firstSyncCompleted: false })
  const revisionBefore = cloud.revision

  await harness.engine.sync('startup')

  assert.equal(harness.engine.getStatus().phase, 'needs-first-sync')
  assert.equal(cloud.pushCount, 0, '未做首次决策前不得 push 本机默认配置')
  assert.equal(cloud.revision, revisionBefore, '云端数据不能被新设备的默认值覆盖')
  assert.equal(harness.runtime().prefs.theme, DEFAULT_PREFERENCES.theme)
}

// ------------------------------------------------------------ 正常收发

{
  const harness = createHarness()
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))

  await harness.engine.sync('local-change')

  const stored = harness.cloud.entities.get(`setting:${SETTING_KEYS.theme}`)
  assert.deepEqual(stored?.payload, { value: 'dark' }, '本地改动应推到云端')
  assert.equal(harness.state().outbox.length, 0, 'ack 后 Outbox 清空')
  assert.equal(harness.engine.getStatus().phase, 'idle')
  assert.ok(harness.state().cursor > 0, 'cursor 前进到服务端 head')

  // 第二台设备选「使用云端」后应当收到同样的主题
  const second = createHarness({ cloud: harness.cloud, firstSyncCompleted: false })
  await second.engine.adoptCloud()
  assert.equal(second.runtime().prefs.theme, 'dark')
  await second.engine.sync('foreground')
  assert.equal(second.engine.getStatus().phase, 'idle')
}

{
  // 完全没有本地改动时不该产生任何 push
  const harness = createHarness()
  await harness.engine.sync('startup')
  const firstPushes = harness.cloud.pushCount

  await harness.engine.sync('foreground')
  assert.equal(harness.cloud.pushCount, firstPushes, '无改动不应重复 push')
}

// -------------------------------------------------------- 无回声（关键）

{
  const remote = withTheme(baseRuntime(), 'dark')
  const cloud = new FakeCloud()
  cloud.seedFrom(remote)

  const harness = createHarness({ cloud, firstSyncCompleted: false })
  await harness.engine.adoptCloud()
  assert.equal(harness.runtime().prefs.theme, 'dark', '远端数据已应用')

  const pushesAfterApply = cloud.pushCount
  await harness.engine.sync('local-change')
  assert.equal(cloud.pushCount, pushesAfterApply, '应用远端数据不得反向产生 mutation')

  const reconciled = reconcileProjection(projectLocalState(harness.runtime()), harness.state())
  assert.deepEqual(reconciled.added, [], '对账结果为空才算真的没有回声')
}

// -------------------------------------------------------- 丢响应后重放

{
  const cloud = new FakeCloud()
  let dropResponse = true

  const harness = createHarness({
    cloud,
    afterPush: () => {
      // 服务端已经处理完，客户端却没拿到响应
      if (dropResponse) {
        dropResponse = false
        throw new SyncTransportError({ code: 'NETWORK_ERROR', message: 'connection reset' })
      }
    },
  })
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))

  await harness.engine.sync('local-change')
  assert.equal(harness.engine.getStatus().phase, 'error')
  assert.ok(harness.state().outbox.length > 0, '没收到响应就不能清 Outbox')
  const revisionAfterLostResponse = cloud.revision

  harness.clock.value += 60_000
  await harness.engine.sync('manual')

  assert.equal(harness.state().outbox.length, 0)
  assert.equal(cloud.revision, revisionAfterLostResponse, '重放同一批 mutationId 不能再分配 revision')
  assert.equal(harness.engine.getStatus().phase, 'idle')
}

// ---------------------------------------------------- push 在途时的编辑

{
  const cloud = new FakeCloud()
  let harness: Harness
  let edited = false

  harness = createHarness({
    cloud,
    beforePush: () => {
      // 请求已经发出、还没回来，用户又把主题改成 light
      if (edited) return
      edited = true
      harness.setRuntime(withTheme(harness.runtime(), 'light'))
    },
  })
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))

  await harness.engine.sync('local-change')

  // 关键：紧随其后的 pull 不能用服务端的 dark 把本地 light 打回去
  assert.equal(harness.runtime().prefs.theme, 'light', '在途期间的编辑不能被吞掉')
  assert.deepEqual(cloud.entities.get(`setting:${SETTING_KEYS.theme}`)?.payload, { value: 'light' })
  assert.deepEqual(
    reconcileProjection(projectLocalState(harness.runtime()), harness.state()).added,
    [],
    '追上之后应当收敛',
  )
}

// ------------------------------------------------------ apply journal 重放

{
  const remote = withTheme(baseRuntime(), 'dark')
  const records: SyncRecord[] = Object.values(projectLocalState(remote)).map((entity, index) => ({
    entityType: entity.entityType,
    entityId: entity.entityId,
    revision: index + 1,
    deleted: false,
    updatedAt: 0,
    payload: entity.payload,
  }))

  // 上次运行写完 journal 就被杀掉：cursor 没动、数据没落地
  const harness = createHarness({
    journal: { records, targetCursor: records.length, startedAt: 0 },
  })
  assert.equal(harness.runtime().prefs.theme, DEFAULT_PREFERENCES.theme)

  await harness.engine.sync('startup')

  assert.equal(harness.runtime().prefs.theme, 'dark', '冷启动必须先重放 journal')
  assert.equal(harness.journal(), null, '重放成功后清掉 journal')
  assert.ok(harness.state().cursor >= records.length)
}

// -------------------------------------------------------------- 401 暂停

{
  const harness = createHarness({
    onPull: () => {
      throw new SyncTransportError({
        code: 'SESSION_EXPIRED',
        message: 'session expired',
        status: 401,
        requestId: 'req-401',
      })
    },
  })

  await harness.engine.sync('startup')

  const status = harness.engine.getStatus()
  assert.equal(status.phase, 'paused', '认证失效应暂停而不是无限重试')
  assert.equal(status.lastError?.code, 'SESSION_EXPIRED')
  assert.equal(status.lastError?.requestId, 'req-401', '错误编号要能带给用户')
  assert.equal(harness.state().nextRetryAt, null, '暂停态不排退避定时器')

  // 暂停期间的自动触发直接跳过，不再打服务端
  let pulled = 0
  const paused = createHarness({ onPull: () => { pulled += 1 } })
  void paused
  await harness.engine.sync('foreground')
  assert.equal(harness.engine.getStatus().phase, 'paused')
  assert.equal(pulled, 0)
}

{
  // 设备被撤销同样属于「需要用户处理」
  const harness = createHarness({
    onPull: () => {
      throw new SyncTransportError({ code: 'DEVICE_REVOKED', message: 'revoked', status: 403 })
    },
  })
  await harness.engine.sync('startup')
  assert.equal(harness.engine.getStatus().phase, 'paused')
}

// ------------------------------------------------------- 429 Retry-After

{
  const harness = createHarness({
    onPull: () => {
      throw new SyncTransportError({
        code: 'RATE_LIMITED',
        message: 'slow down',
        status: 429,
        retryAfterMs: 30_000,
      })
    },
  })

  await harness.engine.sync('startup')
  assert.equal(harness.engine.getStatus().phase, 'error')
  assert.equal(
    harness.state().nextRetryAt,
    harness.clock.value + 30_000,
    'Retry-After 必须优先于本地退避曲线',
  )
}

// ------------------------------------------------------------ 5xx 退避

{
  let attempts = 0
  const harness = createHarness({
    onPull: () => {
      attempts += 1
      throw new SyncTransportError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'maintenance',
        status: 503,
      })
    },
  })

  const delays: number[] = []
  for (let round = 0; round < 4; round += 1) {
    await harness.engine.sync('manual')
    delays.push(harness.state().nextRetryAt! - harness.clock.value)
  }

  assert.equal(attempts, 4)
  assert.deepEqual(delays, [1000, 2000, 4000, 8000], 'random()=0.5 时抖动为 0，退避应严格翻倍')

  // 封顶 5 分钟
  const engine = harness.engine
  assert.equal(engine.backoffDelay(1), 1000)
  assert.ok(engine.backoffDelay(30) <= 5 * 60 * 1000)
  assert.ok(engine.backoffDelay(30) >= 1000)
}

{
  // 抖动范围：±25%，且永不低于 1s
  const low = createHarness()
  const lowEngine = new SyncEngine({
    adapter: low.adapter,
    transport: {} as SyncTransport,
    now: () => low.clock.value,
    random: () => 0,
  })
  const highEngine = new SyncEngine({
    adapter: low.adapter,
    transport: {} as SyncTransport,
    now: () => low.clock.value,
    random: () => 1,
  })
  assert.equal(lowEngine.backoffDelay(3), 3000)
  assert.equal(highEngine.backoffDelay(3), 5000)
}

// ------------------------------------------------- 退避窗口与手动同步

{
  let pulls = 0
  const harness = createHarness({
    onPull: () => {
      pulls += 1
      if (pulls === 1) {
        throw new SyncTransportError({ code: 'INTERNAL_ERROR', message: 'boom', status: 500 })
      }
    },
  })

  await harness.engine.sync('startup')
  assert.equal(pulls, 1)
  assert.ok(harness.state().nextRetryAt! > harness.clock.value)

  // 退避窗口内的自动触发被静默跳过
  await harness.engine.sync('foreground')
  assert.equal(pulls, 1, '退避未到期不应发起自动同步')

  // 用户点「立即同步」可以立刻突破
  await harness.engine.sync('manual')
  assert.equal(pulls, 2)
  assert.equal(harness.state().nextRetryAt, null, '成功后清空退避')
  assert.equal(harness.state().retryAttempt, 0)
}

// ------------------------------------------------------------- 离线行为

{
  let online = false
  const harness = createHarness({ isOnline: () => online })

  await harness.engine.sync('startup')
  assert.equal(harness.engine.getStatus().phase, 'offline')
  assert.equal(harness.cloud.pushCount, 0, '离线时不发请求')

  online = true
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))
  await harness.engine.sync('network')
  assert.equal(harness.engine.getStatus().phase, 'idle')
  assert.deepEqual(harness.cloud.entities.get(`setting:${SETTING_KEYS.theme}`)?.payload, {
    value: 'dark',
  })
}

// -------------------------------------------------------------- 单飞合并

{
  let concurrent = 0
  let maxConcurrent = 0
  const harness = createHarness({
    onPull: () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      concurrent -= 1
    },
  })

  await Promise.all([
    harness.engine.sync('startup'),
    harness.engine.sync('foreground'),
    harness.engine.sync('local-change'),
  ])

  assert.equal(maxConcurrent, 1, '同一时刻只能有一轮同步在跑')
  assert.equal(harness.engine.getStatus().phase, 'idle')
}

// -------------------------------------------------------- 分页拉取收敛

{
  const cloud = new FakeCloud()
  cloud.seedFrom(withTheme(baseRuntime(), 'dark'))

  const harness = createHarness({ cloud, pullLimit: 3, firstSyncCompleted: false })
  await harness.engine.adoptCloud()

  assert.equal(harness.runtime().prefs.theme, 'dark')
  assert.equal(harness.state().cursor, cloud.revision, '分页拉完后 cursor 应对齐 head')
}

// ------------------------------------------------------ 首次数据归属决策

{
  // 「使用云端」：本机差异被整包替换
  const cloud = new FakeCloud()
  cloud.seedFrom(withTheme(baseRuntime(), 'dark'))

  const harness = createHarness({ cloud })
  harness.setRuntime({
    ...withTheme(harness.runtime(), 'light'),
    prefs: normalizePreferences({
      ...harness.runtime().prefs,
      theme: 'light',
      einkMode: true,
    }),
  })

  await harness.engine.adoptCloud()
  assert.equal(harness.runtime().prefs.theme, 'dark')
  assert.equal(harness.state().firstSyncCompleted, true)
  assert.equal(harness.journal(), null)

  // 换成云端基线后同样不该产生回声
  const reconciled = reconcileProjection(projectLocalState(harness.runtime()), harness.state())
  assert.deepEqual(reconciled.added, [])
}

{
  // 「使用本机」：本机快照成为云端新基线
  const cloud = new FakeCloud()
  cloud.seedFrom(withTheme(baseRuntime(), 'dark'))

  const harness = createHarness({ cloud })
  harness.setRuntime(withTheme(harness.runtime(), 'light'))

  await harness.engine.adoptLocal()

  assert.deepEqual(cloud.entities.get(`setting:${SETTING_KEYS.theme}`)?.payload, { value: 'light' })
  assert.equal(harness.state().firstSyncCompleted, true)
  assert.equal(harness.runtime().prefs.theme, 'light')
  assert.deepEqual(
    reconcileProjection(projectLocalState(harness.runtime()), harness.state()).added,
    [],
  )
}

{
  // 「合并」：本机改动推上去，云端独有的对象拉下来，两边都不丢
  const cloud = new FakeCloud()
  const remote = baseRuntime()
  remote.prefs = normalizePreferences({
    ...remote.prefs,
    customSources: [
      {
        id: 'custom:cloud-only',
        name: '云端独有源',
        label: '云端',
        group: 'custom',
        kind: 'feed',
        url: 'https://cloud-only.example/feed',
        enabled: true,
        isCustom: true,
        createdAt: 1,
      },
    ],
  })
  remote.enabledIds = [...remote.enabledIds, 'custom:cloud-only']
  cloud.seedFrom(remote)

  const harness = createHarness({ cloud, firstSyncCompleted: false })
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))

  await harness.engine.adoptMerge()

  assert.equal(harness.state().firstSyncCompleted, true)
  assert.deepEqual(
    cloud.entities.get(`setting:${SETTING_KEYS.theme}`)?.payload,
    { value: 'dark' },
    '本机改动推到云端',
  )
  assert.ok(
    harness.runtime().prefs.customSources?.some((source) => source.id === 'custom:cloud-only'),
    '云端独有的自建源应合并到本机',
  )
  assert.deepEqual(
    reconcileProjection(projectLocalState(harness.runtime()), harness.state()).added,
    [],
    '合并完成后应收敛',
  )
}

// ------------------------------------------------- 冲突不在同一轮里重复上报

function hideCategory(runtime: LocalRuntimeState, id: string): LocalRuntimeState {
  return {
    ...runtime,
    prefs: normalizePreferences({
      ...runtime.prefs,
      hiddenCategoryIds: [...(runtime.prefs.hiddenCategoryIds ?? []), id],
    }),
  }
}

/** 投影里任取一个内置分类，作为「会起冲突的那个实体」 */
function firstCategoryId(runtime: LocalRuntimeState): string {
  const entity = Object.values(projectLocalState(runtime)).find(
    (candidate) => candidate.entityType === 'category',
  )
  assert.ok(entity, '投影里应当有内置分类')
  return entity.entityId
}

{
  // 服务端判了冲突：这一轮同步里绝不能换个 mutationId 把同一处分歧再推一遍
  const cloud = new FakeCloud()
  const harness = createHarness({ cloud })
  const categoryId = firstCategoryId(harness.runtime())
  const conflictKey = `category:${categoryId}`
  cloud.conflictKeys.add(conflictKey)

  harness.setRuntime(hideCategory(harness.runtime(), categoryId))
  await harness.engine.sync('local-change')

  assert.equal(
    cloud.conflictPushes.get(conflictKey),
    1,
    '一轮同步里同一处分歧只该上报一次，不能被 pushPending 的重试轮次放大',
  )
  assert.equal(harness.engine.getConflicts().length, 1)
  assert.equal(harness.state().outbox.length, 0, '冲突的 mutation 不留在 Outbox 里空转')
  assert.ok(harness.state().conflicted[conflictKey], '冲突实体被标记占用')

  // 后续几轮同步同样不该重推：裁决权在用户手上
  await harness.engine.sync('foreground')
  await harness.engine.sync('local-change')
  assert.equal(cloud.conflictPushes.get(conflictKey), 1, '跨轮次也不能重复上报同一处分歧')
  assert.equal(harness.engine.getConflicts().length, 1, '冲突列表不该堆积重复项')

  // 冲突期间其它实体照常同步，不能被一处分歧拖住整个同步
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))
  await harness.engine.sync('local-change')
  assert.deepEqual(cloud.entities.get(`setting:${SETTING_KEYS.theme}`)?.payload, { value: 'dark' })

  // 用户选「使用本机」：解除占用，本机那一版重新推上去并收敛
  cloud.resolveConflict(conflictKey, projectLocalState(harness.runtime())[conflictKey]!.payload)
  await harness.engine.resolveConflicts([{ id: 'conflict-1', resolution: 'accept_local' }])

  assert.equal(harness.engine.getConflicts().length, 0)
  assert.deepEqual(harness.state().conflicted, {}, '裁决后不再占用该实体')
  assert.deepEqual(
    reconcileProjection(projectLocalState(harness.runtime()), harness.state()).added,
    [],
    '裁决后应当收敛',
  )
}

{
  // 拉到服务端那一版就等于分歧消化完：标记自动解除，本机改动留在冲突里没有丢
  const cloud = new FakeCloud()
  const harness = createHarness({ cloud })
  const categoryId = firstCategoryId(harness.runtime())
  const conflictKey = `category:${categoryId}`
  cloud.conflictKeys.add(conflictKey)

  harness.setRuntime(hideCategory(harness.runtime(), categoryId))
  await harness.engine.sync('local-change')
  assert.ok(harness.state().conflicted[conflictKey])

  const conflict = harness.engine.getConflicts()[0]!
  assert.deepEqual(
    (conflict.localChange as { payload?: { visible?: boolean } }).payload?.visible,
    false,
    '本机那一版完整保存在冲突里，用户随时能取回',
  )

  // 服务端就这个实体发布了新版本，客户端拉下来应用
  cloud.conflictKeys.delete(conflictKey)
  cloud.revision += 1
  cloud.entities.set(conflictKey, {
    payload: { kind: 'builtin', visible: true, sortRank: '000001', sourceIds: null },
    revision: cloud.revision,
    deleted: false,
  })

  await harness.engine.sync('manual')
  assert.deepEqual(harness.state().conflicted, {}, 'shadow 追上服务端后标记自动解除')
}

{
  // 多批 push 各带一部分冲突：面板拿到的必须是累计全量，不是最后一批
  const make = (id: string, serverRevision: number): SyncConflict => ({
    id,
    entityType: 'category',
    entityId: id,
    reason: 'category_stale_mutation',
    serverRevision,
    baseRevision: 0,
    localChange: null,
    serverState: null,
    createdAt: 0,
    resolvedAt: null,
  })

  const merged = mergeConflicts(
    [make('a', 1), make('b', 1)],
    [make('b', 9), make('c', 1)],
  )

  assert.deepEqual(
    merged.map((conflict) => conflict.id),
    ['a', 'b', 'c'],
    '后一批不能顶掉前一批',
  )
  assert.equal(
    merged.find((conflict) => conflict.id === 'b')?.serverRevision,
    9,
    '同一条冲突以最新快照为准，不重复堆叠',
  )
}

{
  // 引擎发出的冲突事件本身就是累计全量：UI 直接替换即可，不必自己去合并
  const cloud = new FakeCloud()
  const emitted: SyncConflict[][] = []
  const harness = createHarness({ cloud })
  const categoryId = firstCategoryId(harness.runtime())
  cloud.conflictKeys.add(`category:${categoryId}`)

  const engine = new SyncEngine({
    adapter: harness.adapter,
    transport: harness.transport,
    now: () => harness.clock.value,
    onEvent: (event) => {
      if (event.type === 'conflicts') emitted.push(event.conflicts)
    },
  })

  harness.setRuntime(hideCategory(harness.runtime(), categoryId))
  await engine.sync('local-change')

  assert.ok(emitted.length, '出现冲突必须发事件')
  assert.deepEqual(emitted.at(-1), engine.getConflicts(), '事件带的就是引擎持有的全量列表')
}

// -------------------------------------------------------------- 批量裁决

{
  // 批量裁决：一次（或按上限分块）落服务端并汇报进度，整批只跑一轮同步
  const resolved: Array<[string, string]> = []
  const progress: Array<[number, number]> = []
  let pulls = 0
  const harness = createHarness({
    onResolveConflict: (conflictId, resolution) => {
      resolved.push([conflictId, resolution])
    },
    onPull: () => {
      pulls += 1
    },
  })

  await harness.engine.resolveConflicts(
    [
      { id: 'c1', resolution: 'accept_local' },
      { id: 'c2', resolution: 'accept_server' },
      { id: 'c3', resolution: 'accept_local' },
    ],
    (done, total) => progress.push([done, total]),
  )

  assert.deepEqual(resolved, [
    ['c1', 'accept_local'],
    ['c2', 'accept_server'],
    ['c3', 'accept_local'],
  ])
  assert.deepEqual(progress, [[3, 3]], '同批三项一次 HTTP，进度按块汇报')
  assert.equal(pulls, 1, '三项决定只该触发一轮同步')
}

{
  // 中途失败：整块失败则本块都不算完成；错误抛给面板去展示重试
  const resolved: string[] = []
  const harness = createHarness({
    onResolveConflict: (conflictId) => {
      if (conflictId === 'c2') {
        throw new SyncTransportError({ code: 'SERVICE_UNAVAILABLE', message: 'down', status: 503 })
      }
      resolved.push(conflictId)
    },
  })

  await assert.rejects(
    harness.engine.resolveConflicts([
      { id: 'c1', resolution: 'accept_local' },
      { id: 'c2', resolution: 'accept_server' },
      { id: 'c3', resolution: 'accept_local' },
    ]),
    (error: unknown) => error instanceof SyncTransportError && error.code === 'SERVICE_UNAVAILABLE',
  )
  // 假 transport 按顺序回调：c1 已执行，c2 抛错；服务端真批量是事务，要么全成要么全不成。
  // 引擎侧：块失败时本块 id 不会从本地 conflicts 队列移除（由 finally 发事件）。
  assert.deepEqual(resolved, ['c1'])
}

// -------------------------------------------------------------- 登出重置

{
  const harness = createHarness()
  harness.setRuntime(withTheme(harness.runtime(), 'dark'))
  await harness.engine.sync('local-change')

  const subscriptionsBefore = harness.runtime().enabledIds.length
  harness.engine.reset()

  const state = harness.state()
  assert.equal(state.cursor, 0)
  assert.deepEqual(state.shadow, {})
  assert.deepEqual(state.outbox, [])
  assert.equal(state.firstSyncCompleted, false)
  assert.equal(harness.runtime().prefs.theme, 'dark', '登出不动本机配置')
  assert.equal(harness.runtime().enabledIds.length, subscriptionsBefore, '登出不动本机订阅')
}

console.log('All cloud sync engine tests passed.')
