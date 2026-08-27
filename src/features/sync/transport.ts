/**
 * 同步网络边界。
 *
 * 引擎只依赖这个接口，不关心 Cookie / Bearer / 代理这些差异——
 * Web 用 HttpOnly Cookie，Android 用 SecureStore 里的 Bearer，
 * 都由 account 层注入的 `fetchCloud` 决定。
 */

import { isFatalErrorCode, isRetryableErrorCode, type ApiErrorCode } from '@newsnook/contracts/errors'
import { SYNC_LIMITS, SYNC_PROTOCOL_VERSION } from '@newsnook/contracts/protocol'
import type {
  BootstrapEntity,
  DevicePlatform,
  SyncBootstrapReplaceResponse,
  SyncBootstrapResponse,
  SyncConflict,
  SyncConflictResolution,
  SyncMutation,
  SyncPullResponse,
  SyncPushResponse,
} from '@newsnook/contracts'

export const DEVICE_HEADER = 'x-newsnook-device'

/** 网络层失败与业务错误码统一成这一个类型，引擎据此决定重试还是暂停 */
export class SyncTransportError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_ERROR'
  readonly status: number
  /** 服务端 request id；出错提示里给用户看的短编号 */
  readonly requestId: string | null
  readonly retryAfterMs: number | null

  constructor(params: {
    code: ApiErrorCode | 'NETWORK_ERROR'
    message: string
    status?: number
    requestId?: string | null
    retryAfterMs?: number | null
  }) {
    super(params.message)
    this.name = 'SyncTransportError'
    this.code = params.code
    this.status = params.status ?? 0
    this.requestId = params.requestId ?? null
    this.retryAfterMs = params.retryAfterMs ?? null
  }

  /** 需要用户处理（重新登录 / 升级 / 设备被撤销）：自动重试没有意义 */
  get fatal(): boolean {
    return this.code !== 'NETWORK_ERROR' && isFatalErrorCode(this.code)
  }

  get retryable(): boolean {
    return this.code === 'NETWORK_ERROR' || isRetryableErrorCode(this.code)
  }
}

export interface CloudRequestInit {
  method?: 'GET' | 'POST'
  body?: unknown
  headers?: Record<string, string>
}

/** account 层提供：负责带上凭证与云端 base URL */
export type CloudFetch = (path: string, init?: CloudRequestInit) => Promise<Response>

export interface SyncTransport {
  bootstrap(): Promise<SyncBootstrapResponse>
  bootstrapReplace(entities: BootstrapEntity[]): Promise<SyncBootstrapReplaceResponse>
  push(mutations: SyncMutation[]): Promise<SyncPushResponse>
  pull(since: number, limit?: number): Promise<SyncPullResponse>
  listConflicts(): Promise<SyncConflict[]>
  resolveConflict(conflictId: string, resolution: SyncConflictResolution): Promise<void>
  resolveConflicts(
    decisions: ReadonlyArray<{ conflictId: string; resolution: SyncConflictResolution }>,
  ): Promise<void>
}

export interface DeviceIdentity {
  deviceId: string
  deviceName?: string
  platform?: DevicePlatform
  appVersion?: string
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now())
}

async function toTransportError(response: Response): Promise<SyncTransportError> {
  let code: ApiErrorCode | 'NETWORK_ERROR' = 'INTERNAL_ERROR'
  let message = `Cloud request failed with ${response.status}`
  let requestId: string | null = null

  try {
    const body = (await response.json()) as { code?: string; message?: string; requestId?: string }
    if (body?.code) code = body.code as ApiErrorCode
    if (body?.message) message = body.message
    if (body?.requestId) requestId = body.requestId
  } catch {
    // 边缘设备/反代可能返回非 JSON 错误页；保留状态码即可
  }

  if (response.status === 429 && code === 'INTERNAL_ERROR') code = 'RATE_LIMITED'
  if (response.status === 401 && code === 'INTERNAL_ERROR') code = 'AUTH_REQUIRED'

  return new SyncTransportError({
    code,
    message,
    status: response.status,
    requestId,
    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
  })
}

export function createHttpSyncTransport(options: {
  fetchCloud: CloudFetch
  identity: () => DeviceIdentity
}): SyncTransport {
  const { fetchCloud, identity } = options

  async function call<T>(path: string, init?: CloudRequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetchCloud(path, {
        ...init,
        headers: { ...init?.headers, [DEVICE_HEADER]: identity().deviceId },
      })
    } catch (error) {
      throw new SyncTransportError({
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network request failed',
      })
    }

    if (!response.ok) throw await toTransportError(response)
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  return {
    bootstrap: () => call<SyncBootstrapResponse>('/api/v1/sync/bootstrap'),

    bootstrapReplace: (entities) =>
      call<SyncBootstrapReplaceResponse>('/api/v1/sync/bootstrap/replace', {
        method: 'POST',
        body: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          deviceId: identity().deviceId,
          entities,
        },
      }),

    push: (mutations) => {
      const device = identity()
      return call<SyncPushResponse>('/api/v1/sync/push', {
        method: 'POST',
        body: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          platform: device.platform,
          appVersion: device.appVersion,
          mutations,
        },
      })
    },

    pull: (since, limit = SYNC_LIMITS.defaultPullLimit) =>
      call<SyncPullResponse>(`/api/v1/sync/pull?since=${since}&limit=${limit}`),

    listConflicts: async () => {
      const result = await call<{ conflicts: SyncConflict[] }>('/api/v1/sync/conflicts')
      return result.conflicts
    },

    resolveConflict: async (conflictId, resolution) => {
      await call(`/api/v1/sync/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
        method: 'POST',
        body: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          deviceId: identity().deviceId,
          resolution,
        },
      })
    },

    resolveConflicts: async (decisions) => {
      if (!decisions.length) return
      await call('/api/v1/sync/conflicts/resolve', {
        method: 'POST',
        body: {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          deviceId: identity().deviceId,
          decisions,
        },
      })
    },
  }
}
