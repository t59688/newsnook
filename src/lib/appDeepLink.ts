/**
 * 「在 App 中打开」与 Android 深链工具。
 *
 * 分享短链 `https://news.aizeek.com/a/<token>` 与自定义 scheme
 * `newsnook://a/<token>` 共用同一个 token（编解码见 `lib/shareToken`）。
 * Android 壳在 `AndroidManifest.xml` 里为两种形式都注册了 VIEW intent-filter，
 * App 侧经 Capacitor 的 launchUrl / appUrlOpen 拿到 URL 后在这里还原 token。
 *
 * 网页落地页据此给 Android 用户一条「在有所闻 App 中打开」的引导：
 * Chromium 系浏览器用 `intent://`（不带 fallback，未安装时点击无事发生，
 * 继续网页阅读，不强跳应用商店），其余浏览器退回自定义 scheme。
 * 微信内置浏览器禁止唤起第三方 App，引导条干脆不出现。全程无后端、无安装探测。
 */

import {
  SHARE_LINK_HOST,
  SHARE_PATH_PREFIX,
  decodeShareToken,
  shareTokenFromPath,
  type SharePayload,
} from './shareToken'

/** 与 android/app/build.gradle 的 applicationId、capacitor.config.ts 的 appId 同源 */
export const ANDROID_APP_ID = 'com.aizeek.newsnook'
export const APP_LINK_SCHEME = 'newsnook'

const SCHEME_SHARE_PREFIX = `${APP_LINK_SCHEME}:/${SHARE_PATH_PREFIX}`

/** `newsnook://a/<token>`：非 Chromium 浏览器的唤起链接，App 内部解析也认它 */
export function appSchemeShareUrl(token: string): string {
  return `${SCHEME_SHARE_PREFIX}${token}`
}

/**
 * Android Chrome 的 intent:// 深链。故意不带 `S.browser_fallback_url`：
 * 未安装 App 时 Chrome 什么都不做，用户留在网页里继续读，属于温和降级。
 */
export function androidIntentShareUrl(token: string): string {
  return `intent://${SHARE_LINK_HOST}${SHARE_PATH_PREFIX}${token}#Intent;scheme=https;package=${ANDROID_APP_ID};end`
}

/**
 * App 唤起入口（Capacitor launchUrl / appUrlOpen）：
 * https App Links 与自定义 scheme 都还原成同一个 token。
 * 自定义 scheme 不走 `new URL()`——旧 WebView 对非特殊 scheme 的解析行为不稳，
 * 手工剥前缀更可靠；https 只认生产 host，别的域名不当分享深链。
 */
export function shareTokenFromAppUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  if (trimmed.toLowerCase().startsWith(SCHEME_SHARE_PREFIX.toLowerCase())) {
    const token = trimmed
      .slice(SCHEME_SHARE_PREFIX.length)
      .split(/[?#]/)[0]
      .replace(/\/+$/, '')
    return token && !token.includes('/') ? token : null
  }

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.hostname !== SHARE_LINK_HOST) return null
    return shareTokenFromPath(parsed.pathname)
  } catch {
    return null
  }
}

/** 深链 URL 一步到 payload；token 损坏返回 null，由调用方弹中文提示 */
export function sharePayloadFromAppUrl(url: string): SharePayload | null {
  const token = shareTokenFromAppUrl(url)
  return token ? decodeShareToken(token) : null
}

/**
 * 引导条只对 Android 浏览器展示：iOS 没有对应 App；
 * 微信 / 企业微信内置浏览器禁止唤起第三方 App，展示了也只会点了没反应。
 */
export function isAndroidBrowser(userAgent: string): boolean {
  if (!/android/i.test(userAgent)) return false
  if (/micromessenger|wxwork/i.test(userAgent)) return false
  return true
}

/** Chromium 系走 intent://（可指定包名），其余浏览器尝试自定义 scheme */
export function preferredOpenInAppUrl(token: string, userAgent: string): string {
  return /chrome\/\d+/i.test(userAgent)
    ? androidIntentShareUrl(token)
    : appSchemeShareUrl(token)
}
