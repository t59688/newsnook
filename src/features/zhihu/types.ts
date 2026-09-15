import type { Article } from '../../lib/types'

export type ZhihuContentType = 'answer' | 'article' | 'question' | 'pin'

export interface ZhihuExternalRef {
  provider: 'zhihu-main'
  type: ZhihuContentType
  id: string
  parentId?: string
}

export interface ZhihuSession {
  version: 1
  cookies: Record<string, string>
  userAgent: string
  capturedAt: number
}

export interface ZhihuPaging {
  isEnd?: boolean
  next?: string
  previous?: string
}

export interface ZhihuListResult {
  articles: Article[]
  paging?: ZhihuPaging
}

export interface ZhihuProfile {
  id?: string
  urlToken?: string
  name: string
  avatarUrl?: string
  headline?: string
}

export type ZhihuAccountState =
  | { status: 'unsupported' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; profile?: ZhihuProfile; capturedAt: number }

export type ZhihuApiErrorCode =
  | 'UNSUPPORTED_PLATFORM'
  | 'AUTH_REQUIRED'
  | 'SESSION_EXPIRED'
  | 'RISK_CONTROL_REQUIRED'
  | 'RATE_LIMITED'
  | 'SIGNATURE_REJECTED'
  | 'API_SCHEMA_CHANGED'
  | 'NETWORK_ERROR'
  | 'REQUEST_FAILED'

export class ZhihuApiError extends Error {
  readonly code: ZhihuApiErrorCode
  readonly status?: number

  constructor(code: ZhihuApiErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ZhihuApiError'
    this.code = code
    this.status = status
  }
}
