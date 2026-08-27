/**
 * 同步状态的持久化：`newsnook:sync-state:v1` 与 `newsnook:sync-journal:v1`。
 *
 * 这两个结构里只有游标、指纹和待发 mutation 的元数据。
 * 长期 Session 走 SecureStore，Secret 明文在 push 时才从投影里现取，
 * 都不会落到这里。
 */

import type { SyncEntityType, SyncMutationOperation } from '@newsnook/contracts'

import { log } from '../../lib/logger'
import {
  clearSyncJournal as clearStoredJournal,
  loadSyncJournal,
  loadSyncState,
  saveSyncJournal,
  saveSyncState,
} from '../../lib/storage'
import { randomUuid } from './ids'
import type { LocalSyncState, OutboxEntry, ShadowEntry, SyncApplyJournal } from './types'

const ENTITY_TYPES: SyncEntityType[] = ['subscription', 'category', 'setting', 'secret']
const OPERATIONS: SyncMutationOperation[] = ['upsert', 'delete']

export function createInitialSyncState(deviceId = randomUuid()): LocalSyncState {
  return {
    deviceId,
    cursor: 0,
    shadow: {},
    outbox: [],
    firstSyncCompleted: false,
    retryAttempt: 0,
    nextRetryAt: null,
  }
}

function isEntityType(value: unknown): value is SyncEntityType {
  return typeof value === 'string' && ENTITY_TYPES.includes(value as SyncEntityType)
}

function normalizeShadow(raw: unknown): Record<string, ShadowEntry> {
  const shadow: Record<string, ShadowEntry> = {}
  if (!raw || typeof raw !== 'object') return shadow

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<ShadowEntry> | null
    if (!entry || typeof entry.fingerprint !== 'string') continue
    shadow[key] = {
      revision: typeof entry.revision === 'number' && entry.revision >= 0 ? entry.revision : 0,
      fingerprint: entry.fingerprint,
      deleted: entry.deleted === true,
    }
  }
  return shadow
}

function normalizeOutbox(raw: unknown): OutboxEntry[] {
  if (!Array.isArray(raw)) return []

  const entries: OutboxEntry[] = []
  for (const value of raw) {
    const entry = value as Partial<OutboxEntry> | null
    if (!entry || typeof entry.mutationId !== 'string' || typeof entry.entityId !== 'string') {
      continue
    }
    if (!isEntityType(entry.entityType)) continue
    if (!OPERATIONS.includes(entry.operation as SyncMutationOperation)) continue

    entries.push({
      mutationId: entry.mutationId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      operation: entry.operation as SyncMutationOperation,
      baseRevision:
        typeof entry.baseRevision === 'number' && entry.baseRevision >= 0
          ? entry.baseRevision
          : null,
      // Secret 的值从不落盘；push 前由 reconcile 的投影现取
      payload: entry.entityType === 'secret' ? null : (entry.payload ?? null),
      fingerprint: typeof entry.fingerprint === 'string' ? entry.fingerprint : '',
    })
  }
  return entries
}

export function normalizeSyncState(raw: unknown): LocalSyncState {
  const input = (raw ?? {}) as Partial<LocalSyncState>
  const deviceId = typeof input.deviceId === 'string' && input.deviceId ? input.deviceId : randomUuid()

  return {
    deviceId,
    cursor: typeof input.cursor === 'number' && input.cursor >= 0 ? input.cursor : 0,
    shadow: normalizeShadow(input.shadow),
    outbox: normalizeOutbox(input.outbox),
    firstSyncCompleted: input.firstSyncCompleted === true,
    retryAttempt: typeof input.retryAttempt === 'number' && input.retryAttempt >= 0 ? input.retryAttempt : 0,
    nextRetryAt: typeof input.nextRetryAt === 'number' ? input.nextRetryAt : null,
  }
}

/** 持久化前再擦一遍 Secret：任何路径都不能把明文写进 localStorage */
export function redactForPersistence(state: LocalSyncState): LocalSyncState {
  return {
    ...state,
    outbox: state.outbox.map((entry) =>
      entry.entityType === 'secret' ? { ...entry, payload: null } : entry,
    ),
  }
}

export function readSyncState(): LocalSyncState {
  const stored = loadSyncState()
  if (stored == null) {
    const fresh = createInitialSyncState()
    writeSyncState(fresh)
    return fresh
  }
  return normalizeSyncState(stored)
}

export function writeSyncState(state: LocalSyncState): void {
  saveSyncState(redactForPersistence(state))
}

export function normalizeApplyJournal(raw: unknown): SyncApplyJournal | null {
  const input = raw as Partial<SyncApplyJournal> | null
  if (!input || !Array.isArray(input.records)) return null
  if (typeof input.targetCursor !== 'number' || input.targetCursor < 0) return null

  return {
    records: input.records,
    targetCursor: input.targetCursor,
    startedAt: typeof input.startedAt === 'number' ? input.startedAt : 0,
  }
}

export function readApplyJournal(): SyncApplyJournal | null {
  try {
    return normalizeApplyJournal(loadSyncJournal())
  } catch (error) {
    log.sync.warn('apply journal unreadable, dropping', error)
    return null
  }
}

export function writeApplyJournal(journal: SyncApplyJournal): void {
  saveSyncJournal(journal)
}

export function clearApplyJournal(): void {
  clearStoredJournal()
}
