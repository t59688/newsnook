/**
 * 账户状态。整个 hook 的默认答案是「未登录」：
 * 恢复失败、云端不可达、插件缺失都只是停在 `anonymous`，不阻断任何本地阅读。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { log } from '../../lib/logger'
import { createPlatformAccountAdapter } from './authClient'
import { isAuthCallbackUrl } from './mobileCallback'
import {
  AccountError,
  type AccountAdapter,
  type AccountSession,
  type SignUpInput,
  type SocialProvider,
} from './types'

export type AccountStatus = 'restoring' | 'anonymous' | 'authenticated'

export interface AccountApi {
  adapter: AccountAdapter
  status: AccountStatus
  session: AccountSession | null
  busy: boolean
  /** 面向用户的中文提示；成功后清空 */
  error: string | null
  notice: string | null
  clearMessages: () => void
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (input: SignUpInput) => Promise<boolean>
  requestPasswordReset: (email: string) => Promise<boolean>
  resendVerification: (email: string) => Promise<boolean>
  signInWithSocial: (provider: SocialProvider) => Promise<boolean>
  linkSocial: (provider: SocialProvider) => Promise<boolean>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  /** 云端当前启用的社交登录入口 */
  socialSignInProviders: SocialProvider[]
  /** 云端是否开放邮箱注册 */
  emailSignUpEnabled: boolean
}

/** Better Auth 的错误码翻译；未知码回落到服务端文案 */
const ERROR_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: '连不上同步服务，稍后再试。本地阅读不受影响。',
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不对',
  EMAIL_NOT_VERIFIED: '邮箱还没验证，请先点开验证邮件里的链接',
  USER_ALREADY_EXISTS: '这个邮箱已经注册过了，直接登录即可',
  PASSWORD_TOO_SHORT: '密码太短了，至少 8 位',
  RATE_LIMITED: '操作太频繁，缓一会儿再试',
  SESSION_MISSING: '登录没能建立会话，请重试',
  OAUTH_URL_MISSING: '暂时无法开始第三方登录，稍后再试',
}

function describe(error: unknown): string {
  if (error instanceof AccountError) return ERROR_MESSAGES[error.code] ?? error.message
  return '操作失败，请稍后再试'
}

export function useAccount(): AccountApi {
  const adapter = useMemo(() => createPlatformAccountAdapter(), [])
  const [status, setStatus] = useState<AccountStatus>('restoring')
  const [session, setSession] = useState<AccountSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [socialSignInProviders, setSocialSignInProviders] = useState<SocialProvider[]>([])
  const [emailSignUpEnabled, setEmailSignUpEnabled] = useState(true)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const settle = useCallback((next: AccountSession | null) => {
    if (!mounted.current) return
    setSession(next)
    setStatus(next ? 'authenticated' : 'anonymous')
  }, [])

  useEffect(() => {
    void adapter
      .restore()
      .then(settle)
      .catch((restoreError: unknown) => {
        log.account.debug('session restore failed', { restoreError })
        settle(null)
      })
  }, [adapter, settle])

  useEffect(() => {
    void adapter
      .fetchAuthConfig()
      .then((config) => {
        if (!mounted.current) return
        setSocialSignInProviders(config.socialSignIn)
        setEmailSignUpEnabled(config.emailSignUp)
      })
      .catch(() => {})
  }, [adapter])

  /** Android 社交登录回流：`newsnook://auth/callback?ott=...` */
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let disposed = false
    let handle: { remove: () => Promise<void> } | undefined

    const consume = (url: string) => {
      if (!isAuthCallbackUrl(url)) return
      void adapter
        .handleAuthDeepLink(url)
        .then((next) => {
          if (next) settle(next)
        })
        .catch((deepLinkError: unknown) => {
          if (mounted.current) setError(describe(deepLinkError))
        })
    }

    void CapacitorApp.getLaunchUrl()
      .then((launch) => {
        if (!disposed && launch?.url) consume(launch.url)
      })
      .catch(() => {})

    void CapacitorApp.addListener('appUrlOpen', (event) => {
      if (!disposed) consume(event.url)
    }).then((registered) => {
      if (disposed) void registered.remove()
      else handle = registered
    })

    return () => {
      disposed = true
      void handle?.remove()
    }
  }, [adapter, settle])

  const run = useCallback(
    async <T>(action: () => Promise<T>, onDone?: (value: T) => void): Promise<boolean> => {
      setBusy(true)
      setError(null)
      setNotice(null)
      try {
        const value = await action()
        onDone?.(value)
        return true
      } catch (actionError: unknown) {
        if (mounted.current) setError(describe(actionError))
        return false
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [],
  )

  const signIn = useCallback(
    (email: string, password: string) =>
      run(() => adapter.signIn(email, password), (next) => settle(next)),
    [adapter, run, settle],
  )

  const signUp = useCallback(
    (input: SignUpInput) =>
      run(
        () => adapter.signUp(input),
        (result) => {
          if (mounted.current) {
            setNotice(
              result.verificationRequired
                ? '验证邮件已发出，点开链接后回来登录'
                : '注册成功，可以登录了',
            )
          }
        },
      ),
    [adapter, run],
  )

  const requestPasswordReset = useCallback(
    (email: string) =>
      run(
        () => adapter.requestPasswordReset(email),
        () => {
          if (mounted.current) setNotice('重置邮件已发出，请查收')
        },
      ),
    [adapter, run],
  )

  const resendVerification = useCallback(
    (email: string) =>
      run(
        () => adapter.resendVerificationEmail(email),
        () => {
          if (mounted.current) setNotice('验证邮件已重新发送')
        },
      ),
    [adapter, run],
  )

  const signInWithSocial = useCallback(
    (provider: SocialProvider) =>
      run(
        () => adapter.startSocialSignIn(provider),
        (mode) => {
          if (mode === 'external' && mounted.current) setNotice('已打开浏览器，完成后会自动回到应用')
        },
      ),
    [adapter, run],
  )

  const linkSocial = useCallback(
    (provider: SocialProvider) =>
      run(
        () => adapter.linkSocial(provider),
        (mode) => {
          if (mode === 'external' && mounted.current) setNotice('已打开浏览器，完成后会自动回到应用')
        },
      ),
    [adapter, run],
  )

  const signOut = useCallback(async () => {
    await run(() => adapter.signOut())
    settle(null)
  }, [adapter, run, settle])

  const refresh = useCallback(async () => {
    try {
      settle(await adapter.refresh())
    } catch (refreshError: unknown) {
      log.account.debug('session refresh failed', { refreshError })
    }
  }, [adapter, settle])

  const clearMessages = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  return {
    adapter,
    status,
    session,
    busy,
    error,
    notice,
    clearMessages,
    signIn,
    signUp,
    requestPasswordReset,
    resendVerification,
    signInWithSocial,
    linkSocial,
    signOut,
    refresh,
    socialSignInProviders,
    emailSignUpEnabled,
  }
}
