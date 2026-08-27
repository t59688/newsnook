/**
 * 同步协议：结构化记录 + 全局 revision + delta pull + outbox + tombstone。
 *
 * 实体 id 复用 NewsNook 已有的领域 id（内置/自建信源 id、分类 id、设置键、Secret 键），
 * 只有同步专用对象（device / mutation / conflict）才用 UUID。
 */

import { z } from 'zod'

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
} as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const uuidSchema = z.string().regex(UUID_PATTERN, 'must be a UUID')

export const entityIdSchema = z.string().min(1).max(SYNC_LIMITS.maxEntityIdLength)

const shortTextSchema = z.string().max(SYNC_LIMITS.maxStringLength)

export const SYNC_ENTITY_TYPES = ['subscription', 'category', 'setting', 'secret'] as const
export type SyncEntityType = (typeof SYNC_ENTITY_TYPES)[number]
export const syncEntityTypeSchema = z.enum(SYNC_ENTITY_TYPES)

export const SYNC_MUTATION_OPERATIONS = ['upsert', 'delete'] as const
export type SyncMutationOperation = (typeof SYNC_MUTATION_OPERATIONS)[number]
export const syncMutationOperationSchema = z.enum(SYNC_MUTATION_OPERATIONS)

/**
 * 可插入排序键：客户端在两个相邻 rank 之间生成新键，不必批量重写邻居。
 * 采用短字符串（base36 风格），比较用普通字典序。
 */
export const sortRankSchema = z.string().min(1).max(64).regex(/^[0-9a-z:]+$/)

// ---------- 各实体 payload ----------

export const subscriptionPayloadSchema = z.object({
  /** builtin = 注册表内置源，custom = 用户自建/OPML 导入 */
  kind: z.enum(['builtin', 'custom']),
  enabled: z.boolean(),
  sortRank: sortRankSchema,
  name: shortTextSchema.optional(),
  label: shortTextSchema.optional(),
  group: shortTextSchema.optional(),
  /** NewsNook 的 SourceKind（`feed` / 站点定制解析）；协议层不枚举，避免每加一个源就升协议 */
  sourceKind: shortTextSchema.optional(),
  url: shortTextSchema.optional(),
  siteUrl: shortTextSchema.optional(),
  /** 归一化后的 URL，仅用于自建源跨设备去重 */
  normalizedUrl: shortTextSchema.optional(),
  createdAt: z.number().int().nonnegative().optional(),
  frameworkHint: z.unknown().optional(),
})
export type SubscriptionPayload = z.infer<typeof subscriptionPayloadSchema>

export const categoryPayloadSchema = z.object({
  kind: z.enum(['builtin', 'custom']),
  visible: z.boolean(),
  sortRank: sortRankSchema,
  /** null = 沿用注册表默认信源；数组 = 用户显式覆盖 */
  sourceIds: z.array(entityIdSchema).max(SYNC_LIMITS.maxSourceIdsPerCategory).nullable(),
  label: shortTextSchema.optional(),
  short: shortTextSchema.optional(),
})
export type CategoryPayload = z.infer<typeof categoryPayloadSchema>

/** 跨设备普通设置：值本身是任意 JSON，语义由客户端 projection 决定 */
export const settingPayloadSchema = z.object({
  value: z.unknown(),
})
export type SettingPayload = z.infer<typeof settingPayloadSchema>

/** Secret 明文只在 HTTPS 传输中出现；服务端立即 AES-256-GCM 加密后落库 */
export const secretPayloadSchema = z.object({
  value: z.string().max(SYNC_LIMITS.maxSecretValueLength),
})
export type SecretPayload = z.infer<typeof secretPayloadSchema>

export const syncPayloadSchemaByEntityType = {
  subscription: subscriptionPayloadSchema,
  category: categoryPayloadSchema,
  setting: settingPayloadSchema,
  secret: secretPayloadSchema,
} as const

// ---------- mutation / record ----------

export const syncMutationSchema = z.object({
  mutationId: uuidSchema,
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  operation: syncMutationOperationSchema,
  /** 客户端最后一次确认过的服务端 revision；null = 本地新建，从未同步过 */
  baseRevision: z.number().int().nonnegative().nullable(),
  payload: z.unknown(),
})
export type SyncMutation = z.infer<typeof syncMutationSchema>

export const syncRecordSchema = z.object({
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  revision: z.number().int().nonnegative(),
  deleted: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
  payload: z.unknown(),
})
export type SyncRecord = z.infer<typeof syncRecordSchema>

// ---------- device ----------

export const DEVICE_PLATFORMS = ['web', 'android', 'ios', 'unknown'] as const
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number]
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS)

export const deviceContextSchema = z.object({
  deviceId: uuidSchema,
  deviceName: z.string().max(120).optional(),
  platform: devicePlatformSchema.optional(),
  appVersion: z.string().max(40).optional(),
})
export type DeviceContext = z.infer<typeof deviceContextSchema>

export const deviceSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  platform: devicePlatformSchema,
  appVersion: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().nullable(),
  current: z.boolean(),
})
export type DeviceSummary = z.infer<typeof deviceSummarySchema>

export const deviceListResponseSchema = z.object({
  devices: z.array(deviceSummarySchema),
})
export type DeviceListResponse = z.infer<typeof deviceListResponseSchema>

// ---------- push ----------

export const syncPushRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  deviceId: uuidSchema,
  deviceName: z.string().max(120).optional(),
  platform: devicePlatformSchema.optional(),
  appVersion: z.string().max(40).optional(),
  mutations: z.array(syncMutationSchema).max(SYNC_LIMITS.maxMutationsPerPush),
})
export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>

export const SYNC_CONFLICT_REASONS = [
  'delete_vs_update',
  'update_vs_delete',
  'stale_structural_update',
  'category_stale_mutation',
] as const
export type SyncConflictReason = (typeof SYNC_CONFLICT_REASONS)[number]
export const syncConflictReasonSchema = z.enum(SYNC_CONFLICT_REASONS)

export const syncConflictSchema = z.object({
  id: uuidSchema,
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  reason: syncConflictReasonSchema,
  serverRevision: z.number().int().nonnegative(),
  baseRevision: z.number().int().nonnegative().nullable(),
  /** Secret 的值永远不进冲突快照，只留键名 */
  localChange: z.unknown(),
  serverState: z.unknown(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable(),
})
export type SyncConflict = z.infer<typeof syncConflictSchema>

export const syncMutationResultSchema = z.object({
  mutationId: uuidSchema,
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  status: z.enum(['accepted', 'conflict', 'noop']),
  revision: z.number().int().nonnegative().nullable(),
  conflictId: uuidSchema.nullable(),
})
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>

export const syncPushResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  results: z.array(syncMutationResultSchema),
  conflicts: z.array(syncConflictSchema),
  currentRevision: z.number().int().nonnegative(),
})
export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>

// ---------- pull ----------

export const syncPullQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_LIMITS.maxPullLimit).default(SYNC_LIMITS.defaultPullLimit),
})
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>

export const syncPullResponseSchema = z.object({
  records: z.array(syncRecordSchema),
  /** 完整应用这批 records 之后客户端应保存的 cursor */
  cursor: z.number().int().nonnegative(),
  currentRevision: z.number().int().nonnegative(),
  hasMore: z.boolean(),
})
export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>

// ---------- bootstrap ----------

export const syncBootstrapResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  currentRevision: z.number().int().nonnegative(),
  /** 首次登录数据决策用：只给计数，不给 Secret 值 */
  counts: z.object({
    subscriptions: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    settings: z.number().int().nonnegative(),
    secrets: z.number().int().nonnegative(),
  }),
  secretKeys: z.array(entityIdSchema),
  lastUpdatedAt: z.number().int().nonnegative().nullable(),
})
export type SyncBootstrapResponse = z.infer<typeof syncBootstrapResponseSchema>

export const bootstrapEntitySchema = z.object({
  entityType: syncEntityTypeSchema,
  entityId: entityIdSchema,
  payload: z.unknown(),
})
export type BootstrapEntity = z.infer<typeof bootstrapEntitySchema>

export const syncBootstrapReplaceRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  deviceId: uuidSchema,
  entities: z.array(bootstrapEntitySchema).max(SYNC_LIMITS.maxEntitiesPerBootstrap),
})
export type SyncBootstrapReplaceRequest = z.infer<typeof syncBootstrapReplaceRequestSchema>

export const syncBootstrapReplaceResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  currentRevision: z.number().int().nonnegative(),
  written: z.number().int().nonnegative(),
  tombstoned: z.number().int().nonnegative(),
})
export type SyncBootstrapReplaceResponse = z.infer<typeof syncBootstrapReplaceResponseSchema>

// ---------- conflicts ----------

export const syncConflictListResponseSchema = z.object({
  conflicts: z.array(syncConflictSchema),
})
export type SyncConflictListResponse = z.infer<typeof syncConflictListResponseSchema>

export const syncConflictResolutionSchema = z.enum(['accept_local', 'accept_server'])
export type SyncConflictResolution = z.infer<typeof syncConflictResolutionSchema>

export const syncConflictResolveRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  deviceId: uuidSchema,
  resolution: syncConflictResolutionSchema,
})
export type SyncConflictResolveRequest = z.infer<typeof syncConflictResolveRequestSchema>

export const syncConflictResolveResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  resolved: z.boolean(),
  currentRevision: z.number().int().nonnegative(),
})
export type SyncConflictResolveResponse = z.infer<typeof syncConflictResolveResponseSchema>

/**
 * 排序键工具：在 `before` 与 `after` 之间生成一个字典序落在中间的键。
 * 只做 V1 需要的最小实现（等分 base36 位），不引入重型 fractional-index 依赖。
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
