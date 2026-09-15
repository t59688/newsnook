import { getSecureStore } from '../account/secureStore'
import { isZhihuAuthAvailable, ZhihuAuthNative } from './native'
import type { ZhihuSession } from './types'

const ZHIHU_SESSION_KEY = 'site.zhihu.session.v1'
const REQUIRED_LOGIN_COOKIES = ['d_c0', 'z_c0'] as const

export function parseCookieHeader(raw: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  for (const part of raw.split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key && value) cookies[key] = value
  }
  return cookies
}

export function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter(([key, value]) => Boolean(key && value))
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')
}

export function isUsableZhihuSession(session: ZhihuSession | null | undefined): session is ZhihuSession {
  return Boolean(
    session &&
      session.version === 1 &&
      REQUIRED_LOGIN_COOKIES.every((key) => Boolean(session.cookies[key])) &&
      session.userAgent,
  )
}

export async function readZhihuSession(): Promise<ZhihuSession | null> {
  const raw = await getSecureStore().get(ZHIHU_SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ZhihuSession
    return isUsableZhihuSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function writeZhihuSession(session: ZhihuSession): Promise<void> {
  if (!isUsableZhihuSession(session)) throw new Error('知乎登录态缺少必要 Cookie')
  await getSecureStore().set(ZHIHU_SESSION_KEY, JSON.stringify(session))
}

export async function clearZhihuSession(): Promise<void> {
  await getSecureStore().remove(ZHIHU_SESSION_KEY)
}

export async function loginZhihu(url = 'https://www.zhihu.com/signin'): Promise<ZhihuSession> {
  if (!isZhihuAuthAvailable()) throw new Error('知乎网页登录目前仅支持 Android App')
  const result = await ZhihuAuthNative.login({ url })
  const session: ZhihuSession = {
    version: 1,
    cookies: parseCookieHeader(result.cookie),
    userAgent: result.userAgent,
    capturedAt: Date.now(),
  }
  await writeZhihuSession(session)
  return session
}
