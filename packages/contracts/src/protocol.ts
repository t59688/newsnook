/**
 * 协议常量与纯函数：版本号、批量上限、枚举值与排序键工具。
 *
 * 这个模块刻意不依赖 zod。客户端只需要这些常量，
 * 不该把服务端的校验 schema 一起打进 App 包体。
 */

export const SYNC_PROTOCOL_VERSION = 1 as const

/** 单次 push 的批量上限，服务端与客户端共用同一组常量 */
export const SYNC_LIMITS = {
  maxMutationsPerPush: 200,
  maxPushBodyBytes: 512 * 1024,
  maxPullLimit: 500,
  defaultPullLimit: 500,
  maxEntityIdLength: 200,
  maxStringLength: 4000,
  maxSecretValueLength: 8000,
  maxSourceIdsPerCategory: 500,
  maxEntitiesPerBootstrap: 4000,
  /** 冲突批量裁决上限；「全部应用」应一次请求落地，避免逐条打满 rate limit */
  maxConflictResolutionsPerRequest: 200,
} as const

export const SYNC_ENTITY_TYPES = ['subscription', 'category', 'setting', 'secret'] as const
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number]

export const SYNC_MUTATION_OPERATIONS = ['upsert', 'delete'] as const
export type SyncMutationOperation = (typeof SYNC_MUTATION_OPERATIONS)[number]

export const DEVICE_PLATFORMS = ['web', 'android', 'ios', 'unknown'] as const
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number]

export const SYNC_CONFLICT_REASONS = [
  'delete_vs_update',
  'update_vs_delete',
  'stale_structural_update',
  'category_stale_mutation',
] as const
export type SyncConflictReason = (typeof SYNC_CONFLICT_REASONS)[number]

export const SYNC_CONFLICT_RESOLUTIONS = ['accept_local', 'accept_server'] as const
export type SyncConflictResolution = (typeof SYNC_CONFLICT_RESOLUTIONS)[number]

/**
 * Android 社交登录回流的固定深链目标。服务端只会 302 到这个地址，
 * 客户端也只认这个前缀，避免任何一侧接受外部指定的跳转目标。
 */
export const MOBILE_AUTH_CALLBACK_URL = 'newsnook://auth/callback'

/**
 * 可插入排序键：客户端在两个相邻 rank 之间生成新键，不必批量重写邻居。
 * 采用短字符串（base36 风格），比较用普通字典序。
 */
const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
const RANK_BASE = RANK_DIGITS.length

function digitValue(char: string): number {
  const index = RANK_DIGITS.indexOf(char)
  return index < 0 ? 0 : index
}

export function rankBetween(before: string | null, after: string | null): string {
  const lower = before ?? ''
  const upper = after ?? ''
  let prefix = ''
  let position = 0

  for (;;) {
    const lowDigit = position < lower.length ? digitValue(lower[position]!) : 0
    const highDigit = position < upper.length ? digitValue(upper[position]!) : RANK_BASE
    if (highDigit - lowDigit > 1) {
      const middle = Math.floor((lowDigit + highDigit) / 2)
      return `${prefix}${RANK_DIGITS[middle]}`
    }
    prefix += RANK_DIGITS[lowDigit]
    position += 1
    // 上界与下界在这一位相邻或相等：继续向后一位细分
    if (position > 64) return `${prefix}m`
  }
}

/** 按序号生成初始 rank；同一批次内保持稳定且严格递增 */
export function rankForIndex(index: number): string {
  const normalized = Math.max(0, Math.floor(index)) + 1
  return `${normalized.toString(RANK_BASE).padStart(6, '0')}`
}
