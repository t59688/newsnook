/**
 * 账户相关 DTO。认证协议本身由 Better Auth 承担，这里只描述 NewsNook 自有的
 * `/api/v1` 边界：当前用户、Android Session 交接。
 */

import { z } from 'zod'

import { MOBILE_AUTH_CALLBACK_URL, SOCIAL_OAUTH_PROVIDER_IDS } from './protocol.js'
import { devicePlatformSchema, uuidSchema } from './sync.js'

export { MOBILE_AUTH_CALLBACK_URL }

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string().nullable(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
  }),
  /** 已绑定的登录方式：`credential` = 邮箱密码，其余为 OAuth provider id */
  linkedProviders: z.array(z.string()),
  device: z
    .object({
      id: uuidSchema,
      platform: devicePlatformSchema,
      revoked: z.boolean(),
    })
    .nullable(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

/** 未登录也可读：当前云端启用的登录能力 */
export const authConfigResponseSchema = z.object({
  socialSignIn: z.array(z.enum(SOCIAL_OAUTH_PROVIDER_IDS)),
  /** 是否开放邮箱密码注册 */
  emailSignUp: z.boolean(),
})
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>

/**
 * Android 社交登录回流：系统浏览器完成 Better Auth callback 后带 Cookie 命中
 * `/api/v1/auth/mobile/complete`，服务端签发一次性 token 并 302 回固定深链
 * （`MOBILE_AUTH_CALLBACK_URL`，定义在无 zod 依赖的 `./protocol`）。
 * 长期 Session token 绝不出现在深链里。
 */
export const mobileExchangeRequestSchema = z.object({
  token: z.string().min(8).max(200),
})
export type MobileExchangeRequest = z.infer<typeof mobileExchangeRequestSchema>

export const mobileExchangeResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.number().int().nonnegative(),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    name: z.string().nullable(),
  }),
})
export type MobileExchangeResponse = z.infer<typeof mobileExchangeResponseSchema>
