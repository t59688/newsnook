/**
 * Android 认证回流深链：`newsnook://auth/callback?ott=<一次性 token>`。
 *
 * 与分享深链 `newsnook://a/<token>` 共用同一个 scheme，所以这里必须严格匹配
 * `auth/callback` 这一条路径，绝不能把分享 token 当成认证 token（反之亦然）。
 * 与 `lib/appDeepLink` 一样手工剥前缀：旧 WebView 的 `new URL()` 对非特殊
 * scheme 解析行为不稳定。
 */

import { MOBILE_AUTH_CALLBACK_URL } from '@newsnook/contracts/protocol'

const CALLBACK_PREFIX = MOBILE_AUTH_CALLBACK_URL.toLowerCase()

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

/** 只认认证回调深链；分享链接、其他 host、缺少 ott 一律返回 null */
export function oneTimeTokenFromAppUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const lower = trimmed.toLowerCase()
  if (!lower.startsWith(CALLBACK_PREFIX)) return null

  const rest = trimmed.slice(MOBILE_AUTH_CALLBACK_URL.length)
  // 前缀之后只允许直接跟查询串/锚点/结尾斜杠，`newsnook://auth/callbackfoo` 不算
  if (rest && !/^[/?#]/.test(rest)) return null

  const query = rest.split('#')[0]?.split('?')[1] ?? ''
  if (!query) return null

  for (const part of query.split('&')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator) !== 'ott') continue
    const token = decodeComponent(part.slice(separator + 1)).trim()
    return token || null
  }
  return null
}

/** 是否是认证深链（哪怕缺少 ott）：用于和分享深链分流，避免互相误处理 */
export function isAuthCallbackUrl(url: string): boolean {
  const lower = url.trim().toLowerCase()
  if (!lower.startsWith(CALLBACK_PREFIX)) return false
  const rest = lower.slice(CALLBACK_PREFIX.length)
  return !rest || /^[/?#]/.test(rest)
}
