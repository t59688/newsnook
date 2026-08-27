/**
 * 云端 base URL。同步可选：未配置或不可达时客户端仍可本地阅读。
 *
 * 正式包 / 本机开发请注入 `VITE_CLOUD_BASE_URL`：
 * 本机用根目录 `.env.local`（dev 与 production build 都会加载）；
 * CI / Pages 用同名环境变量。下方默认仅为占位，勿把真实生产地址写进仓库。
 */

export const DEFAULT_CLOUD_BASE_URL = 'https://cloud.example.com'

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

export function resolveCloudBaseUrl(): string {
  const configured = import.meta.env?.VITE_CLOUD_BASE_URL
  const value = typeof configured === 'string' ? configured.trim() : ''
  return trimTrailingSlash(value || DEFAULT_CLOUD_BASE_URL)
}
