import { discoverCatalogPagination } from '../siteCatalog/pagination'
export { pageParamName, buildCatalogPageUrl, catalogUsesOffsetPaging, catalogMaxOffsetPages } from './pageUrl'

export function detectNextPageUrl(html: string, pageUrl: string): string | undefined {
  return discoverCatalogPagination(html, pageUrl).nextUrl
}
