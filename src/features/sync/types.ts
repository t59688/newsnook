/**
 * 客户端同步的稳定边界类型。
 *
 * 这里只 `import type` 协议定义，运行时不引入 zod：App 包体里不该出现服务端校验代码。
 */

import type {
  SyncEntityType,
  SyncMutation,
  SyncRecord,
} from '@newsnook/contracts'

/** `${entityType}:${entityId}`，投影、shadow 与 outbox 共用同一套键 */
export type SyncEntityKey = string

export function entityKey(entityType: SyncEntityType, entityId: string): SyncEntityKey {
  return `${entityType}:${entityId}`
}

export function parseEntityKey(key: SyncEntityKey): {
  entityType: SyncEntityType
  entityId: string
} {
  const separator = key.indexOf(':')
  return {
    entityType: key.slice(0, separator) as SyncEntityType,
    entityId: key.slice(separator + 1),
  }
}

export interface ProjectedEntity {
  entityType: SyncEntityType
  entityId: string
  payload: unknown
  /** 变更检测用的内容指纹；Secret 只保留 SHA-256，明文不进任何持久化结构 */
  fingerprint: string
}

/** 本机当前配置在同步协议下的完整投影 */
export type LocalProjection = Record<SyncEntityKey, ProjectedEntity>

export interface ShadowEntry {
  /** 服务端确认这份内容时的 revision */
  revision: number
  fingerprint: string
  deleted: boolean
}

/**
 * outbox 条目在 mutation 之外多记一个 fingerprint：
 * 服务端 ack 后 shadow 前进到「这笔 mutation 代表的那份内容」，
 * 而不是盲目跟到用户此刻可能已经又改过的最新状态。
 */
export interface OutboxEntry extends SyncMutation {
  fingerprint: string
}

/**
 * 服务端已经就这个实体开出冲突、还没裁决。
 *
 * 有它在，对账就不再为这个实体生成新的 mutation：否则同一轮同步里
 * 「投影 → push → 冲突 → 丢掉 mutation → 再投影」会原地打转，
 * 每轮换一个 mutationId 再推一次，把一处分歧刷成成排的冲突。
 */
export interface ConflictMarker {
  conflictId: string
  /**
   * 记下冲突发生那一刻 shadow 里这个实体的 revision。
   * shadow 越过它就说明服务端那一版已经拉下来应用过，分歧消化完，占用可以解除。
   * 用「严格大于」而不是服务端上报的 revision：后者在实体尚未建立时是 0，
   * 拿它比较会让标记刚写下就被清掉。
   */
  shadowRevision: number
}

export interface LocalSyncState {
  deviceId: string
  /** 已完整应用到本机的服务端 revision */
  cursor: number
  shadow: Record<SyncEntityKey, ShadowEntry>
  outbox: OutboxEntry[]
  /** 待裁决冲突占住的实体；键与 shadow / 投影同构 */
  conflicted: Record<SyncEntityKey, ConflictMarker>
  /** 首次登录的数据归属选择是否已经做过 */
  firstSyncCompleted: boolean
  retryAttempt: number
  nextRetryAt: number | null
}

/**
 * 应用远端记录前先落盘的日志：应用到一半崩溃时，下次冷启动照着它重放，
 * 避免 cursor 已经前进但记录没落地造成的永久性数据缺口。
 */
export interface SyncApplyJournal {
  records: SyncRecord[]
  targetCursor: number
  startedAt: number
}

/** delete mutation 的哨兵指纹：ack 后 shadow 记为 deleted */
export const DELETED_FINGERPRINT = 'deleted'
