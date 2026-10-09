import type { FrameworkId } from '../frameworkDetect/types'
import type { Article } from '../../lib/types'

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
export type CatalogPageKind = 'catalog' | 'empty' | 'detail' | 'blocked' | 'dynamic' | 'unsupported'
export interface CatalogPage {
  request: CatalogRequest
  url: string
  articles: Article[]
  profile: CatalogProfile
  pagination: CatalogPagination
  kind: CatalogPageKind
  truncated: boolean
}
