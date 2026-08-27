/**
 * 同步引擎：串起「对账 → push → delta pull → 应用 → 落状态」。
 *
 * 三条硬性要求贯穿全文：
 * 1. 云端不可用时永远不能影响本地阅读——所有失败都收敛成状态与退避，不抛给 UI 主流程。
 * 2. 任何一步崩溃都必须能恢复：push 靠 mutationId 幂等，apply 靠 journal 重放。
 * 3. 应用远端数据不得反向产生 mutation（回声），否则两台设备会无限对推。
 */

import { SYNC_LIMITS } from '@newsnook/contracts/protocol'
import type { BootstrapEntity, SyncConflict, SyncPushResponse, SyncRecord } from '@newsnook/contracts'

import { log } from '../../lib/logger'
import { fingerprintOf } from './fingerprint'
import { randomUuid } from './ids'
import { materializeBatch } from './reconcile'
import { reconcileProjection } from './reconcile'
import { SyncTransportError, type SyncTransport } from './transport'
import {
  DELETED_FINGERPRINT,
  entityKey,
  type LocalProjection,
  type LocalSyncState,
  type OutboxEntry,
  type SyncApplyJournal,
} from './types'

export type SyncReason = 'startup' | 'local-change' | 'foreground' | 'network' | 'manual'

export type SyncPhase =
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'paused'
  | 'error'
  /** 还没决定首次登录时以哪一边为准，日常同步必须先停在这里 */
  | 'needs-first-sync'

export interface SyncStatus {
  phase: SyncPhase
  lastSyncedAt: number | null
  lastError: { code: string; message: string; requestId: string | null } | null
  pendingCount: number
  conflictCount: number
  nextRetryAt: number | null
  firstSyncCompleted: boolean
}

export type SyncEvent =
  | { type: 'status'; status: SyncStatus }
  | { type: 'applied'; records: number }
  | { type: 'conflicts'; conflicts: SyncConflict[] }
  | { type: 'first-sync-complete' }
  | { type: 'failed'; code: string; requestId: string | null; attempt: number }

export interface SyncRuntimeAdapter {
  /** 当前本机配置的完整投影 */
  project: () => Promise<LocalProjection>
  /** 把远端记录写回运行时；`replace` 用于「使用云端数据」的整包基线切换 */
  applyRemote: (records: SyncRecord[], options?: { replace?: boolean }) => Promise<void>
  readState: () => LocalSyncState
  writeState: (state: LocalSyncState) => void
  readApplyJournal: () => SyncApplyJournal | null
  writeApplyJournal: (journal: SyncApplyJournal) => void
  clearApplyJournal: () => void
}

export interface SyncEngineOptions {
  adapter: SyncRuntimeAdapter
  transport: SyncTransport
  now?: () => number
  random?: () => number
  isOnline?: () => boolean
  onEvent?: (event: SyncEvent) => void
}

const BASE_RETRY_MS = 1000
const MAX_RETRY_MS = 5 * 60 * 1000
const JITTER_RATIO = 0.25

export class SyncEngine {
  private readonly adapter: SyncRuntimeAdapter
  private readonly transport: SyncTransport
  private readonly now: () => number
  private readonly random: () => number
  private readonly isOnline: () => boolean
  private readonly onEvent?: (event: SyncEvent) => void

  private inFlight: Promise<void> | null = null
  private queuedReason: SyncReason | null = null
  private phase: SyncPhase = 'idle'
  private lastSyncedAt: number | null = null
  private lastError: SyncStatus['lastError'] = null
  private conflicts: SyncConflict[] = []

  constructor(options: SyncEngineOptions) {
    this.adapter = options.adapter
    this.transport = options.transport
    this.now = options.now ?? (() => Date.now())
    this.random = options.random ?? Math.random
    this.isOnline = options.isOnline ?? (() => true)
    this.onEvent = options.onEvent
  }

  // ------------------------------------------------------------- 对外状态

  getStatus(): SyncStatus {
    const state = this.adapter.readState()
    return {
      phase: this.phase,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError,
      pendingCount: state.outbox.length,
      conflictCount: this.conflicts.length,
      nextRetryAt: state.nextRetryAt,
      firstSyncCompleted: state.firstSyncCompleted,
    }
  }

  getConflicts(): SyncConflict[] {
    return this.conflicts
  }

  private emit(event: SyncEvent): void {
    this.onEvent?.(event)
  }

  private setPhase(phase: SyncPhase): void {
    this.phase = phase
    this.emit({ type: 'status', status: this.getStatus() })
  }

  // --------------------------------------------------------------- 触发口

  /**
   * 单飞：同一时刻只跑一次同步。并发触发不会叠加请求，
   * 只记住「还需要再跑一轮」，等当前这轮结束后补上。
   */
  sync(reason: SyncReason): Promise<void> {
    if (this.inFlight) {
      // 手动触发优先级最高，覆盖已排队的自动原因
      if (reason === 'manual' || this.queuedReason !== 'manual') this.queuedReason = reason
      // 返回同一个 promise：等待方拿到的是「包含补跑在内」的完成时刻
      return this.inFlight
    }

    this.queuedReason = reason
    this.inFlight = (async () => {
      // 期间新触发的同步合并成一次补跑，而不是叠加成一串请求
      for (let round = 0; round < 5 && this.queuedReason; round += 1) {
        const next = this.queuedReason
        this.queuedReason = null
        await this.runCycle(next)
      }
      this.queuedReason = null
    })().finally(() => {
      this.inFlight = null
    })

    return this.inFlight
  }

  private async runCycle(reason: SyncReason): Promise<void> {
    if (!this.isOnline() && reason !== 'manual') {
      this.setPhase('offline')
      return
    }

    const state = this.adapter.readState()
    /**
     * 首次登录前不能跑日常同步：新设备的默认配置会把云端已有数据整片覆盖掉。
     * 必须先由用户（或 UI 的自动判定）走 adoptLocal / adoptCloud / adoptMerge。
     */
    if (!state.firstSyncCompleted) {
      this.setPhase('needs-first-sync')
      return
    }
    // 退避窗口内不打扰服务端；用户手动点「立即同步」可以立刻突破
    if (reason !== 'manual' && state.nextRetryAt !== null && state.nextRetryAt > this.now()) return
    if (this.phase === 'paused' && reason !== 'manual') return

    this.setPhase('syncing')
    try {
      await this.replayJournal()
      await this.pushPending()
      await this.pullLoop()

      this.commitSuccess()
    } catch (error) {
      this.commitFailure(error)
    }
  }

  // ------------------------------------------------------------------ push

  /**
   * 每轮都重新投影再对账。用户完全可能在请求在途时又改了一次配置，
   * 那笔改动必须在本周期内被追上并推走——否则紧随其后的 pull
   * 会用服务端的旧值把它盖掉，表现为「改了一下又自己弹回去」。
   */
  private async pushPending(): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
      const projection = await this.adapter.project()
      const state = this.adapter.readState()
      const reconciled = reconcileProjection(projection, state)

      if (reconciled.added.length) {
        this.adapter.writeState({ ...state, outbox: reconciled.outbox })
      } else if (!state.outbox.length) {
        return
      }

      await this.pushOutbox(projection)
    }
  }

  private async pushOutbox(projection: LocalProjection): Promise<void> {
    let state = this.adapter.readState()

    while (state.outbox.length) {
      const batch = state.outbox.slice(0, SYNC_LIMITS.maxMutationsPerPush)
      const { mutations, dropped } = materializeBatch(batch, projection)

      if (!mutations.length) {
        // 整批都作废（例如 Secret 已被改掉）：丢掉它们，等下一轮对账重建
        state = { ...state, outbox: state.outbox.slice(batch.length) }
        this.adapter.writeState(state)
        continue
      }

      const response = await this.transport.push(mutations)
      state = this.applyPushResponse(state, batch, dropped, response)
      this.adapter.writeState(state)
    }
  }

  /**
   * 关键不变量：shadow 前进到「这笔 mutation 代表的指纹」，
   * 而不是用户此刻可能已经又改过的最新状态。否则 push 在途时的编辑会被静默吞掉。
   */
  private applyPushResponse(
    state: LocalSyncState,
    batch: OutboxEntry[],
    dropped: OutboxEntry[],
    response: SyncPushResponse,
  ): LocalSyncState {
    const byMutationId = new Map(batch.map((entry) => [entry.mutationId, entry]))
    const settled = new Set(dropped.map((entry) => entry.mutationId))
    const shadow = { ...state.shadow }

    for (const result of response.results) {
      const entry = byMutationId.get(result.mutationId)
      if (!entry) continue
      settled.add(result.mutationId)

      if (result.status === 'conflict') continue

      const key = entityKey(entry.entityType, entry.entityId)
      shadow[key] = {
        revision: result.revision ?? state.shadow[key]?.revision ?? 0,
        fingerprint: entry.fingerprint,
        deleted: entry.operation === 'delete',
      }
    }

    if (response.conflicts.length) {
      this.conflicts = [...this.conflicts, ...response.conflicts]
      this.emit({ type: 'conflicts', conflicts: response.conflicts })
    }

    return {
      ...state,
      shadow,
      outbox: state.outbox.filter((entry) => !settled.has(entry.mutationId)),
    }
  }

  // ------------------------------------------------------------------ pull

  private async pullLoop(): Promise<void> {
    for (let page = 0; page < 200; page += 1) {
      const state = this.adapter.readState()
      const response = await this.transport.pull(state.cursor)

      if (response.records.length) {
        await this.applyRecords(response.records, response.cursor)
      } else if (response.cursor !== state.cursor) {
        this.adapter.writeState({ ...this.adapter.readState(), cursor: response.cursor })
      }

      if (!response.hasMore) return
    }
  }

  /**
   * 落 journal → 应用 → 推进 shadow/cursor → 存状态 → 清 journal。
   * 中间任意一步崩溃，冷启动都能靠 journal 把这批记录重放一遍。
   */
  private async applyRecords(records: SyncRecord[], targetCursor: number): Promise<void> {
    const pendingKeys = new Set(
      this.adapter.readState().outbox.map((entry) => entityKey(entry.entityType, entry.entityId)),
    )
    // 还没推上去的本地改动优先：它的 mutation 仍在 Outbox 里，不能被服务端旧值覆盖
    const applicable = pendingKeys.size
      ? records.filter((record) => !pendingKeys.has(entityKey(record.entityType, record.entityId)))
      : records

    this.adapter.writeApplyJournal({ records: applicable, targetCursor, startedAt: this.now() })
    await this.adapter.applyRemote(applicable)

    const state = this.adapter.readState()
    this.adapter.writeState({
      ...state,
      shadow: advanceShadow(state.shadow, applicable),
      cursor: Math.max(state.cursor, targetCursor),
    })
    this.adapter.clearApplyJournal()

    this.emit({ type: 'applied', records: applicable.length })
  }

  private async replayJournal(): Promise<void> {
    const journal = this.adapter.readApplyJournal()
    if (!journal) return

    log.sync.info('replaying interrupted apply journal', { records: journal.records.length })
    await this.applyRecords(journal.records, journal.targetCursor)
  }

  // --------------------------------------------------------- 成功 / 失败

  private commitSuccess(): void {
    const state = this.adapter.readState()
    this.adapter.writeState({ ...state, retryAttempt: 0, nextRetryAt: null })
    this.lastSyncedAt = this.now()
    this.lastError = null
    this.setPhase('idle')
  }

  private commitFailure(error: unknown): void {
    const transportError =
      error instanceof SyncTransportError
        ? error
        : new SyncTransportError({
            code: 'NETWORK_ERROR',
            message: error instanceof Error ? error.message : 'Sync failed',
          })

    this.lastError = {
      code: transportError.code,
      message: transportError.message,
      requestId: transportError.requestId,
    }

    const state = this.adapter.readState()
    const attempt = state.retryAttempt + 1

    if (transportError.code === 'DEVICE_IN_USE') {
      // 同机换账号：旧 deviceId 还挂在别的用户上。换新 id 立刻再试，不打扰用户。
      this.adapter.writeState({
        ...state,
        deviceId: randomUuid(),
        retryAttempt: 0,
        nextRetryAt: this.now(),
      })
      this.setPhase('error')
      log.sync.info('device id owned by another account; rotated and retrying')
    } else if (transportError.fatal) {
      // 需要用户重新登录或处理设备撤销：停掉自动重试，避免无谓地打服务端
      this.adapter.writeState({ ...state, retryAttempt: 0, nextRetryAt: null })
      this.setPhase('paused')
    } else if (!this.isOnline()) {
      this.adapter.writeState({ ...state, retryAttempt: attempt, nextRetryAt: null })
      this.setPhase('offline')
    } else {
      const delay = transportError.retryAfterMs ?? this.backoffDelay(attempt)
      this.adapter.writeState({ ...state, retryAttempt: attempt, nextRetryAt: this.now() + delay })
      this.setPhase('error')
    }

    log.sync.warn('sync cycle failed', {
      code: transportError.code,
      requestId: transportError.requestId,
      attempt,
    })
    this.emit({
      type: 'failed',
      code: transportError.code,
      requestId: transportError.requestId,
      attempt,
    })
  }

  /** 1s、2s、4s…封顶 5 分钟，附 ±25% 抖动，避免多设备同时回来时把服务端打穿 */
  backoffDelay(attempt: number): number {
    const exponential = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.max(0, attempt - 1))
    const jitter = exponential * JITTER_RATIO * (this.random() * 2 - 1)
    return Math.max(BASE_RETRY_MS, Math.round(exponential + jitter))
  }

  /** 重新登录后调用：解除暂停并立刻重试 */
  resume(): Promise<void> {
    if (this.phase === 'paused') this.phase = 'idle'
    const state = this.adapter.readState()
    this.adapter.writeState({ ...state, retryAttempt: 0, nextRetryAt: null })
    return this.sync('manual')
  }

  // ------------------------------------------------------- 首次数据决策

  bootstrapSummary(): ReturnType<SyncTransport['bootstrap']> {
    return this.transport.bootstrap()
  }

  /** 「使用本机」：把本机快照确立为云端新基线，云端多出来的对象留 tombstone */
  async adoptLocal(): Promise<void> {
    const projection = await this.adapter.project()
    const entities: BootstrapEntity[] = Object.values(projection).map((entity) => ({
      entityType: entity.entityType,
      entityId: entity.entityId,
      payload: entity.payload,
    }))

    const result = await this.transport.bootstrapReplace(entities)

    const shadow: LocalSyncState['shadow'] = {}
    const state = this.adapter.readState()
    this.adapter.writeState({
      ...state,
      shadow,
      outbox: [],
      cursor: 0,
      firstSyncCompleted: true,
    })

    // 从 0 重新拉一遍：服务端分配的 revision 才是 shadow 的权威来源
    await this.pullLoop()
    log.sync.info('adopted local baseline', { currentRevision: result.currentRevision })
    this.finishFirstSync()
  }

  /** 「使用云端」：丢掉本机配置差异，整包换成云端状态 */
  async adoptCloud(): Promise<void> {
    const state = this.adapter.readState()
    this.adapter.writeState({ ...state, shadow: {}, outbox: [], cursor: 0 })

    const collected: SyncRecord[] = []
    let cursor = 0
    for (let page = 0; page < 200; page += 1) {
      const response = await this.transport.pull(cursor)
      collected.push(...response.records)
      cursor = response.cursor
      if (!response.hasMore) break
    }

    this.adapter.writeApplyJournal({ records: collected, targetCursor: cursor, startedAt: this.now() })
    await this.adapter.applyRemote(collected, { replace: true })

    const after = this.adapter.readState()
    this.adapter.writeState({
      ...after,
      shadow: advanceShadow({}, collected),
      cursor,
      firstSyncCompleted: true,
    })
    this.adapter.clearApplyJournal()
    this.finishFirstSync()
  }

  /** 「合并」：两边都保留，只有结构性分歧才升级成冲突交给用户 */
  async adoptMerge(): Promise<void> {
    const state = this.adapter.readState()
    this.adapter.writeState({ ...state, firstSyncCompleted: true })
    await this.sync('manual')
    this.finishFirstSync()
  }

  private finishFirstSync(): void {
    this.lastSyncedAt = this.now()
    this.emit({ type: 'first-sync-complete' })
    this.setPhase('idle')
  }

  // ----------------------------------------------------------------- 冲突

  async refreshConflicts(): Promise<SyncConflict[]> {
    this.conflicts = await this.transport.listConflicts()
    this.emit({ type: 'conflicts', conflicts: this.conflicts })
    return this.conflicts
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'accept_local' | 'accept_server',
  ): Promise<void> {
    await this.resolveConflicts([{ id: conflictId, resolution }])
  }

  /**
   * 批量裁决：按协议上限分块，每块一次 HTTP；整批结束后只跑一轮同步。
   * 中途失败会停下并抛错；已裁决的部分不回退，剩余的留在队列里可重试。
   */
  async resolveConflicts(
    decisions: ReadonlyArray<{ id: string; resolution: 'accept_local' | 'accept_server' }>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    if (!decisions.length) return
    const total = decisions.length
    const chunkSize = SYNC_LIMITS.maxConflictResolutionsPerRequest
    try {
      let done = 0
      for (let offset = 0; offset < decisions.length; offset += chunkSize) {
        const chunk = decisions.slice(offset, offset + chunkSize)
        await this.transport.resolveConflicts(
          chunk.map(({ id, resolution }) => ({ conflictId: id, resolution })),
        )
        const resolvedIds = new Set(chunk.map((item) => item.id))
        this.conflicts = this.conflicts.filter((conflict) => !resolvedIds.has(conflict.id))
        done += chunk.length
        onProgress?.(done, total)
      }
    } finally {
      this.emit({ type: 'conflicts', conflicts: this.conflicts })
    }
    await this.sync('manual')
  }

  /** 登出：清掉同步进度，但绝不动本机订阅与配置 */
  reset(): void {
    this.conflicts = []
    this.lastError = null
    this.lastSyncedAt = null
    this.adapter.clearApplyJournal()
    const state = this.adapter.readState()
    this.adapter.writeState({
      ...state,
      cursor: 0,
      shadow: {},
      outbox: [],
      firstSyncCompleted: false,
      retryAttempt: 0,
      nextRetryAt: null,
    })
    this.setPhase('idle')
  }
}

/**
 * 应用完远端记录后把 shadow 对齐到服务端内容。
 * 少了这一步，下一轮对账会把刚收到的数据当成本地新改动再推回去（回声）。
 */
export function advanceShadow(
  shadow: LocalSyncState['shadow'],
  records: SyncRecord[],
): LocalSyncState['shadow'] {
  const next = { ...shadow }
  for (const record of records) {
    next[entityKey(record.entityType, record.entityId)] = {
      revision: record.revision,
      fingerprint: record.deleted ? DELETED_FINGERPRINT : fingerprintOf(record.payload),
      deleted: record.deleted,
    }
  }
  return next
}
