import { ZhihuApiError } from '../api/errors'
import type { ZhihuApiClient } from '../api/client'
import {
  authenticateZhihuNative,
  clearZhihuNativeBrowserSession,
  isNativeZhihuSessionAvailable,
} from './native'
import type { ZhihuSessionService } from './service'
import type { ZhihuCredentialStore } from './store'
import type { ZhihuStoredAccount } from './types'

export class ZhihuAccountService {
  private readonly session: ZhihuSessionService
  private readonly credentials: ZhihuCredentialStore
  private readonly api: ZhihuApiClient

  constructor(
    session: ZhihuSessionService,
    credentials: ZhihuCredentialStore,
    api: ZhihuApiClient,
  ) {
    this.session = session
    this.credentials = credentials
    this.api = api
  }

  async addAccount(url?: string): Promise<ZhihuStoredAccount> {
    if (!this.isNativeAuthAvailable()) throw new Error('知乎登录/注册目前需要 NewsNook Android 原生应用')
    this.session.setAuthState('authenticating')
    try {
      const stored = await authenticateZhihuNative({ url, resume: null })
      await this.credentials.saveAccount(stored)
      await this.credentials.setActiveAccountId(stored.account.id)
      this.session.switchAccount(stored.account, 'authenticated')
      return stored
    } catch (error) {
      const current = await this.currentStoredAccount()
      this.session.setAuthState(current ? 'authenticated' : 'guest')
      throw error
    }
  }

  isNativeAuthAvailable(): boolean {
    return isNativeZhihuSessionAvailable()
  }

  listAccounts(): Promise<ZhihuStoredAccount[]> {
    return this.credentials.listAccounts()
  }

  async currentStoredAccount(): Promise<ZhihuStoredAccount | null> {
    const id = this.session.getSnapshot().account?.id ?? await this.credentials.getActiveAccountId()
    return id ? this.credentials.loadAccount(id) : null
  }

  async hydrate(): Promise<ZhihuStoredAccount | null> {
    const current = this.session.getSnapshot()
    const activeId = await this.credentials.getActiveAccountId()
    let stored = activeId ? await this.credentials.loadAccount(activeId) : null

    // active 是独立安全键；老版本使用异步 apply() 时，极端情况下可能 session 已经写入而
    // active 尚未来得及刷盘。不能因此把完整账号当成“丢失”。从账号索引中选最近一次
    // 更新的有效会话并自修复 active，兼容已有半事务状态。
    if (!stored) {
      const accounts = await this.credentials.listAccounts()
      stored = accounts.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
      if (stored) await this.credentials.setActiveAccountId(stored.account.id)
    }

    if (!stored) {
      // 冷启动本来就是 guest 时不能再次 switchAccount(null)：那会无意义地 bump
      // generation，把同时启动的匿名推荐流请求判成“账号已切换”的过期响应。
      if (activeId) await this.credentials.setActiveAccountId(null)
      if (current.account || current.auth !== 'guest') this.session.switchAccount(null)
      return null
    }
    if (current.account?.id === stored.account.id) this.session.setAuthState('authenticated')
    else this.session.switchAccount(stored.account, 'authenticated')
    try {
      await this.api.getJson('session.validate', 'https://www.zhihu.com/api/v4/me')
      return stored
    } catch (error) {
      if (error instanceof ZhihuApiError && error.code === 'verification-required') {
        this.session.setAuthState('verification-required')
        return stored
      }
      if (error instanceof ZhihuApiError && error.code === 'auth-expired') {
        this.session.setAuthState('expired')
        return stored
      }
      // 冷启动校验可能遇到断网、connection closed、429 或上游短暂异常。这些都不能
      // 被解释成“登录失效”，更不能让已持久化的账号资料从 UI 消失。保留账号会话，
      // 后续真实 401 再进入 expired。
      this.session.setAuthState('authenticated')
      return stored
    }
  }

  async authenticate(url?: string): Promise<ZhihuStoredAccount> {
    if (!this.isNativeAuthAvailable()) throw new Error('知乎登录/注册目前需要 NewsNook Android 原生应用')
    const resume = await this.currentStoredAccount()
    const previousAuth = this.session.getSnapshot().auth
    this.session.setAuthState('authenticating')
    try {
      const stored = await authenticateZhihuNative({ url, resume })
      await this.credentials.saveAccount(stored)
      await this.credentials.setActiveAccountId(stored.account.id)
      this.session.switchAccount(stored.account, 'authenticated')
      return stored
    } catch (error) {
      const current = await this.currentStoredAccount()
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('ZH_AUTH_CANCELLED')) {
        this.session.setAuthState(current ? (previousAuth === 'guest' ? 'authenticated' : previousAuth) : 'guest')
      } else {
        // 重新验证窗口自身加载失败不能反向注销一个已经持久化的有效账号。真正的
        // 会话过期只由业务 API 明确返回 401/need_login 后判定。
        this.session.setAuthState(current ? (previousAuth === 'guest' ? 'authenticated' : previousAuth) : 'guest')
      }
      throw error
    }
  }

  async switchAccount(accountId: string): Promise<ZhihuStoredAccount> {
    const stored = await this.credentials.loadAccount(accountId)
    if (!stored) throw new Error('找不到该知乎账号的安全会话')
    await this.credentials.setActiveAccountId(accountId)
    this.session.switchAccount(stored.account, 'authenticated')
    try {
      await this.api.getJson('session.validate', 'https://www.zhihu.com/api/v4/me')
      return stored
    } catch (error) {
      if (error instanceof ZhihuApiError && error.code === 'verification-required') {
        this.session.setAuthState('verification-required')
        throw error
      }
      if (error instanceof ZhihuApiError && error.code === 'auth-expired') {
        this.session.setAuthState('expired')
        throw error
      }
      // 切号后的网络抖动不等于凭据失效；目标账号已经安全落盘并成为当前账号。
      this.session.setAuthState('authenticated')
      return stored
    }
  }

  async removeCurrentAccount(): Promise<void> {
    const accountId = this.session.getSnapshot().account?.id
    if (accountId) await this.credentials.removeAccount(accountId)
    await clearZhihuNativeBrowserSession()
    this.session.switchAccount(null)
  }
}
