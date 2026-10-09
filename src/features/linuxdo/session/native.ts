import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import type { LinuxDoSessionSnapshot } from '../types'

export interface LinuxDoNativeResponse {
  status: number
  data: string
  headers?: Record<string, string>
  transport?: 'native' | 'browser' | 'browser-firstparty'
  responseUrl?: string
}

export interface LinuxDoBrowserPreparation {
  ready: boolean
  username?: string
  userId?: number
  csrf?: string
  reason?: string
  phase?: 'session' | 'csrf'
  status?: number
}

interface LinuxDoSessionPlugin {
  prepareBrowserSession(): Promise<LinuxDoBrowserPreparation>
  authenticate(options?: { url?: string; readSyncChallenge?: boolean }): Promise<LinuxDoSessionSnapshot>
  authenticateUserApiKey(): Promise<LinuxDoSessionSnapshot>
  cancelUserApiKeyAuth(): Promise<void>
  clearUserApiKey(): Promise<void>
  snapshot(): Promise<LinuxDoSessionSnapshot>
  browserSnapshot(): Promise<LinuxDoSessionSnapshot>
  request(options: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>; body?: string; browserOnly?: boolean }): Promise<LinuxDoNativeResponse>
  fetchConnectTrustPage(): Promise<{ status: number; data: string; finalUrl: string; headers?: Record<string, string> }>
  beginUpload(options: { fileName: string; mimeType: string }): Promise<{ uploadId: string }>
  appendUploadChunk(options: { uploadId: string; base64: string }): Promise<{ bytesWritten: number }>
  finishUpload(options: { uploadId: string }): Promise<Record<string, unknown>>
  cancelUpload(options: { uploadId: string }): Promise<void>
  addListener(eventName: 'linuxDoUploadProgress', listener: (event: { uploadId: string; sentBytes: number; totalBytes: number; progress: number }) => void): Promise<PluginListenerHandle>
  clearBrowserSession(): Promise<void>
}

const NativeLinuxDoSession = registerPlugin<LinuxDoSessionPlugin>('LinuxDoSession')

export async function authenticateLinuxDo(): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Linux.do 登录与互动功能需要在 NewsNook App 中使用')
  }
  return NativeLinuxDoSession.authenticateUserApiKey()
}

export async function cancelLinuxDoAuthentication(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.cancelUserApiKeyAuth()
}

export async function verifyLinuxDoBrowserSession(url = 'https://linux.do/', options?: { readSyncChallenge?: boolean }): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    throw new Error('浏览器端无法安全复用 Linux.do 登录会话；请在 NewsNook App 中使用')
  }
  return NativeLinuxDoSession.authenticate({ url, ...options })
}

export async function readLinuxDoSession(): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) return { authenticated: false, authMode: 'none' }
  return NativeLinuxDoSession.snapshot()
}

export async function readLinuxDoBrowserSession(): Promise<LinuxDoSessionSnapshot> {
  if (!Capacitor.isNativePlatform()) return { authenticated: false, authMode: 'none' }
  return NativeLinuxDoSession.browserSnapshot()
}

export async function requestLinuxDoNative(options: { url: string; method: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>; body?: string; browserOnly?: boolean }): Promise<LinuxDoNativeResponse> {
  if (!Capacitor.isNativePlatform()) throw new Error('Linux.do 原生请求仅可在 App 内使用')
  return NativeLinuxDoSession.request(options)
}

export async function prepareLinuxDoBrowserSession(): Promise<LinuxDoBrowserPreparation> {
  if (!Capacitor.isNativePlatform()) return { ready: false, reason: 'unsupported' }
  return NativeLinuxDoSession.prepareBrowserSession()
}

export async function fetchLinuxDoConnectTrustPage(): Promise<{ status: number; data: string; finalUrl: string; headers?: Record<string, string> }> {
  if (!Capacitor.isNativePlatform()) throw new Error('Linux.do Connect 仅可在 App 内使用')
  return NativeLinuxDoSession.fetchConnectTrustPage()
}

export async function uploadLinuxDoFile(file: File, onProgress?: (progress: number) => void): Promise<Record<string, unknown>> {
  if (!Capacitor.isNativePlatform()) throw new Error('Linux.do 上传需要原生应用')
  const { uploadId } = await NativeLinuxDoSession.beginUpload({
    fileName: file.name || 'upload.bin',
    mimeType: file.type || 'application/octet-stream',
  })
  const chunkSize = 256 * 1024
  let progressListener: PluginListenerHandle | undefined
  try {
    progressListener = await NativeLinuxDoSession.addListener('linuxDoUploadProgress', (event) => {
      if (event.uploadId !== uploadId) return
      const networkProgress = Number.isFinite(event.progress) ? Math.max(0, Math.min(1, event.progress)) : 0
      // 15% is staging the browser File into native storage; 80% is the real
      // multipart upload; the last 5% is server response/cook confirmation.
      onProgress?.(0.15 + networkProgress * 0.8)
    })
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + chunkSize)).arrayBuffer())
      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }
      await NativeLinuxDoSession.appendUploadChunk({ uploadId, base64: btoa(binary) })
      onProgress?.(file.size ? Math.min(0.15, ((offset + bytes.length) / file.size) * 0.15) : 0.15)
    }
    onProgress?.(0.15)
    const result = await NativeLinuxDoSession.finishUpload({ uploadId })
    onProgress?.(1)
    return result
  } catch (error) {
    await NativeLinuxDoSession.cancelUpload({ uploadId }).catch(() => undefined)
    throw error
  } finally {
    await progressListener?.remove().catch(() => undefined)
  }
}

export async function clearLinuxDoSession(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.clearUserApiKey()
}

export async function clearLinuxDoBrowserSession(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await NativeLinuxDoSession.clearBrowserSession()
}
