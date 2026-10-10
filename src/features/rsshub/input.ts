/** RSSHub logical URI is a route identifier, not an HTTP endpoint. */
import { validateRssHubRoutePath } from './instances'

export interface RssHubLogicalInput {
  routePath: string
  originalInput: string
}

export function parseRssHubLogicalInput(raw: string): RssHubLogicalInput | null {
  const value = raw.trim()
  if (!/^rsshub:\/\//i.test(value)) return null
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(value)) throw new Error('RSSHub 路由包含非法路径')
  let url: URL
  try { url = new URL(value) } catch { throw new Error('RSSHub 路由地址格式无效') }
  if (url.protocol !== 'rsshub:' || url.username || url.password || url.port || url.hash ||
      !/^[a-z][a-z\d_-]{0,80}$/i.test(url.hostname)) {
    throw new Error('RSSHub 逻辑地址无效，请输入 rsshub://站点/路由')
  }
  const routePath = validateRssHubRoutePath('/' + url.hostname + url.pathname + url.search)
  if (routePath.split('?')[0].split('/').filter(Boolean).length < 2) {
    throw new Error('RSSHub 逻辑地址需要包含具体路由')
  }
  return { routePath, originalInput: value }
}

/** Human-readable fallback for a directly pasted logical route; never claims a live Feed. */
export function describeRssHubRoute(path: string): string {
  const parts = path.split('?')[0].split('/').filter(Boolean)
  if (parts[0] === 'bilibili' && parts[1] === 'user') {
    const names: Record<string, string> = {
      video: 'UP 主投稿视频', dynamic: 'UP 主动态', article: 'UP 主图文',
    }
    return names[parts[2]] ?? 'B 站 UP 主订阅'
  }
  return 'RSSHub · ' + parts.slice(0, 3).join(' / ')
}
