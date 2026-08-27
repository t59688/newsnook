/**
 * Better Auth 装配。密码哈希、邮箱验证、找回密码、OAuth callback、账号记录
 * 全部交给 Better Auth，本仓库不自己实现任何一项安全敏感逻辑。
 *
 * 关键策略：
 * - 同邮箱的第三方身份**不隐式合并**（`disableImplicitLinking`），只允许已登录用户显式绑定
 * - Android 走 bearer（token 只落 Keystore-backed secure store），Web 继续 Cookie Session
 * - 社交登录回流用一次性 token 交接，长期 Session 不出现在深链里
 */

import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins/bearer'
import { oneTimeToken } from 'better-auth/plugins/one-time-token'
import type { Pool } from 'pg'

import { MOBILE_AUTH_CALLBACK_URL } from '@newsnook/contracts'

import type { CloudConfig } from './config.js'
import type { Mailer } from './mail.js'

export interface CreateAuthOptions {
  config: CloudConfig
  pool: Pool
  mailer: Mailer
}

/** 一次性 token 的有效期（分钟）；只够浏览器跳回 App 完成一次交换 */
export const MOBILE_OTT_EXPIRES_IN_MINUTES = 3

/**
 * 返回类型刻意保持推断：Better Auth 的 `api` 形状由启用的插件决定，
 * 写成 `Auth<BetterAuthOptions>` 会把 bearer / one-time-token 的端点擦掉。
 */
export function createAuth(options: CreateAuthOptions) {
  const { config, pool, mailer } = options

  const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {}
  if (config.google) socialProviders.google = config.google
  if (config.github) socialProviders.github = config.github

  return betterAuth({
    appName: 'NewsNook',
    baseURL: config.betterAuthUrl,
    basePath: '/api/auth',
    secret: config.betterAuthSecret,
    database: pool,
    // 明确白名单，OAuth 回跳与 CORS 都以此为准
    trustedOrigins: [...config.clientOrigins, 'newsnook://'],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.requireEmailVerification,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: '重置你的「有所闻」密码',
          text: `打开下面的链接重置密码，链接短时间内有效：\n\n${url}\n\n如果不是你本人操作，忽略这封邮件即可。`,
          url,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: '验证你的「有所闻」邮箱',
          text: `打开下面的链接完成邮箱验证：\n\n${url}\n\n验证后即可在多台设备间同步订阅与配置。`,
          url,
        })
      },
    },
    account: {
      // 同邮箱不静默合并：第三方身份必须由已登录账号显式绑定
      accountLinking: { disableImplicitLinking: true },
    },
    socialProviders,
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        secure: config.betterAuthUrl.startsWith('https://'),
        sameSite: 'lax',
      },
    },
    plugins: [
      bearer(),
      oneTimeToken({
        expiresIn: MOBILE_OTT_EXPIRES_IN_MINUTES,
        storeToken: 'hashed',
        // 只允许服务端在 /api/v1/auth/mobile/complete 里签发
        disableClientRequest: true,
      }),
    ],
  })
}

export type NewsNookAuth = ReturnType<typeof createAuth>

export { MOBILE_AUTH_CALLBACK_URL }
