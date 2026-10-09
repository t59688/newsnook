import { Capacitor, registerPlugin } from '@capacitor/core'

import type { ZhihuStoredAccount } from './types'

interface NativeAuthResult {
  accountId: string
  name?: string
  urlToken?: string
  avatarUrl?: string
  headline?: string
  wwwCookie: string
  apiCookie: string
  userAgent?: string
  profileJson?: string
}

interface ZhihuSessionNativePlugin {
  authenticate(options: {
    url?: string
    wwwCookie?: string
    apiCookie?: string
  }): Promise<NativeAuthResult>
  clearBrowserSession(): Promise<void>
}

const NativeZhihuSession = registerPlugin<ZhihuSessionNativePlugin>('ZhihuSession')

export function isNativeZhihuSessionAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ZhihuSession')
}

export async function authenticateZhihuNative(options: {
  url?: string
  resume?: ZhihuStoredAccount | null
} = {}): Promise<ZhihuStoredAccount> {
  if (!isNativeZhihuSessionAvailable()) {
    throw new Error('当前平台没有知乎原生认证桥')
  }
  const result = await NativeZhihuSession.authenticate({
    url: options.url,
    wwwCookie: options.resume?.wwwCookie,
    apiCookie: options.resume?.apiCookie,
  })
  if (!result.accountId || (!result.wwwCookie && !result.apiCookie)) {
    throw new Error('知乎认证完成但没有返回有效账号会话')
  }
  return {
    account: {
      id: result.accountId,
      name: result.name || undefined,
      urlToken: result.urlToken || undefined,
      avatarUrl: result.avatarUrl || undefined,
      headline: result.headline || undefined,
    },
    wwwCookie: result.wwwCookie ?? '',
    apiCookie: result.apiCookie ?? '',
    userAgent: result.userAgent?.trim() || undefined,
    profileJson: result.profileJson || undefined,
    updatedAt: Date.now(),
  }
}

export async function clearZhihuNativeBrowserSession(): Promise<void> {
  if (!isNativeZhihuSessionAvailable()) return
  await NativeZhihuSession.clearBrowserSession()
}
