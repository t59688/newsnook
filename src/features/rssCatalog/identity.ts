import { DEFAULT_RSSHUB_INSTANCES, isSensitiveRssHubRoute, validateRssHubRoutePath } from '../rsshub/instances'

/** A published catalog stores executable endpoints only as ordinary HTTPS URLs;
 * RSSHub paths are metadata interpreted by the existing trusted instance manager. */
const knownInstanceHosts = new Map(DEFAULT_RSSHUB_INSTANCES.map(
  (instance) => [new URL(instance.url).hostname, instance.enabled ? instance.id : undefined] as const,
))

export interface CatalogCreatorIdentity {
  routePath: string
  instanceId?: string
  platform: string
  creatorId?: string
  siteUrl?: string
}

export function catalogCreatorIdentity(
  feed: { url: string; rsshubRoute?: string; platform?: string; creatorId?: string },
): CatalogCreatorIdentity | null {
  let url: URL
  try { url = new URL(feed.url) } catch { return null }
  if (!knownInstanceHosts.has(url.hostname) && !feed.rsshubRoute) return null
  const instanceId = knownInstanceHosts.get(url.hostname)
  let routePath: string
  try {
    routePath = validateRssHubRoutePath(feed.rsshubRoute ?? url.pathname + url.search)
  } catch { return null }
  if (isSensitiveRssHubRoute(routePath)) return null
  const parts = routePath.split('?')[0].split('/').filter(Boolean)
  if (parts.length < 2) return null
  const platform = feed.platform ?? parts[0]
  let creatorId = feed.creatorId
  if (!creatorId) {
    if (parts[0] === 'bilibili' && parts[1] === 'user' && ['video', 'dynamic', 'article'].includes(parts[2])) creatorId = parts[3]
    else if (parts[0] === 'youtube' && parts[1] === 'channel') creatorId = parts[2]
    else if (parts[0] === 'telegram' && parts[1] === 'channel') creatorId = parts[2]
  }
  const siteUrl = platform === 'bilibili' && creatorId && /^\d{1,20}$/.test(creatorId)
    ? 'https://space.bilibili.com/' + creatorId
    : platform === 'youtube' && creatorId && /^UC[A-Za-z\d_-]{22}$/.test(creatorId)
      ? 'https://www.youtube.com/channel/' + creatorId
      : undefined
  return { routePath, instanceId, platform, creatorId, siteUrl }
}
