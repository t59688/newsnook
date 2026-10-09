import type {
  LinuxDoCategory,
  LinuxDoTag,
  LinuxDoTopicOrder,
  LinuxDoTopicSummary,
} from '../types'
import type { LinuxDoDiscoveryScope } from './discoveryScope'

export type LinuxDoDiscoverTab = 'featured' | 'categories' | 'tags'

export interface LinuxDoDiscoveryScopeCacheEntry {
  scope: LinuxDoDiscoveryScope
  order: LinuxDoTopicOrder
  items: LinuxDoTopicSummary[]
  page: number
  hasMore: boolean
  scrollTop: number
}

export interface LinuxDoDiscoveryCache {
  hub: {
    activeTab: LinuxDoDiscoverTab
    tagQuery: string
    scrollTop: number
  }
  taxonomyLoaded: boolean
  categories: LinuxDoCategory[]
  tags: LinuxDoTag[]
  scopes: Record<string, LinuxDoDiscoveryScopeCacheEntry>
}

export function createLinuxDoDiscoveryCache(): LinuxDoDiscoveryCache {
  return {
    hub: { activeTab: 'featured', tagQuery: '', scrollTop: 0 },
    taxonomyLoaded: false,
    categories: [],
    tags: [],
    scopes: {},
  }
}
