export interface FeedDiscoveryEntry {
  providerId: string
  entryId: string
  type: 'direct'
  title: string
  description?: string
  categories: string[]
  siteUrl?: string
  feedUrl?: string
  statusNote?: string
}

export interface FeedDiscoveryPreviewArticle {
  title: string
  publishedAt?: number
}

export type FeedDiscoveryPreviewFailureKind =
  | 'aborted'
  | 'timeout'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'verification'
  | 'invalid-feed'
  | 'network'
  | 'unknown'

export interface FeedDiscoveryPreviewSuccess {
  ok: true
  feedUrl: string
  title?: string
  itemCount: number
  articles: FeedDiscoveryPreviewArticle[]
  checkedAt: number
}

export interface FeedDiscoveryPreviewFailure {
  ok: false
  feedUrl: string
  kind: FeedDiscoveryPreviewFailureKind
  message: string
  retryable: boolean
  checkedAt: number
}

export type FeedDiscoveryPreviewResult =
  | FeedDiscoveryPreviewSuccess
  | FeedDiscoveryPreviewFailure

