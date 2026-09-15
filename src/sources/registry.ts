/**
 * 数据源注册表（聚合入口）。
 *
 * 这个文件同时被浏览器端代码、vite.config.ts 与 functions/ 边缘代理引用，
 * 因此保持原路径稳定，且不能依赖任何浏览器 API。实现按边界拆在 registry/ 子模块。
 */

import { SOURCES as BUILTIN_SOURCES, WECHAT2RSS_BASE } from './registry/builtinSources'
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

export { WECHAT2RSS_BASE }

/**
 * 知乎主站与旧「知乎日报」是两个完全不同的协议。主站源必须登录，
 * 列表由 Android 本机签名直连，绝不经 NewsNook Cloud / 边缘代理。
 */
export const ZHIHU_MAIN_SOURCE: NewsSource = {
  id: 'zhihu-main',
  name: '知乎',
  label: '知乎',
  group: 'special',
  kind: 'zhihu-main',
  url: 'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true&limit=20',
  siteUrl: 'https://www.zhihu.com/',
  enabled: false,
}

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
