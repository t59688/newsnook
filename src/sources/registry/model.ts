/**
 * 数据源模型：类型、分组元信息与分页常量。
 * 叶子模块（不依赖 registry/ 内其它文件），供 builtinSources / lookup / paging 共用。
 */

export type SourceGroup = 'cn' | 'intl' | 'tech' | 'ai' | 'special' | 'custom'

export type SourceKind =
  | 'feed'
  | 'google-news'
  | 'netease'
  | 'zhihu'
  | 'arena'
  | 'anthropic'
  | 'jandan'
  | 'jiqizhixin'
  | 'latepost'
  | 'wordpress'
  | 'guokr'
  | 'jazzyear'
  | 'cls'
  | 'eastmoney-kx'
  | 'eastmoney-news'
  | 'wscn-live'
  | 'paulgraham'
  | 'wechat'
  | 'uisdc'
  | 'web-catalog'

/** 旧版自建源 kind 兼容 */
export function normalizeSourceKind(kind: string | undefined): SourceKind {
  if (kind === 'web-video' || kind === 'web-catalog') return 'web-catalog'
  // 公众号解析器升级前的旧 kind
  if (kind === 'wechat2rss') return 'wechat'
  return (kind as SourceKind) || 'feed'
}

export interface NewsSource {
  id: string
  name: string
  /** 列表页与详情页展示的简短出处 */
  label: string
  group: SourceGroup
  kind: SourceKind
  url: string
  /** 原站主页链接（来自 OPML htmlUrl 或 Feed 抓取） */
  siteUrl?: string
  /** 上游对 User-Agent 敏感时覆盖默认值 */
  userAgent?: string
  /** 列表请求方法；晚点等接口要求 POST */
  requestMethod?: 'GET' | 'POST'
  /** POST 时 application/x-www-form-urlencoded 字段 */
  requestForm?: Record<string, string | number>
  /** 额外上游请求头（Referer 等） */
  requestHeaders?: Record<string, string>
  /** 默认是否出现在「综合」启用列表 */
  enabled: boolean
  /** 是否为用户自建自定义源 */
  isCustom?: boolean
  /** 自建时间戳 */
  createdAt?: number
  /** CMS 框架探测结果（仅自定义 web-catalog 源） */
  frameworkHint?: import('../../features/frameworkDetect/types').FrameworkHint
}

export const SOURCE_GROUPS: Record<SourceGroup, { title: string; caption: string }> = {
  cn: { title: '国内', caption: '网易频道与中文媒体' },
  intl: { title: '国际', caption: '公共广电与亚洲视角' },
  tech: { title: '科技', caption: '数码、产品与产业报道' },
  ai: { title: 'AI', caption: '实验室、深度解读与评测长文' },
  special: { title: '专栏', caption: '日报与轻松阅读' },
  custom: { title: '自定义', caption: '自建与 OPML 导入订阅' },
}

/** 频道页 / 分类信源编辑的分组展示顺序 */
export const SOURCE_GROUP_ORDER: SourceGroup[] = ['cn', 'intl', 'tech', 'ai', 'special', 'custom']

export const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

/** 网易列表每页条数；旧版最多翻 8 页 */
export const NETEASE_PAGE_SIZE = 20
export const NETEASE_MAX_PAGES = 8

/**
 * 客户端目录窗口大小。
 * 适用于一次拿到完整列表、无上游分页协议的来源（RSS / 解析型官网列表等）。
 */
export const CATALOG_PAGE_SIZE = 20

/**
 * 列表分页策略（按能力分流，而不是按具体频道 id）：
 * - upstream-offset：上游按页码/offset 拉更早内容（网易 / WP REST / 晚点 / 东财）
 * - upstream-cursor：上游按游标拉历史（知乎日报）
 * - client-catalog：一次解析完整目录，客户端窗口展示 + 上拉切片（默认；纯 RSS 无翻页）
 */
export type PagingStrategy = 'upstream-offset' | 'upstream-cursor' | 'client-catalog'

/** 上游 offset 翻页的安全上限；空页会提前结束 */
export const OFFSET_MAX_PAGES: Partial<Record<SourceKind, number>> = {
  netease: NETEASE_MAX_PAGES,
  wordpress: 40,
  latepost: 30,
  'eastmoney-news': 40,
  'eastmoney-kx': 40,
  uisdc: 20,
}
