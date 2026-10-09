import type { LinuxDoSessionSnapshot } from '../types'
import { verifyLinuxDoBrowserSession } from './native'

/**
 * Open Linux.do's own login surface inside the isolated Android WebView.
 *
 * Linux.do protects `/session/csrf` and `/session.json` with Cloudflare and
 * hCaptcha. Sending credentials through a generic native HTTP client is both
 * brittle and unable to complete those browser challenges. Keeping the entire
 * flow on the first-party page also means NewsNook never reads the password or
 * second-factor secret.
 */
export async function loginLinuxDoWithPassword(): Promise<LinuxDoSessionSnapshot> {
  const session = await verifyLinuxDoBrowserSession('https://linux.do/login')
  if (!session.authenticated) {
    throw new Error('尚未检测到 Linux.do 登录会话，请在官方页面完成登录后再点“完成”')
  }
  return { ...session, authMode: 'browser-session' }
}
