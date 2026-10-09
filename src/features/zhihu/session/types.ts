export type ZhihuAuthState =
  | 'guest'
  | 'authenticating'
  | 'authenticated'
  | 'expired'
  | 'verification-required'

export interface ZhihuAccountRef {
  id: string
  name?: string
  urlToken?: string
  avatarUrl?: string
  headline?: string
}

export interface ZhihuStoredAccount {
  account: ZhihuAccountRef
  wwwCookie: string
  apiCookie: string
  /** 登录 WebView 实际使用的 UA。知乎部分 members API 会据此判断客户端协议版本。 */
  userAgent?: string
  profileJson?: string
  updatedAt: number
}

export interface ZhihuSessionSnapshot {
  auth: ZhihuAuthState
  account: ZhihuAccountRef | null
  generation: number
}
