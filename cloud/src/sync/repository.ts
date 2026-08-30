/**
 * 同步域的数据访问：四张实体表 + head + 幂等表 + 冲突表。
 * 所有函数都接受一个 `PoolClient`，由 service 层统一放进同一个事务。
 */

import type { PoolClient } from 'pg'

import type {
  SyncConflict,
  SyncConflictReason,
  SyncEntityType,
  SyncMutationResult,
  SyncRecord,
} from '@newsnook/contracts'

import type { SecretCipher } from '../crypto/secrets.js'
import { SecretDecryptionError } from '../crypto/secrets.js'
import type { ExistingEntityState } from './conflicts.js'

export const ENTITY_TABLES: Record<SyncEntityType, string> = {
  subscription: 'subscriptions',
  category: 'categories',
  setting: 'user_settings',
  secret: 'user_secrets',
}

export interface EntityStateRow extends ExistingEntityState {
  entityType: SyncEntityType
  entityId: string
  payload: unknown
}

interface RawEntityRow {
  entity_id: string
  revision: string | number
  deleted_at: Date | null
  updated_at: Date
  payload?: unknown
  ciphertext?: Buffer | null
  nonce?: Buffer | null
  key_version?: number | null
}

function toNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value)
}

// ------------------------------------------------------------------- head

export async function lockHead(client: PoolClient, userId: string): Promise<number> {
  await client.query(
    'INSERT INTO sync_heads (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
    [userId],
  )
  const { rows } = await client.query<{ current_revision: string }>(
    'SELECT current_revision FROM sync_heads WHERE user_id = $1 FOR UPDATE',
    [userId],
  )
  return toNumber(rows[0]?.current_revision ?? 0)
}

export async function readHead(client: PoolClient, userId: string): Promise<number> {
  const { rows } = await client.query<{ current_revision: string }>(
    'SELECT current_revision FROM sync_heads WHERE user_id = $1',
    [userId],
  )
  return toNumber(rows[0]?.current_revision ?? 0)
}

export async function writeHead(
  client: PoolClient,
  userId: string,
  revision: number,
): Promise<void> {
  await client.query(
    `INSERT INTO sync_heads (user_id, current_revision, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE SET current_revision = EXCLUDED.current_revision, updated_at = now()`,
    [userId, revision],
  )
}

// ------------------------------------------------------------- idempotency

export async function findMutationResult(
  client: PoolClient,
  userId: string,
  mutationId: string,
): Promise<SyncMutationResult | null> {
  const { rows } = await client.query<{ result: SyncMutationResult }>(
    'SELECT result FROM sync_mutations WHERE user_id = $1 AND mutation_id = $2',
    [userId, mutationId],
  )
  return rows[0]?.result ?? null
}

export async function recordMutationResult(
  client: PoolClient,
  params: { userId: string; mutationId: string; deviceId: string; result: SyncMutationResult },
): Promise<void> {
  await client.query(
    `INSERT INTO sync_mutations (user_id, mutation_id, device_id, result)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, mutation_id) DO NOTHING`,
    [params.userId, params.mutationId, params.deviceId, JSON.stringify(params.result)],
  )
}

// ---------------------------------------------------------------- entities

/** Secret 表没有 payload 列，值也不该参与冲突判定，只取版本与墓碑状态 */
export async function loadEntityState(
  client: PoolClient,
  params: { userId: string; entityType: SyncEntityType; entityId: string },
): Promise<ExistingEntityState | null> {
  const table = ENTITY_TABLES[params.entityType]
  const payloadColumn = params.entityType === 'secret' ? 'NULL AS payload' : 'payload'
  const { rows } = await client.query<{
    revision: string
    deleted_at: Date | null
    payload: unknown
  }>(
    `SELECT revision, deleted_at, ${payloadColumn} FROM ${table} WHERE user_id = $1 AND entity_id = $2`,
    [params.userId, params.entityId],
  )
  const row = rows[0]
  if (!row) return null
  return {
    revision: toNumber(row.revision),
    deleted: row.deleted_at !== null,
    payload: row.payload ?? null,
  }
}

export interface UpsertParams {
  userId: string
  entityType: SyncEntityType
  entityId: string
  revision: number
  payload: unknown
  cipher: SecretCipher
}

export async function upsertEntity(client: PoolClient, params: UpsertParams): Promise<void> {
  const { userId, entityId, revision } = params

  switch (params.entityType) {
    case 'subscription': {
      const payload = params.payload as {
        kind?: string
        enabled?: boolean
        sortRank?: string
        normalizedUrl?: string
      }
      await client.query(
        `INSERT INTO subscriptions
           (user_id, entity_id, kind, enabled, sort_rank, normalized_url, payload, revision, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), NULL)
         ON CONFLICT (user_id, entity_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           enabled = EXCLUDED.enabled,
           sort_rank = EXCLUDED.sort_rank,
           normalized_url = EXCLUDED.normalized_url,
           payload = EXCLUDED.payload,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = NULL`,
        [
          userId,
          entityId,
          payload.kind ?? 'builtin',
          payload.enabled !== false,
          payload.sortRank ?? '000001',
          payload.normalizedUrl ?? null,
          JSON.stringify(params.payload ?? {}),
          revision,
        ],
      )
      return
    }

    case 'category': {
      const payload = params.payload as { kind?: string; visible?: boolean; sortRank?: string }
      await client.query(
        `INSERT INTO categories
           (user_id, entity_id, kind, visible, sort_rank, payload, revision, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now(), NULL)
         ON CONFLICT (user_id, entity_id) DO UPDATE SET
           kind = EXCLUDED.kind,
           visible = EXCLUDED.visible,
           sort_rank = EXCLUDED.sort_rank,
           payload = EXCLUDED.payload,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = NULL`,
        [
          userId,
          entityId,
          payload.kind ?? 'builtin',
          payload.visible !== false,
          payload.sortRank ?? '000001',
          JSON.stringify(params.payload ?? {}),
          revision,
        ],
      )
      return
    }

    case 'setting': {
      await client.query(
        `INSERT INTO user_settings (user_id, entity_id, payload, revision, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, now(), NULL)
         ON CONFLICT (user_id, entity_id) DO UPDATE SET
           payload = EXCLUDED.payload,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = NULL`,
        [userId, entityId, JSON.stringify(params.payload ?? {}), revision],
      )
      return
    }

    case 'secret': {
      const value = (params.payload as { value?: unknown }).value
      const encrypted = params.cipher.encrypt({
        userId,
        secretKey: entityId,
        value: typeof value === 'string' ? value : '',
      })
      await client.query(
        `INSERT INTO user_secrets
           (user_id, entity_id, ciphertext, nonce, key_version, revision, updated_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), NULL)
         ON CONFLICT (user_id, entity_id) DO UPDATE SET
           ciphertext = EXCLUDED.ciphertext,
           nonce = EXCLUDED.nonce,
           key_version = EXCLUDED.key_version,
           revision = EXCLUDED.revision,
           updated_at = now(),
           deleted_at = NULL`,
        [userId, entityId, encrypted.ciphertext, encrypted.nonce, encrypted.keyVersion, revision],
      )
      return
    }
  }
}

/** 删除写 tombstone：物理行保留，长期离线的设备才能知道它被删了 */
export async function tombstoneEntity(
  client: PoolClient,
  params: { userId: string; entityType: SyncEntityType; entityId: string; revision: number },
): Promise<void> {
  const table = ENTITY_TABLES[params.entityType]
  const secretColumns =
    params.entityType === 'secret' ? ', ciphertext = NULL, nonce = NULL' : ''
  const { rowCount } = await client.query(
    `UPDATE ${table}
        SET deleted_at = now(), revision = $3, updated_at = now()${secretColumns}
      WHERE user_id = $1 AND entity_id = $2`,
    [params.userId, params.entityId, params.revision],
  )
  if (rowCount) return

  // 没有历史行时也要留一个墓碑，保证 delta pull 能把删除传播出去
  await insertTombstoneRow(client, params)
}

async function insertTombstoneRow(
  client: PoolClient,
  params: { userId: string; entityType: SyncEntityType; entityId: string; revision: number },
): Promise<void> {
  const { userId, entityId, revision } = params
  switch (params.entityType) {
    case 'subscription':
      await client.query(
        `INSERT INTO subscriptions (user_id, entity_id, sort_rank, payload, revision, deleted_at)
         VALUES ($1, $2, '000001', '{}'::jsonb, $3, now())
         ON CONFLICT (user_id, entity_id) DO NOTHING`,
        [userId, entityId, revision],
      )
      return
    case 'category':
      await client.query(
        `INSERT INTO categories (user_id, entity_id, sort_rank, payload, revision, deleted_at)
         VALUES ($1, $2, '000001', '{}'::jsonb, $3, now())
         ON CONFLICT (user_id, entity_id) DO NOTHING`,
        [userId, entityId, revision],
      )
      return
    case 'setting':
      await client.query(
        `INSERT INTO user_settings (user_id, entity_id, payload, revision, deleted_at)
         VALUES ($1, $2, '{}'::jsonb, $3, now())
         ON CONFLICT (user_id, entity_id) DO NOTHING`,
        [userId, entityId, revision],
      )
      return
    case 'secret':
      await client.query(
        `INSERT INTO user_secrets (user_id, entity_id, revision, deleted_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (user_id, entity_id) DO NOTHING`,
        [userId, entityId, revision],
      )
  }
}

// -------------------------------------------------------------------- pull

const PAYLOAD_SELECT: Record<SyncEntityType, string> = {
  subscription: 'entity_id, revision, deleted_at, updated_at, payload',
  category: 'entity_id, revision, deleted_at, updated_at, payload',
  setting: 'entity_id, revision, deleted_at, updated_at, payload',
  secret: 'entity_id, revision, deleted_at, updated_at, ciphertext, nonce, key_version',
}

export interface PullParams {
  userId: string
  since: number
  limit: number
  cipher: SecretCipher
}

/**
 * 直接查「当前最终状态」，不保存 change log。离线期间被改过多少次都无所谓，
 * 客户端只需要最新一版。
 */
export async function pullRecords(
  client: PoolClient,
  params: PullParams,
): Promise<SyncRecord[]> {
  const collected: SyncRecord[] = []

  for (const entityType of Object.keys(ENTITY_TABLES) as SyncEntityType[]) {
    const table = ENTITY_TABLES[entityType]
    const { rows } = await client.query<RawEntityRow>(
      `SELECT ${PAYLOAD_SELECT[entityType]}
         FROM ${table}
        WHERE user_id = $1 AND revision > $2
        ORDER BY revision ASC
        LIMIT $3`,
      [params.userId, params.since, params.limit],
    )

    for (const row of rows) {
      collected.push(toSyncRecord(entityType, row, params.userId, params.cipher))
    }
  }

  collected.sort((a, b) => a.revision - b.revision || a.entityId.localeCompare(b.entityId))
  return collected
}

function toSyncRecord(
  entityType: SyncEntityType,
  row: RawEntityRow,
  userId: string,
  cipher: SecretCipher,
): SyncRecord {
  const deleted = row.deleted_at !== null
  let payload: unknown = null

  if (!deleted) {
    if (entityType === 'secret') {
      payload = { value: decryptSecretRow(row, userId, cipher) }
    } else {
      payload = row.payload ?? null
    }
  }

  return {
    entityType,
    entityId: row.entity_id,
    revision: toNumber(row.revision),
    deleted,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.getTime() : 0,
    payload,
  }
}

function decryptSecretRow(row: RawEntityRow, userId: string, cipher: SecretCipher): string {
  if (!row.ciphertext || !row.nonce) return ''
  try {
    return cipher.decrypt({
      userId,
      secretKey: row.entity_id,
      secret: {
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        keyVersion: row.key_version ?? 1,
      },
    })
  } catch (error) {
    if (error instanceof SecretDecryptionError) return ''
    throw error
  }
}

/** bootstrap 摘要：只给计数与键名，不给任何 Secret 值 */
export async function summarize(
  client: PoolClient,
  userId: string,
): Promise<{
  counts: { subscriptions: number; categories: number; settings: number; secrets: number }
  secretKeys: string[]
  lastUpdatedAt: number | null
}> {
  const count = async (table: string): Promise<number> => {
    const { rows } = await client.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM ${table} WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    )
    return toNumber(rows[0]?.total ?? 0)
  }

  const [subscriptions, categories, settings, secrets] = await Promise.all([
    count('subscriptions'),
    count('categories'),
    count('user_settings'),
    count('user_secrets'),
  ])

  const { rows: keyRows } = await client.query<{ entity_id: string }>(
    'SELECT entity_id FROM user_secrets WHERE user_id = $1 AND deleted_at IS NULL ORDER BY entity_id',
    [userId],
  )

  const { rows: headRows } = await client.query<{ updated_at: Date | null }>(
    'SELECT updated_at FROM sync_heads WHERE user_id = $1',
    [userId],
  )

  return {
    counts: { subscriptions, categories, settings, secrets },
    secretKeys: keyRows.map((row) => row.entity_id),
    lastUpdatedAt: headRows[0]?.updated_at ? headRows[0].updated_at.getTime() : null,
  }
}

/** 「使用本机数据」重建基线时用：列出所有仍存活的实体 id */
export async function listLiveEntityIds(
  client: PoolClient,
  userId: string,
): Promise<{ entityType: SyncEntityType; entityId: string }[]> {
  const result: { entityType: SyncEntityType; entityId: string }[] = []
  for (const entityType of Object.keys(ENTITY_TABLES) as SyncEntityType[]) {
    const { rows } = await client.query<{ entity_id: string }>(
      `SELECT entity_id FROM ${ENTITY_TABLES[entityType]} WHERE user_id = $1 AND deleted_at IS NULL`,
      [userId],
    )
    for (const row of rows) result.push({ entityType, entityId: row.entity_id })
  }
  return result
}

// --------------------------------------------------------------- conflicts

interface RawConflictRow {
  id: string
  entity_type: SyncEntityType
  entity_id: string
  reason: SyncConflictReason
  server_revision: string
  base_revision: string | null
  local_change: unknown
  server_state: unknown
  created_at: Date
  resolved_at: Date | null
}

function toConflict(row: RawConflictRow): SyncConflict {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    reason: row.reason,
    serverRevision: toNumber(row.server_revision),
    baseRevision: row.base_revision === null ? null : toNumber(row.base_revision),
    localChange: row.local_change ?? null,
    serverState: row.server_state ?? null,
    createdAt: row.created_at.getTime(),
    resolvedAt: row.resolved_at ? row.resolved_at.getTime() : null,
  }
}

export async function insertConflict(
  client: PoolClient,
  params: {
    id: string
    userId: string
    entityType: SyncEntityType
    entityId: string
    reason: SyncConflictReason
    serverRevision: number
    baseRevision: number | null
    localChange: unknown
    serverState: unknown
  },
): Promise<SyncConflict> {
  const { rows } = await client.query<RawConflictRow>(
    `INSERT INTO sync_conflicts
       (id, user_id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state, created_at, resolved_at`,
    [
      params.id,
      params.userId,
      params.entityType,
      params.entityId,
      params.reason,
      params.serverRevision,
      params.baseRevision,
      JSON.stringify(params.localChange ?? null),
      JSON.stringify(params.serverState ?? null),
    ],
  )
  return toConflict(rows[0]!)
}

/** 同一实体同时只该有一条未裁决冲突；push 前先查它，避免重复 push 刷出成排冲突 */
export async function findOpenConflictForEntity(
  client: PoolClient,
  params: { userId: string; entityType: SyncEntityType; entityId: string },
): Promise<SyncConflict | null> {
  const { rows } = await client.query<RawConflictRow>(
    `SELECT id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state, created_at, resolved_at
       FROM sync_conflicts
      WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3 AND resolved_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [params.userId, params.entityType, params.entityId],
  )
  const row = rows[0]
  return row ? toConflict(row) : null
}

/**
 * 同一实体的分歧又推了一次：刷新既有冲突里的本地改动与服务端快照，
 * 而不是再插一行。用户看到的永远是「这个实体现在有分歧」，只需裁决一次。
 */
export async function refreshConflict(
  client: PoolClient,
  params: {
    id: string
    userId: string
    reason: SyncConflictReason
    serverRevision: number
    baseRevision: number | null
    localChange: unknown
    serverState: unknown
  },
): Promise<SyncConflict> {
  const { rows } = await client.query<RawConflictRow>(
    `UPDATE sync_conflicts
        SET reason = $3, server_revision = $4, base_revision = $5, local_change = $6, server_state = $7
      WHERE user_id = $1 AND id = $2
      RETURNING id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state, created_at, resolved_at`,
    [
      params.userId,
      params.id,
      params.reason,
      params.serverRevision,
      params.baseRevision,
      JSON.stringify(params.localChange ?? null),
      JSON.stringify(params.serverState ?? null),
    ],
  )
  return toConflict(rows[0]!)
}

export async function listOpenConflicts(
  client: PoolClient,
  userId: string,
): Promise<SyncConflict[]> {
  const { rows } = await client.query<RawConflictRow>(
    `SELECT id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state, created_at, resolved_at
       FROM sync_conflicts
      WHERE user_id = $1 AND resolved_at IS NULL
      ORDER BY created_at ASC`,
    [userId],
  )
  return rows.map(toConflict)
}

export async function findConflict(
  client: PoolClient,
  userId: string,
  conflictId: string,
): Promise<SyncConflict | null> {
  const { rows } = await client.query<RawConflictRow>(
    `SELECT id, entity_type, entity_id, reason, server_revision, base_revision, local_change, server_state, created_at, resolved_at
       FROM sync_conflicts
      WHERE user_id = $1 AND id = $2`,
    [userId, conflictId],
  )
  const row = rows[0]
  return row ? toConflict(row) : null
}

export async function markConflictResolved(
  client: PoolClient,
  userId: string,
  conflictId: string,
): Promise<void> {
  await client.query(
    'UPDATE sync_conflicts SET resolved_at = now() WHERE user_id = $1 AND id = $2 AND resolved_at IS NULL',
    [userId, conflictId],
  )
}

// ----------------------------------------------------------------- devices

export interface DeviceRow {
  id: string
  user_id: string
  name: string | null
  platform: string
  app_version: string | null
  created_at: Date
  last_seen_at: Date
  revoked_at: Date | null
}

export async function findDevice(
  client: PoolClient,
  deviceId: string,
): Promise<DeviceRow | null> {
  const { rows } = await client.query<DeviceRow>('SELECT * FROM devices WHERE id = $1', [deviceId])
  return rows[0] ?? null
}

export async function touchDevice(
  client: PoolClient,
  params: {
    deviceId: string
    userId: string
    name?: string
    platform?: string
    appVersion?: string
  },
): Promise<void> {
  await client.query(
    `INSERT INTO devices (id, user_id, name, platform, app_version, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, devices.name),
       platform = CASE
         WHEN EXCLUDED.platform IS NOT NULL AND EXCLUDED.platform <> 'unknown' THEN EXCLUDED.platform
         ELSE devices.platform
       END,
       app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
       last_seen_at = now()`,
    [
      params.deviceId,
      params.userId,
      params.name ?? null,
      params.platform ?? 'unknown',
      params.appVersion ?? null,
    ],
  )
}

export async function listDevices(client: PoolClient, userId: string): Promise<DeviceRow[]> {
  const { rows } = await client.query<DeviceRow>(
    'SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC',
    [userId],
  )
  return rows
}

export async function revokeDevice(
  client: PoolClient,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    'UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND id = $2 AND revoked_at IS NULL',
    [userId, deviceId],
  )
  return Boolean(rowCount)
}

// --------------------------------------------------------- device ↔ session

/** 记住「这个会话正在这台设备上用」；撤销设备时据此定位要作废的会话 */
export async function bindDeviceSession(
  client: PoolClient,
  params: { userId: string; deviceId: string; sessionId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO device_sessions (user_id, device_id, session_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id, session_id) DO UPDATE SET last_seen_at = now()`,
    [params.userId, params.deviceId, params.sessionId],
  )
}

/**
 * 这个会话是否绑在某台已撤销的设备上。
 * 撤销后换一个新 deviceId 重新登记，也要在这里被拦下来。
 */
export async function sessionBelongsToRevokedDevice(
  client: PoolClient,
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM device_sessions ds
         JOIN devices d ON d.id = ds.device_id
        WHERE ds.user_id = $1 AND ds.session_id = $2 AND d.revoked_at IS NOT NULL
     ) AS exists`,
    [userId, sessionId],
  )
  return rows[0]?.exists === true
}

/** 撤销设备时作废它手里的会话；`keepSessionId` 是发起撤销的那个会话 */
export async function deleteDeviceSessions(
  client: PoolClient,
  params: { userId: string; deviceId: string; keepSessionId: string | null },
): Promise<number> {
  const { rows } = await client.query<{ session_id: string }>(
    `SELECT session_id FROM device_sessions
      WHERE user_id = $1 AND device_id = $2 AND ($3::text IS NULL OR session_id <> $3)`,
    [params.userId, params.deviceId, params.keepSessionId],
  )
  const sessionIds = rows.map((row) => row.session_id)
  if (!sessionIds.length) return 0

  await client.query('DELETE FROM auth."session" WHERE "userId" = $1 AND id = ANY($2::text[])', [
    params.userId,
    sessionIds,
  ])
  return sessionIds.length
}
