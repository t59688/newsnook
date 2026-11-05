import type { FrameworkId } from '../frameworkDetect/types'
import type { Article } from '../../lib/types'
import type { CatalogCapabilities } from './abilities/types'
import type { CatalogItemMetadata } from '../catalogEngine/itemSemantics'

export interface CatalogRequest {
  url: string
  method: 'GET' | 'POST'
  form?: Record<string, string>
  fields?: { name: string; value: string }[]
}
export interface CatalogLink { title: string; url: string }
export interface CatalogPagination {
  kind: 'none' | 'next-link'
  nextUrl?: string
  /** Observed POST/form pagination; GET links continue to use nextUrl. */
  nextRequest?: CatalogRequest
  pages?: { page: number; url: string }[]
}
/** Pure data: no page HTML, credentials, script or live session is persisted. */
export interface CatalogProfile {
  version: 1
  rulesRevision: 1
  siteRoot: string
  engine: FrameworkId
  categories: CatalogLink[]
  search?: CatalogRequest
  sorts?: CatalogLink[]
  filters?: { title: string; options: CatalogLink[] }[]
}
export interface CatalogNavigationGroup {
  title: string
  parentUrl?: string
  links: CatalogLink[]
  activeUrl?: string
}
/** Response-local navigation; child menus never accumulate into persisted categories. */
export interface CatalogNavigation {
  activePrimaryUrl?: string
  groups: CatalogNavigationGroup[]
}
export type CatalogPageKind = 'catalog' | 'navigation' | 'empty' | 'detail' | 'blocked' | 'dynamic' | 'unsupported'
export interface CatalogPage {
  request: CatalogRequest
  url: string
  articles: Article[]
  profile: CatalogProfile
  pagination: CatalogPagination
  navigation?: CatalogNavigation
  capabilities?: CatalogCapabilities
  /** Page-local per-item semantics; the shared Article/cache/sync format is unchanged. */
  itemMetadata?: Record<string, CatalogItemMetadata>
  kind: CatalogPageKind
  truncated: boolean
}
