export type ZhihuErrorCode =
  | 'auth-expired'
  | 'verification-required'
  | 'forbidden'
  | 'rate-limited'
  | 'network'
  | 'invalid-response'
  | 'conflict'
  | 'unsupported'
  | 'stale-generation'

export class ZhihuApiError extends Error {
  readonly code: ZhihuErrorCode
  readonly status?: number

  constructor(
    code: ZhihuErrorCode,
    message: string,
    status?: number,
  ) {
    super(message)
    this.name = 'ZhihuApiError'
    this.code = code
    this.status = status
  }
}
