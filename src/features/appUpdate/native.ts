import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export type AppUpdateDownloadStatus =
  | 'pending'
  | 'running'
  | 'successful'
  | 'failed'
  | 'unknown'

export type AppUpdateFailureKind = 'download' | 'install'

type AppUpdatePlugin = {
  getSupportedAbis(): Promise<{ abis: string[] }>
  canInstallPackages(): Promise<{ value: boolean }>
  openInstallSettings(): Promise<void>
  startDownload(options: {
    url: string
    fileName: string
    sha256?: string
    size?: number
  }): Promise<{ downloadId: number }>
  getDownloadStatus(options: {
    downloadId: number
  }): Promise<{ status: AppUpdateDownloadStatus; localUri?: string }>
  installDownloaded(options: { downloadId: number }): Promise<void>
  addListener(
    eventName: 'downloadComplete',
    listenerFunc: (payload: { downloadId: number }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'downloadFailed',
    listenerFunc: (payload: {
      downloadId: number
      message?: string
      kind?: AppUpdateFailureKind
    }) => void,
  ): Promise<PluginListenerHandle>
}

export const AppUpdateNative = registerPlugin<AppUpdatePlugin>('AppUpdate')
