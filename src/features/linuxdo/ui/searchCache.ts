import type { LinuxDoCategory, LinuxDoTag, LinuxDoPost, LinuxDoTopicSummary, LinuxDoUser } from '../types'

export type LinuxDoSearchTab = 'posts' | 'categories' | 'users'

export interface LinuxDoSearchCache {
  query: string
  lastQuery: string
  topics: LinuxDoTopicSummary[]
  posts: LinuxDoPost[]
  users: LinuxDoUser[]
  categories: LinuxDoCategory[]
  tags: LinuxDoTag[]
  tabs: Partial<Record<LinuxDoSearchTab, Omit<LinuxDoSearchCache, 'tabs'>>>
  activeTab: LinuxDoSearchTab
  page: number
  hasMore: boolean
  scrollTop: number
}

export function createLinuxDoSearchCache(): LinuxDoSearchCache {
  return {
    query: '',
    lastQuery: '',
    topics: [],
    posts: [],
    users: [],
    categories: [],
    tags: [],
    tabs: {},
    activeTab: 'posts',
    page: 1,
    hasMore: false,
    scrollTop: 0,
  }
}
