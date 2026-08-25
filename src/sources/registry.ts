/**
 * 数据源注册表（聚合入口）。
 *
 * 这个文件同时被浏览器端代码、vite.config.ts 与 functions/ 边缘代理引用，
 * 因此保持原路径稳定，且不能依赖任何浏览器 API。实现按边界拆在 registry/ 子模块：
 * - registry/model.ts          类型、分组元信息与分页常量
 * - registry/builtinSources.ts 内置源数据（SOURCES）与构造器
 * - registry/lookup.ts         源查找、UA、自定义源 id 与公众号合集链接归一
 * - registry/paging.ts         分页策略与上游翻页 URL 构造
 */

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

export { SOURCES, WECHAT2RSS_BASE } from './registry/builtinSources'

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
