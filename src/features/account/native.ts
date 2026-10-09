import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * Android Keystore 支撑的安全存储。明文只在内存里出现，落盘的是
 * AndroidKeyStore AES-GCM 密文（见 `SecureStorePlugin.java`）。
 */
export interface SecureStorePlugin {
  set(options: { key: string; value: string }): Promise<void>
  get(options: { key: string }): Promise<{ value: string | null }>
  remove(options: { key: string }): Promise<void>
}

export const SecureStoreNative = registerPlugin<SecureStorePlugin>('SecureStore')

/** 只有装了原生插件的 Android 包才有真正的 Keystore；Web/旧包退回内存实现 */
export function isSecureStoreAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SecureStore')
}
