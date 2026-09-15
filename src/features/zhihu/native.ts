import { Capacitor, registerPlugin } from '@capacitor/core'

interface ZhihuAuthResult {
  cookie: string
  userAgent: string
  url?: string
}

interface ZhihuAuthPlugin {
  login(options?: { url?: string }): Promise<ZhihuAuthResult>
}

export const ZhihuAuthNative = registerPlugin<ZhihuAuthPlugin>('ZhihuAuth')

export function isZhihuAuthAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ZhihuAuth')
}
