/**
 * 云端地址。同步是可选能力，所以这里给的是「部署方可覆盖的默认值」而不是硬依赖：
 * 构建时用 `VITE_CLOUD_BASE_URL` 指向自己的 NewsNook Cloud，
 * 未配置时退回官方实例；服务不可达时客户端照常本地阅读。
 */

export const DEFAULT_CLOUD_BASE_URL = 'https://cloud.aizeek.com'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function resolveCloudBaseUrl(): string {
  const configured = import.meta.env?.VITE_CLOUD_BASE_URL
  const value = typeof configured === 'string' ? configured.trim() : ''
  return trimTrailingSlash(value || DEFAULT_CLOUD_BASE_URL)
}
