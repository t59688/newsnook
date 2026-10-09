/**
 * 稳定业务错误码：HTTP status 表达大类，`code` 决定客户端动作。
 * 这个模块不依赖 zod，客户端可以只引它而不把 schema 打进包体。
 */

export const API_ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'DEVICE_REVOKED',
  'DEVICE_IN_USE',
  'SYNC_CONFLICT',
  'SYNC_SCHEMA_UNSUPPORTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/** 所有错误响应体统一形状；`requestId` 与服务端结构化日志的 request id 一致 */
export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  requestId: string
}

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && (API_ERROR_CODES as readonly string[]).includes(value)
}

/** 该错误是否值得客户端在退避后自动重试（网络/服务端瞬时故障） */
export function isRetryableErrorCode(code: ApiErrorCode): boolean {
  return code === 'RATE_LIMITED' || code === 'SERVICE_UNAVAILABLE' || code === 'INTERNAL_ERROR'
}

/** 该错误必须停止自动同步并要求用户处理（重新登录 / 升级 / 设备被撤销） */
export function isFatalErrorCode(code: ApiErrorCode): boolean {
  return (
    code === 'AUTH_REQUIRED' ||
    code === 'SESSION_EXPIRED' ||
    code === 'DEVICE_REVOKED' ||
    code === 'SYNC_SCHEMA_UNSUPPORTED'
  )
}

export const HTTP_STATUS_BY_ERROR_CODE: Record<ApiErrorCode, number> = {
  AUTH_REQUIRED: 401,
  SESSION_EXPIRED: 401,
  DEVICE_REVOKED: 403,
  DEVICE_IN_USE: 409,
  SYNC_CONFLICT: 409,
  SYNC_SCHEMA_UNSUPPORTED: 426,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}
