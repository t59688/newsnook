import type { FeedDiscoveryEntry } from '../feedDiscovery/types'
import type { CatalogFeed } from './schema'
import { catalogCreatorIdentity } from './identity'

/** Catalog entries use the same RSSHub preview/subscription flow as online discovery. */
export function catalogEntryFor(feed: CatalogFeed): FeedDiscoveryEntry {
  const creator = catalogCreatorIdentity(feed)
  const basic = { providerId: 'rss-catalog', entryId: feed.id, title: feed.title, feedUrl: feed.url,
    categories: [feed.category], description: [feed.region, ...feed.tags].join(' · '),
    statusNote: '本地目录可离线查找，预览与订阅时再联网检测。' }
  if (!creator) return { ...basic, type: 'direct' }
  return { ...basic, type: 'rsshub', routeTemplate: creator.routePath, routePath: creator.routePath,
    instanceId: creator.instanceId, siteUrl: creator.siteUrl }
}
