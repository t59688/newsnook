/**
 * 账户模块的稳定边界。
 *
 * 账户是纯可选能力：未登录时整个模块只提供一个 `anonymous` 状态，
 * 阅读、解析、缓存都不经过这里。UI 只依赖 `AccountAdapter`，
 * Web（Cookie Session）与 Android（Keystore 里的 Bearer）差异全部收在实现里。
 */

import type { DevicePlatform } from '@newsnook/contracts/protocol'

import type { CloudFetch } from '../sync/transport'

export type AccountPlatform = Extract<DevicePlatform, 'web' | 'android'>

/** 邮箱密码登录记为 `credential`，其余是 OAuth provider id */
export type SocialProvider = 'google' | 'github' | 'linuxdo'

export interface AccountUser {
  id: string
  email: string
  name: string | null
  emailVerified: boolean
  image: string | null
}

export interface AccountSession {
  user: AccountUser
  /** 已绑定的登录方式：`credential` / `google` / `github` / `linuxdo` */
  linkedProviders: string[]
}

/**
 * 账户相关错误统一成这一个类型。`code` 直接沿用 Better Auth 的错误码，
 * 文案由 UI 侧按 `code` 翻译，网络失败用 `NETWORK_ERROR`。
 */
export class AccountError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 0) {
    super(message)
    this.name = 'AccountError'
    this.code = code
    this.status = status
  }

  /** 凭证失效：调用方应把本机会话清掉并回到未登录态 */
  get authRequired(): boolean {
    return this.status === 401 || this.code === 'AUTH_REQUIRED'
  }
}

export interface SignUpInput {
  email: string
  password: string
  name?: string
}

export interface SignUpResult {
  /** 服务端要求邮箱验证时为 true：此时还没有可用 Session */
  verificationRequired: boolean
}

/**
 * 发起社交登录的两种形态：
 * - `redirect`：Web，当前页面直接跳到 provider，回来时整个页面重载
 * - `external`：Android，系统浏览器完成后经 `newsnook://auth/callback` 回流
 */
export type SocialSignInMode = 'redirect' | 'external'

export interface AccountAdapter {
  readonly platform: AccountPlatform
  /** 同步引擎的网络出口：Web 带 Cookie，Android 带 Keystore 里的 Bearer */
  readonly fetchCloud: CloudFetch

  /** 冷启动恢复：Android 读 SecureStore，Web 靠 Cookie；失败返回 null 而不是抛错 */
  restore(): Promise<AccountSession | null>
  /** 主动向 `/api/v1/me` 复核一次当前会话 */
  refresh(): Promise<AccountSession | null>

  signUp(input: SignUpInput): Promise<SignUpResult>
  signIn(email: string, password: string): Promise<AccountSession>
  requestPasswordReset(email: string): Promise<void>
  resendVerificationEmail(email: string): Promise<void>

  startSocialSignIn(provider: SocialProvider): Promise<SocialSignInMode>
  /** 已登录时显式绑定另一个 provider；未登录时同邮箱绝不隐式合并 */
  linkSocial(provider: SocialProvider): Promise<SocialSignInMode>

  /** Capacitor launchUrl / appUrlOpen 进来的 URL；不是认证深链返回 null */
  handleAuthDeepLink(url: string): Promise<AccountSession | null>

  /** 只清掉本机云端凭证：本地订阅、配置、缓存一律保留 */
  signOut(): Promise<void>
}
