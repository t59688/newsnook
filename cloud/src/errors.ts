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
  new ApiError('AUTH_REQUIRED', '需要登录后才能访问')

export const sessionExpired = (): ApiError =>
  new ApiError('SESSION_EXPIRED', '登录已失效，请重新登录')

export const deviceRevoked = (): ApiError =>
  new ApiError('DEVICE_REVOKED', '这台设备的同步已被撤销')

/** 本机 deviceId 已绑定其他账户；客户端应换新 deviceId 后重试 */
export const deviceInUse = (): ApiError =>
  new ApiError('DEVICE_IN_USE', '这台设备已绑定到另一个账户，正在重新登记')

export const validationFailed = (message: string, detail?: string): ApiError =>
  new ApiError('VALIDATION_FAILED', message, detail)

export const protocolUnsupported = (): ApiError =>
  new ApiError('SYNC_SCHEMA_UNSUPPORTED', '同步协议版本过旧，请升级应用')

export const notFound = (message = '资源不存在'): ApiError =>
  new ApiError('NOT_FOUND', message)

export const serviceUnavailable = (message = '服务暂时不可用，请稍后再试'): ApiError =>
  new ApiError('SERVICE_UNAVAILABLE', message)
