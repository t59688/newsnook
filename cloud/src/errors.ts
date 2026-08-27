/**
 * 统一错误表达：HTTP status 说明大类，稳定 `code` 决定客户端动作。
 * 每个响应都带 Fastify 的 request id，便于用户报错时对上服务端日志。
 */

import {
  HTTP_STATUS_BY_ERROR_CODE,
  type ApiErrorBody,
  type ApiErrorCode,
} from '@newsnook/contracts'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly statusCode: number
  /** 只进日志，不回给客户端；用来放不便公开的排查线索 */
  readonly detail?: string

  constructor(code: ApiErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = HTTP_STATUS_BY_ERROR_CODE[code]
    this.detail = detail
  }
}

export function apiErrorBody(code: ApiErrorCode, message: string, requestId: string): ApiErrorBody {
  return { code, message, requestId }
}

export const authRequired = (): ApiError =>
  new ApiError('AUTH_REQUIRED', 'Authentication is required for this endpoint')

export const sessionExpired = (): ApiError =>
  new ApiError('SESSION_EXPIRED', 'The session is no longer valid, sign in again')

export const deviceRevoked = (): ApiError =>
  new ApiError('DEVICE_REVOKED', 'This device has been revoked for the account')

export const validationFailed = (message: string, detail?: string): ApiError =>
  new ApiError('VALIDATION_FAILED', message, detail)

export const protocolUnsupported = (): ApiError =>
  new ApiError('SYNC_SCHEMA_UNSUPPORTED', 'This client sync protocol version is not supported')

export const notFound = (message = 'Resource not found'): ApiError =>
  new ApiError('NOT_FOUND', message)

export const serviceUnavailable = (message = 'Service temporarily unavailable'): ApiError =>
  new ApiError('SERVICE_UNAVAILABLE', message)
