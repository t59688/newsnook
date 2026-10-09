/** RSSHub 服务实例：只保存公开 HTTPS origin，不接收凭据或私网地址。 */
export interface RssHubInstance {
  id: string
  name: string
  url: string
  enabled: boolean
  builtin?: boolean
}

export const DEFAULT_RSSHUB_INSTANCES: readonly RssHubInstance[] = [
  { id: 'isrss', name: 'isRSS', url: 'https://rsshub.isrss.com', enabled: true, builtin: true },
  { id: 'cups', name: 'FunnyCups', url: 'https://rsshub.cups.moe', enabled: true, builtin: true },
  { id: 'slarker', name: 'Slarker', url: 'https://hub.slarker.me', enabled: true, builtin: true },
  { id: 'rssforever', name: 'RSSForever', url: 'https://rsshub.rssforever.com', enabled: true, builtin: true },
  { id: 'official-demo', name: 'RSSHub 官方演示', url: 'https://rsshub.app', enabled: false, builtin: true },
]

const BLOCKED_HOST = /(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$|\.onion$|\.lan$)/i
const IP_LITERAL = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[.*\])$/

/** 公共 Web 代理会请求该实例，故只接受公网域名的 HTTPS origin。 */
export function normalizeRssHubInstanceUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('请输入完整的 HTTPS 服务地址') }
  const host = url.hostname.toLowerCase()
  if (
    url.protocol !== 'https:' || !host.includes('.') || BLOCKED_HOST.test(host) ||
    IP_LITERAL.test(host) || url.username || url.password || url.port && url.port !== '443' ||
    url.search || url.hash || !['', '/'].includes(url.pathname) || raw.length > 300
  ) {
    throw new Error('仅支持公网 HTTPS 域名，不能包含路径、端口、查询参数或凭据')
  }
  return url.origin
}

export function normalizeRssHubInstances(raw: unknown): RssHubInstance[] {
  const rows = Array.isArray(raw) ? raw : []
  const byId = new Map<string, RssHubInstance>()
  for (const defaultInstance of DEFAULT_RSSHUB_INSTANCES) {
    const override = rows.find((row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && row.id === defaultInstance.id,
    )
    byId.set(defaultInstance.id, { ...defaultInstance, enabled: override ? override.enabled === true : defaultInstance.enabled })
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id.startsWith('custom:') || typeof item.url !== 'string') continue
    try {
      const url = normalizeRssHubInstanceUrl(item.url)
      if ([...byId.values()].some((instance) => instance.url === url) || byId.size >= 24) continue
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 40) : ''
      byId.set(item.id.slice(0, 140), {
        id: item.id.slice(0, 140), name: name || new URL(url).hostname, url, enabled: item.enabled === true,
      })
    } catch { /* reject imported invalid / private targets */ }
  }
  return [...byId.values()]
}

export function addRssHubInstance(instances: RssHubInstance[], rawUrl: string, name = ''): RssHubInstance[] {
  const url = normalizeRssHubInstanceUrl(rawUrl)
  const list = normalizeRssHubInstances(instances)
  if (list.some((item) => item.url === url)) throw new Error('该实例已经添加')
  if (list.length >= 24) throw new Error('实例数量已达到上限（24）')
  const id = 'custom:' + new URL(url).hostname
  return [...list, { id, name: name.trim().slice(0, 40) || new URL(url).hostname, url, enabled: true }]
}

export function changeRssHubInstanceEnabled(instances: RssHubInstance[], id: string, enabled: boolean): RssHubInstance[] {
  return normalizeRssHubInstances(instances).map((item) => item.id === id ? { ...item, enabled } : item)
}

export function removeRssHubInstance(instances: RssHubInstance[], id: string): RssHubInstance[] {
  return normalizeRssHubInstances(instances).filter((item) => item.builtin || item.id !== id)
}

export function validateRssHubRoutePath(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 700 ||
      /[\\<>\s"']/.test(raw) || [...raw].some((char) => char.charCodeAt(0) < 32)) {
    throw new Error('RSSHub 路由格式无效')
  }
  // 路由路径不能变成另一个目标 URL，也不能包含需要执行的表达式。
  const path = raw.split('?')[0]
  for (const segment of path.split('/')) {
    let decoded: string
    try { decoded = decodeURIComponent(segment) } catch { throw new Error('RSSHub 路由编码无效') }
    if (decoded === '.' || decoded === '..' || /[\\/]/.test(decoded)) {
      throw new Error('RSSHub 路由路径无效')
    }
  }
  if (/%00/i.test(raw) || /(?:=>|\$\{|\bfunction\b|\/\/)/.test(raw)) throw new Error('RSSHub 路由包含不支持的表达式')
  return raw
}

export function rssHubFeedUrl(instance: RssHubInstance, routePath: string): string {
  return normalizeRssHubInstanceUrl(instance.url) + validateRssHubRoutePath(routePath)
}

/** 未知查询参数可能包含私有凭据：跨第三方实例只允许明确无害的选项。 */
export function isSensitiveRssHubRoute(path: string): boolean {
  const pieces = path.split(/[/?&#=]/)
  if (pieces.some((piece) => /^(?:key|api[_-]?key|token|access[_-]?token|secret|cookie|password|passwd|authorization|auth|session|sessionid|sid|credential|credential_id)$/i.test(piece))) return true
  try {
    const url = new URL(path, 'https://rsshub.local')
    for (const key of url.searchParams.keys()) {
      if (!/^(?:format|limit|count|page|sort|mode|lang|language|category|type)$/i.test(key)) return true
    }
  } catch { return true }
  return false
}
