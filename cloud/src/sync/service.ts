/**
 * 同步服务：同一用户的 push 由 `sync_heads ... FOR UPDATE` 串行，
 * 实体写入、幂等记录、冲突创建与 head 推进都在同一个 PostgreSQL 事务里提交。
 *
 * 业务上允许一批 mutation 里部分接受、部分冲突；数据库层仍然是一次原子提交。
 */

import { randomUUID } from 'node:crypto'

import type { Pool, PoolClient } from 'pg'

import {
  SYNC_PROTOCOL_VERSION,
  syncPayloadSchemaByEntityType,
  type BootstrapEntity,
  type DeviceContext,
  type DeviceSummary,
  type SyncBootstrapReplaceResponse,
  type SyncBootstrapResponse,
  type SyncConflict,
  type SyncConflictResolution,
  type SyncEntityType,
  type SyncMutation,
  type SyncMutationResult,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@newsnook/contracts'

import type { SecretCipher } from '../crypto/secrets.js'
import { ApiError, deviceInUse, deviceRevoked, notFound, validationFailed } from '../errors.js'
import { classifyMutation, conflictSnapshot } from './conflicts.js'
import * as repo from './repository.js'

export interface SyncServiceOptions {
  pool: Pool
  cipher: SecretCipher
}

/** 每次 push 落一条结构化摘要日志；这里没有任何 payload / Secret / token */
export interface PushLogSummary {
  userId: string
  deviceId: string
  mutationCount: number
  acceptedCount: number
  conflictCount: number
  noopCount: number
  replayedCount: number
  fromRevision: number
  toRevision: number
}

export class SyncService {
  private readonly pool: Pool
  private readonly cipher: SecretCipher

  constructor(options: SyncServiceOptions) {
    this.pool = options.pool
    this.cipher = options.cipher
  }

  private async withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw error
    } finally {
      client.release()
    }
  }

  private async withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      return await run(client)
    } finally {
      client.release()
    }
  }

  /**
   * 每次同步调用都刷新设备记录并把当前会话绑到这台设备上。
   *
   * 三道闸：设备 id 已属于别的用户直接拒绝（防止猜 deviceId 蹭进别人的同步流）；
   * 设备本身被撤销拒绝；**这个会话曾经绑在已撤销的设备上**也拒绝——
   * 否则撤销只挡住 deviceId 这一层，换个新 id 就能用同一个 token 绕过去。
   */
  async ensureDevice(
    userId: string,
    context: DeviceContext,
    sessionId: string | null = null,
  ): Promise<void> {
    await this.withTransaction(async (client) => {
      if (sessionId && (await repo.sessionBelongsToRevokedDevice(client, userId, sessionId))) {
        throw deviceRevoked()
      }

      const existing = await repo.findDevice(client, context.deviceId)
      if (existing && existing.user_id !== userId) {
        throw deviceInUse()
      }
      if (existing?.revoked_at) throw deviceRevoked()
      await repo.touchDevice(client, {
        deviceId: context.deviceId,
        userId,
        name: context.deviceName,
        platform: context.platform,
        appVersion: context.appVersion,
      })
      if (sessionId) {
        await repo.bindDeviceSession(client, { userId, deviceId: context.deviceId, sessionId })
      }
    })
  }

  async listDevices(userId: string, currentDeviceId: string | null): Promise<DeviceSummary[]> {
    const rows = await this.withClient((client) => repo.listDevices(client, userId))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      platform: (row.platform as DeviceSummary['platform']) ?? 'unknown',
      appVersion: row.app_version,
      createdAt: row.created_at.getTime(),
      lastSeenAt: row.last_seen_at.getTime(),
      revokedAt: row.revoked_at ? row.revoked_at.getTime() : null,
      current: row.id === currentDeviceId,
    }))
  }

  /**
   * 撤销切断该设备后续访问，但不删除它上传过的任何数据。
   *
   * 除了打 `revoked_at`，还要作废那台设备手里的登录会话——只标记设备的话，
   * 它换一个 deviceId 重新登记就能继续同步，撤销形同虚设。
   * 发起撤销的那个会话保留：从「设备列表」撤掉本机不应该顺手把自己踢下线，
   * 它后续的同步请求仍会被上面两道闸拦住。
   */
  async revokeDevice(
    userId: string,
    deviceId: string,
    currentSessionId: string | null = null,
  ): Promise<{ revokedSessions: number }> {
    return this.withTransaction(async (client) => {
      const revoked = await repo.revokeDevice(client, userId, deviceId)
      if (!revoked) throw notFound('Device not found or already revoked')
      const revokedSessions = await repo.deleteDeviceSessions(client, {
        userId,
        deviceId,
        keepSessionId: currentSessionId,
      })
      return { revokedSessions }
    })
  }

  async bootstrap(userId: string): Promise<SyncBootstrapResponse> {
    return this.withClient(async (client) => {
      const [summary, currentRevision] = await Promise.all([
        repo.summarize(client, userId),
        repo.readHead(client, userId),
      ])
      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        currentRevision,
        counts: summary.counts,
        secretKeys: summary.secretKeys,
        lastUpdatedAt: summary.lastUpdatedAt,
      }
    })
  }

  async pull(userId: string, since: number, limit: number): Promise<SyncPullResponse> {
    return this.withClient(async (client) => {
      const currentRevision = await repo.readHead(client, userId)
      const fetched = await repo.pullRecords(client, {
        userId,
        since,
        limit: limit + 1,
        cipher: this.cipher,
      })

      const hasMore = fetched.length > limit
      const records = hasMore ? fetched.slice(0, limit) : fetched

      // 非末页只能推进到本页最后一条 revision，否则中间的记录会被永久跳过
      const cursor = hasMore
        ? (records[records.length - 1]?.revision ?? since)
        : Math.max(since, currentRevision)

      return { records, cursor, currentRevision, hasMore }
    })
  }

  async push(
    userId: string,
    request: SyncPushRequest,
  ): Promise<{ response: SyncPushResponse; summary: PushLogSummary }> {
    return this.withTransaction(async (client) => {
      const fromRevision = await repo.lockHead(client, userId)
      let revision = fromRevision

      const results: SyncMutationResult[] = []
      // 按 id 收敛：一批里对同一实体的多笔陈旧 mutation 复用同一条冲突
      const conflictsById = new Map<string, SyncConflict>()
      let acceptedCount = 0
      let conflictCount = 0
      let noopCount = 0
      let replayedCount = 0

      for (const mutation of request.mutations) {
        const replayed = await repo.findMutationResult(client, userId, mutation.mutationId)
        if (replayed) {
          results.push(replayed)
          replayedCount += 1
          continue
        }

        const existing = await repo.loadEntityState(client, {
          userId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
        })
        const decision = classifyMutation(mutation, existing)

        if (decision.kind === 'noop') {
          const result: SyncMutationResult = {
            mutationId: mutation.mutationId,
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            status: 'noop',
            revision: existing?.revision ?? null,
            conflictId: null,
          }
          results.push(result)
          noopCount += 1
          await repo.recordMutationResult(client, {
            userId,
            mutationId: mutation.mutationId,
            deviceId: request.deviceId,
            result,
          })
          continue
        }

        if (decision.kind === 'conflict') {
          const serverState = conflictSnapshot(mutation.entityType, existing?.payload ?? null)

          const details = {
            reason: decision.reason,
            serverRevision: existing?.revision ?? 0,
            baseRevision: mutation.baseRevision,
            localChange: {
              operation: mutation.operation,
              payload: conflictSnapshot(mutation.entityType, mutation.payload),
            },
            serverState: { deleted: existing?.deleted ?? false, payload: serverState },
          }

          /**
           * 同一实体已经有一条待裁决冲突时刷新它，不再插新行。
           * 客户端重试或多轮 push 推同一份分歧，用户也只该看到一条。
           */
          const open = await repo.findOpenConflictForEntity(client, {
            userId,
            entityType: mutation.entityType,
            entityId: mutation.entityId,
          })
          const conflict = open
            ? await repo.refreshConflict(client, { id: open.id, userId, ...details })
            : await repo.insertConflict(client, {
                id: randomUUID(),
                userId,
                entityType: mutation.entityType,
                entityId: mutation.entityId,
                ...details,
              })

          const result: SyncMutationResult = {
            mutationId: mutation.mutationId,
            entityType: mutation.entityType,
            entityId: mutation.entityId,
            status: 'conflict',
            revision: existing?.revision ?? null,
            conflictId: conflict.id,
          }
          results.push(result)
          conflictsById.set(conflict.id, conflict)
          conflictCount += 1
          await repo.recordMutationResult(client, {
            userId,
            mutationId: mutation.mutationId,
            deviceId: request.deviceId,
            result,
          })
          continue
        }

        revision += 1
        await this.applyMutation(client, userId, mutation, revision)

        const result: SyncMutationResult = {
          mutationId: mutation.mutationId,
          entityType: mutation.entityType,
          entityId: mutation.entityId,
          status: 'accepted',
          revision,
          conflictId: null,
        }
        results.push(result)
        acceptedCount += 1
        await repo.recordMutationResult(client, {
          userId,
          mutationId: mutation.mutationId,
          deviceId: request.deviceId,
          result,
        })
      }

      if (revision !== fromRevision) await repo.writeHead(client, userId, revision)

      return {
        response: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          results,
          conflicts: [...conflictsById.values()],
          currentRevision: revision,
        },
        summary: {
          userId,
          deviceId: request.deviceId,
          mutationCount: request.mutations.length,
          acceptedCount,
          conflictCount,
          noopCount,
          replayedCount,
          fromRevision,
          toRevision: revision,
        },
      }
    })
  }

  private async applyMutation(
    client: PoolClient,
    userId: string,
    mutation: SyncMutation,
    revision: number,
  ): Promise<void> {
    if (mutation.operation === 'delete') {
      await repo.tombstoneEntity(client, {
        userId,
        entityType: mutation.entityType,
        entityId: mutation.entityId,
        revision,
      })
      return
    }

    await repo.upsertEntity(client, {
      userId,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      revision,
      payload: parsePayload(mutation.entityType, mutation.payload),
      cipher: this.cipher,
    })
  }

  /**
   * 「使用本机数据」：把客户端快照确立为新的云端基线。
   * 不是 DELETE all + INSERT all —— 旧对象要留 tombstone，
   * 否则其它离线设备永远不知道它们已经不在了。
   */
  async bootstrapReplace(
    userId: string,
    deviceId: string,
    entities: BootstrapEntity[],
  ): Promise<SyncBootstrapReplaceResponse> {
    return this.withTransaction(async (client) => {
      let revision = await repo.lockHead(client, userId)

      const submitted = new Set(entities.map((entity) => `${entity.entityType}:${entity.entityId}`))
      const live = await repo.listLiveEntityIds(client, userId)

      let tombstoned = 0
      for (const entry of live) {
        if (submitted.has(`${entry.entityType}:${entry.entityId}`)) continue
        revision += 1
        await repo.tombstoneEntity(client, {
          userId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          revision,
        })
        tombstoned += 1
      }

      let written = 0
      for (const entity of entities) {
        revision += 1
        await repo.upsertEntity(client, {
          userId,
          entityType: entity.entityType,
          entityId: entity.entityId,
          revision,
          payload: parsePayload(entity.entityType, entity.payload),
          cipher: this.cipher,
        })
        written += 1
      }

      await repo.writeHead(client, userId, revision)
      await repo.touchDevice(client, { deviceId, userId })

      return {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        currentRevision: revision,
        written,
        tombstoned,
      }
    })
  }

  async listConflicts(userId: string): Promise<SyncConflict[]> {
    return this.withClient((client) => repo.listOpenConflicts(client, userId))
  }

  /**
   * `accept_server` 只是把冲突标记为已处理；
   * `accept_local` 把本地那笔改动重新落到云端，因此会分配新 revision。
   */
  async resolveConflict(
    userId: string,
    conflictId: string,
    resolution: SyncConflictResolution,
    deviceId: string,
  ): Promise<{ resolved: boolean; currentRevision: number }> {
    const result = await this.resolveConflicts(userId, [{ conflictId, resolution }], deviceId)
    return { resolved: result.resolved > 0, currentRevision: result.currentRevision }
  }

  /**
   * 批量裁决：同一事务里处理多条冲突，只占一次 HTTP / 一次 rate-limit 配额。
   * 「全部应用」必须走这条路径，不能对每条冲突各打一次 /resolve。
   */
  async resolveConflicts(
    userId: string,
    decisions: ReadonlyArray<{ conflictId: string; resolution: SyncConflictResolution }>,
    deviceId: string,
  ): Promise<{ resolved: number; currentRevision: number }> {
    if (!decisions.length) {
      return this.withClient(async (client) => ({
        resolved: 0,
        currentRevision: await repo.readHead(client, userId),
      }))
    }

    // 同一 conflictId 出现多次时，以后写覆盖先写（与 UI 最终决定一致）
    const byId = new Map<string, SyncConflictResolution>()
    for (const decision of decisions) {
      byId.set(decision.conflictId, decision.resolution)
    }

    return this.withTransaction(async (client) => {
      let revision = await repo.lockHead(client, userId)
      let resolved = 0

      for (const [conflictId, resolution] of byId) {
        const conflict = await repo.findConflict(client, userId, conflictId)
        if (!conflict) throw notFound('Conflict not found')
        if (conflict.resolvedAt) {
          resolved += 1
          continue
        }

        if (resolution === 'accept_local') {
          const localChange = conflict.localChange as
            | { operation?: 'upsert' | 'delete'; payload?: unknown }
            | null
          if (conflict.entityType === 'secret') {
            throw validationFailed('Secret conflicts must be resolved by re-pushing the value')
          }
          revision += 1
          if (localChange?.operation === 'delete') {
            await repo.tombstoneEntity(client, {
              userId,
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              revision,
            })
          } else {
            await repo.upsertEntity(client, {
              userId,
              entityType: conflict.entityType,
              entityId: conflict.entityId,
              revision,
              payload: parsePayload(conflict.entityType, localChange?.payload),
              cipher: this.cipher,
            })
          }
          await repo.writeHead(client, userId, revision)
        }

        await repo.markConflictResolved(client, userId, conflictId)
        resolved += 1
      }

      await repo.touchDevice(client, { deviceId, userId })
      return { resolved, currentRevision: revision }
    })
  }
}

/** 边界校验：写库前一定过一遍对应实体的 schema */
export function parsePayload(entityType: SyncEntityType, payload: unknown): unknown {
  const schema = syncPayloadSchemaByEntityType[entityType]
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Invalid ${entityType} payload`,
      parsed.error.issues.map((issue) => issue.path.join('.')).join(','),
    )
  }
  return parsed.data
}
