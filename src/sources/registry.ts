/**
 * 数据源注册表（聚合入口）。
 *
 * 这个文件同时被浏览器端代码、vite.config.ts 与 functions/ 边缘代理引用，
 * 因此保持原路径稳定，且不能依赖任何浏览器 API。实现按边界拆在 registry/ 子模块。
 */

import { SOURCES as BUILTIN_SOURCES, WECHAT2RSS_BASE } from './registry/builtinSources'
import { ZHIHU_MAIN_SOURCE } from './registry/zhihuMain'
import type { NewsSource } from './registry/model'

export {
  CATALOG_PAGE_SIZE,
  NETEASE_MAX_PAGES,
  NETEASE_PAGE_SIZE,
  normalizeSourceKind,
  OFFSET_MAX_PAGES,
  SOURCE_GROUP_ORDER,
  SOURCE_GROUPS,
  type NewsSource,
  type PagingStrategy,
  type SourceGroup,
  type SourceKind,
} from './registry/model'

export { WECHAT2RSS_BASE, ZHIHU_MAIN_SOURCE }
export const SOURCES: NewsSource[] = [...BUILTIN_SOURCES, ZHIHU_MAIN_SOURCE]

export {
  findSource,
  isCustomSourceId,
  isWechatAlbumUrl,
  makeCustomSourceId,
  normalizeWechatAlbumUrl,
  proxyPathFor,
  userAgentFor,
} from './registry/lookup'

export {
  clsSignParams,
  clsSignedListUrl,
  maxOffsetPages,
  neteasePageUrl,
  offsetPageRequest,
  pagingStrategyOf,
  sourceSupportsPaging,
  usesClientCatalogPaging,
  zhihuBeforeUrl,
  type OffsetPageRequest,
} from './registry/paging'
