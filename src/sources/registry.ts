/**
 * 数据源注册表。
 *
 * 这个文件同时被浏览器端代码和 vite.config.ts 引用，因此不能依赖任何浏览器 API。
 * 网易频道 ID 与可用性以 docs/news-sources.md 为准；空列表频道不注册。
 */

import {
  buildCatalogPageUrl,
  catalogMaxOffsetPages,
  catalogUsesOffsetPaging,
} from '../features/catalogEngine/pagination'
import { frameworkPageUrl } from '../features/frameworkDetect/buildPageUrl'
import { md5Hex, sha1Hex } from '../lib/hash'

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
  | 'wechat2rss'
  | 'uisdc'
  | 'web-catalog'

/** 旧版自建源 kind 兼容 */
export function normalizeSourceKind(kind: string | undefined): SourceKind {
  if (kind === 'web-video' || kind === 'web-catalog') return 'web-catalog'
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
  frameworkHint?: import('../features/frameworkDetect/types').FrameworkHint
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

const BROWSER_UA =
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

/**
 * 公众号镜像入口（wechat2rss 公共实例，第三方维护）。
 * 该实例失效或换址时只需改这里；feed hash 与公众号的对应关系见 docs/news-sources.md §19.4。
 */
export const WECHAT2RSS_BASE = 'https://wechat2rss.xlab.app'

function wechatMirror(
  id: string,
  name: string,
  label: string,
  feedHash: string,
  options?: { group?: SourceGroup; enabled?: boolean },
): NewsSource {
  return {
    id,
    name,
    label,
    group: options?.group ?? 'ai',
    kind: 'wechat2rss',
    url: `${WECHAT2RSS_BASE}/feed/${feedHash}.xml`,
    enabled: options?.enabled ?? false,
  }
}

function neteaseList(tid: string): string {
  return `https://c.m.163.com/nc/article/list/${tid}/0-${NETEASE_PAGE_SIZE}.html`
}

function neteaseChannel(
  id: string,
  name: string,
  tid: string,
  options?: { label?: string; group?: SourceGroup; enabled?: boolean; headline?: boolean },
): NewsSource {
  return {
    id,
    name,
    label: options?.label ?? name.replace(/^网易/, ''),
    group: options?.group ?? 'cn',
    kind: 'netease',
    url: options?.headline
      ? `https://c.m.163.com/nc/article/headline/${tid}/0-${NETEASE_PAGE_SIZE}.html`
      : neteaseList(tid),
    userAgent: 'NewsApp',
    enabled: options?.enabled ?? false,
  }
}

export const SOURCES: NewsSource[] = [
  // —— 网易频道（旧版索引中仍返回非空列表的频道）——
  neteaseChannel('netease', '网易热点', 'T1348647909107', {
    label: '网易',
    enabled: true,
    headline: true,
  }),
  neteaseChannel('netease-tech', '网易科技', 'T1348649580692'),
  neteaseChannel('netease-ent', '网易娱乐', 'T1348648517839', { group: 'special' }),
  neteaseChannel('netease-exclusive', '网易独家', 'T1370583240249', { label: '独家' }),
  neteaseChannel('netease-sports', '网易体育', 'T1348649079062'),
  neteaseChannel('netease-game', '游戏', 'T1348654151579'),
  neteaseChannel('netease-health', '网易健康', 'T1414389941036'),
  neteaseChannel('netease-nba', 'NBA', 'T1348649145984'),
  neteaseChannel('netease-biz', '网易商业', 'T1348648756099'),
  neteaseChannel('netease-edu', '教育', 'T1348654225495'),
  neteaseChannel('netease-fun', '网易轻松一刻', 'T1350383429665', {
    group: 'special',
  }),
  neteaseChannel('netease-antique', '古玩', 'T1441074311424'),
  neteaseChannel('netease-gov', '网易政务', 'T1414142214384'),
  neteaseChannel('netease-select', '精选', 'T1467284926140'),
  neteaseChannel('netease-phone', '手机', 'T1348649654285'),
  neteaseChannel('netease-football', '足球', 'T1348649176279'),
  neteaseChannel('netease-digital', '数码', 'T1348649776727'),
  neteaseChannel('netease-run', '跑步', 'T1411113472760'),
  neteaseChannel('netease-history', '历史', 'T1368497029546'),
  neteaseChannel('netease-stock', '股票', 'T1473054348939', { enabled: true }),
  neteaseChannel('netease-cba', 'CBA', 'T1348649475931'),
  neteaseChannel('netease-cn-football', '中国足球', 'T1348649503389'),
  {
    id: 'netease-auto',
    name: '汽车',
    label: '汽车',
    group: 'cn',
    kind: 'netease',
    // 汽车频道顶层键是 list，不是 TID；解析器已按数组键兼容
    url: `https://c.m.163.com/nc/auto/list/5Yac5Zyz/0-${NETEASE_PAGE_SIZE}.html`,
    userAgent: 'NewsApp',
    enabled: false,
  },
  neteaseChannel('netease-travel', '旅游', 'T1348654204705'),
  neteaseChannel('netease-blog', '网易博客', 'T1349837698345', { label: '博客' }),

  // —— 中文媒体 ——
  { id: 'sspai', name: '少数派', label: '少数派', group: 'tech', kind: 'feed', url: 'https://sspai.com/feed', enabled: true },
  { id: 'ifanr', name: '爱范儿', label: '爱范儿', group: 'tech', kind: 'feed', url: 'https://www.ifanr.com/feed', enabled: true },
  // 裸域 36kr.com 对无 JS 客户端返回反爬壳；www 才有真实 RSS
  { id: 'kr36', name: '36 氪', label: '36氪', group: 'cn', kind: 'feed', url: 'https://www.36kr.com/feed-article', enabled: true },
  { id: 'ithome', name: 'IT 之家', label: 'IT之家', group: 'tech', kind: 'feed', url: 'https://www.ithome.com/rss/', enabled: true },
  { id: 'huxiu', name: '虎嗅', label: '虎嗅', group: 'cn', kind: 'feed', url: 'https://rss.huxiu.com/', enabled: true },
  { id: 'geekpark', name: '极客公园', label: '极客公园', group: 'tech', kind: 'feed', url: 'https://www.geekpark.net/rss', enabled: true },
  { id: 'solidot', name: 'Solidot', label: 'Solidot', group: 'tech', kind: 'feed', url: 'https://www.solidot.org/index.rss', enabled: true },
  { id: 'infoq-cn', name: 'InfoQ 中文', label: 'InfoQ', group: 'tech', kind: 'feed', url: 'https://www.infoq.cn/feed', enabled: false },
  // —— 科普 ——
  {
    id: 'pansci',
    name: 'PanSci 泛科学',
    label: '泛科学',
    group: 'tech',
    kind: 'feed',
    url: 'https://pansci.asia/feed',
    enabled: true,
  },
  // 环球科学（科学美国人中文版）：/feed 404，WP 默认 query feed 仍在
  {
    id: 'huanqiukexue',
    name: '环球科学',
    label: '环球科学',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.huanqiukexue.com/?feed=rss2',
    enabled: true,
  },
  // 果壳无 RSS，旧 miniserver JSON API 已 404；解析「科学人」列表页。
  // 只有首页按时间倒序，channel/hot 等分频道停在 2018–2019 归档，不能用。
  {
    id: 'guokr',
    name: '果壳 · 科学人',
    label: '果壳',
    group: 'tech',
    kind: 'guokr',
    url: 'https://www.guokr.com/scientific/',
    // 移动 UA 会被判成不存在的移动站而 404，列表与正文都用桌面 UA
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    enabled: true,
  },
  {
    id: 'ruanyifeng',
    name: '阮一峰的网络日志',
    label: '阮一峰',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
    enabled: true,
  },
  {
    id: 'gcores',
    name: '机核',
    label: '机核',
    group: 'special',
    kind: 'feed',
    url: 'https://www.gcores.com/rss',
    enabled: true,
  },
  {
    id: 'appinn',
    name: '小众软件',
    label: '小众软件',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.appinn.com/feed/',
    enabled: true,
  },
  {
    id: 'tmtpost',
    name: '钛媒体',
    label: '钛媒体',
    group: 'cn',
    kind: 'feed',
    url: 'https://www.tmtpost.com/rss.xml',
    enabled: true,
  },
  // 甲子光年无 RSS（/feed 与 /rss.xml 都 302 → 404 页）；解析首页卡片列表
  {
    id: 'jazzyear',
    name: '甲子光年',
    label: '甲子光年',
    group: 'cn',
    kind: 'jazzyear',
    url: 'https://www.jazzyear.com/index.html',
    enabled: true,
  },
  {
    id: 'zhishifenzi',
    name: '知识分子',
    label: '知识分子',
    group: 'cn',
    kind: 'feed',
    url: 'https://zhishifenzi.com/rss',
    // 该站对 Android Chrome UA 会 500；正文抽取用桌面 UA
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    enabled: true,
  },
  // 晚点无 RSS；首页列表走 POST /site/index
  // 站点证书链不完整：Feed 代理已 secure:false；正文 /api/page 对 TLS 错误会 insecure 回退
  {
    id: 'latepost',
    name: '晚点 LatePost',
    label: '晚点',
    group: 'cn',
    kind: 'latepost',
    url: 'https://www.latepost.com/site/index',
    requestMethod: 'POST',
    requestForm: { page: 1, limit: 60 },
    requestHeaders: {
      Referer: 'https://www.latepost.com/',
      Origin: 'https://www.latepost.com',
      'X-Requested-With': 'XMLHttpRequest',
    },
    enabled: true,
  },

  // —— 财经快讯 / 盘面（P0）——
  {
    id: 'cls-telegraph',
    name: '财联社电报',
    label: '财联社',
    group: 'cn',
    kind: 'cls',
    // 实际请求由 offsetPageRequest → clsSignedListUrl 生成带 sign 的 URL
    url: 'https://www.cls.cn/v1/roll/get_roll_list',
    requestHeaders: { Referer: 'https://www.cls.cn/telegraph' },
    enabled: true,
  },
  {
    id: 'eastmoney-kx',
    name: '东方财富快讯',
    label: '东财快讯',
    group: 'cn',
    kind: 'eastmoney-kx',
    url: 'https://newsapi.eastmoney.com/kuaixun/v1/getlist_102_ajaxResult_50_1_.html',
    requestHeaders: { Referer: 'https://kuaixun.eastmoney.com/' },
    enabled: true,
  },
  {
    id: 'eastmoney-news',
    name: '东方财富',
    label: '东财',
    group: 'cn',
    kind: 'eastmoney-news',
    url: 'https://np-listapi.eastmoney.com/comm/web/getNewsByColumns?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_size=20&req_from=web_news',
    requestHeaders: { Referer: 'https://finance.eastmoney.com/' },
    enabled: true,
  },
  {
    id: 'wscn-live',
    name: '华尔街见闻快讯',
    label: '见闻快讯',
    group: 'cn',
    kind: 'wscn-live',
    url: 'https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&client=pc&limit=50',
    requestHeaders: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://wallstreetcn.com/live',
    },
    enabled: true,
  },
  {
    id: 'bbc-business',
    name: 'BBC Business',
    label: 'BBC商业',
    group: 'intl',
    kind: 'feed',
    url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
    enabled: true,
  },

  // —— 国际 ——
  // BBC 中文简体 RSS 已 301 → 繁体；china/world 旧 index.xml 停在 2011–2014 归档，改用现行 feeds
  { id: 'bbc-zh', name: 'BBC 中文', label: 'BBC中文', group: 'intl', kind: 'feed', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml', enabled: true },
  { id: 'bbc-zh-china', name: 'BBC 中文 · 中国', label: 'BBC中国', group: 'intl', kind: 'feed', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml', enabled: false },
  { id: 'bbc-zh-world', name: 'BBC 中文 · 国际', label: 'BBC国际', group: 'intl', kind: 'feed', url: 'https://feeds.bbci.co.uk/zhongwen/trad/rss.xml', enabled: false },
  { id: 'bbc-world', name: 'BBC World', label: 'BBC World', group: 'intl', kind: 'feed', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', enabled: false },
  {
    id: 'gnews-world',
    name: 'Google 全球',
    label: 'GNews全球',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  {
    id: 'gnews-business',
    name: 'Google 商业',
    label: 'GNews商业',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en',
    enabled: true,
  },
  {
    id: 'gnews-tech',
    name: 'Google 科技',
    label: 'GNews科技',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  {
    id: 'gnews-sports',
    name: 'Google 体育',
    label: 'GNews体育',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/SPORTS?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  {
    id: 'gnews-ent',
    name: 'Google 娱乐',
    label: 'GNews娱乐',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  {
    id: 'gnews-science',
    name: 'Google 科学',
    label: 'GNews科学',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  {
    id: 'gnews-health',
    name: 'Google 健康',
    label: 'GNews健康',
    group: 'intl',
    kind: 'google-news',
    url: 'https://news.google.com/rss/headlines/section/topic/HEALTH?hl=en-US&gl=US&ceid=US:en',
    enabled: false,
  },
  { id: 'dw-top', name: 'DW 德国之声', label: 'DW', group: 'intl', kind: 'feed', url: 'https://rss.dw.com/rdf/rss-en-top', enabled: true },
  { id: 'scmp-china', name: 'SCMP 中国', label: 'SCMP', group: 'intl', kind: 'feed', url: 'https://www.scmp.com/rss/4/feed/', enabled: true },
  { id: 'scmp-news', name: 'SCMP News', label: 'SCMP News', group: 'intl', kind: 'feed', url: 'https://www.scmp.com/rss/91/feed/', enabled: false },
  { id: 'npr', name: 'NPR News', label: 'NPR', group: 'intl', kind: 'feed', url: 'https://feeds.npr.org/1001/rss.xml', enabled: true },
  { id: 'guardian-world', name: 'The Guardian World', label: 'Guardian', group: 'intl', kind: 'feed', url: 'https://www.theguardian.com/world/rss', enabled: false },
  // /en/rss 已 301 到 HTML 目录页，改用仍返回 application/rss+xml 的分区源
  { id: 'france24', name: 'France 24', label: 'France24', group: 'intl', kind: 'feed', url: 'https://www.france24.com/en/asia-pacific/rss', enabled: false },
  { id: 'aljazeera', name: 'Al Jazeera', label: 'AlJazeera', group: 'intl', kind: 'feed', url: 'https://www.aljazeera.com/xml/rss/all.xml', enabled: false },

  // —— 科技深度（通用科技长文；AI 专题见下方 ai 分组）——
  { id: 'arstechnica', name: 'Ars Technica', label: 'Ars', group: 'tech', kind: 'feed', url: 'https://feeds.arstechnica.com/arstechnica/index', enabled: true },
  { id: 'mittr', name: 'MIT Technology Review', label: 'MIT TR', group: 'tech', kind: 'feed', url: 'https://www.technologyreview.com/feed/', enabled: true },
  { id: 'verge', name: 'The Verge', label: 'Verge', group: 'tech', kind: 'feed', url: 'https://www.theverge.com/rss/index.xml', enabled: false },
  { id: 'techcrunch', name: 'TechCrunch', label: 'TechCrunch', group: 'tech', kind: 'feed', url: 'https://techcrunch.com/feed/', enabled: false },
  { id: 'wired', name: 'WIRED', label: 'WIRED', group: 'tech', kind: 'feed', url: 'https://www.wired.com/feed/rss', enabled: false },
  { id: 'hn', name: 'Hacker News', label: 'HN', group: 'tech', kind: 'feed', url: 'https://hnrss.org/frontpage', enabled: false },

  // —— AI：实验室一手 / 聚焦栏目 / 综述与作者博（默认多数关闭，避免冲淡综合）——
  { id: 'qbitai', name: '量子位', label: '量子位', group: 'ai', kind: 'feed', url: 'https://www.qbitai.com/feed', enabled: true },
  // 机器之心无 RSS；文章库 JSON API（列表摘要；正文见详情 JSON）
  {
    id: 'jiqizhixin',
    name: '机器之心',
    label: '机器之心',
    group: 'ai',
    kind: 'jiqizhixin',
    url: 'https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=40',
    requestHeaders: {
      Referer: 'https://www.jiqizhixin.com/articles',
      Accept: 'application/json, text/plain, */*',
    },
    enabled: true,
  },
  // 新智元：WP 站但 /feed 常年 500，改用 WordPress REST API
  {
    id: 'aiera',
    name: '新智元',
    label: '新智元',
    group: 'ai',
    kind: 'wordpress',
    url: 'https://aiera.com.cn/wp-json/wp/v2/posts?per_page=30&_embed=1',
    requestHeaders: { Accept: 'application/json, text/plain, */*' },
    enabled: true,
  },
  { id: 'leiphone', name: '雷锋网', label: '雷锋网', group: 'ai', kind: 'feed', url: 'https://www.leiphone.com/feed', enabled: false },
  { id: 'synced', name: 'Synced', label: 'Synced', group: 'ai', kind: 'feed', url: 'https://syncedreview.com/feed/', enabled: false },
  { id: 'openai-news', name: 'OpenAI News', label: 'OpenAI', group: 'ai', kind: 'feed', url: 'https://openai.com/news/rss.xml', enabled: false },
  { id: 'google-ai', name: 'Google AI Blog', label: 'Google AI', group: 'ai', kind: 'feed', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', enabled: false },
  { id: 'deepmind', name: 'Google DeepMind', label: 'DeepMind', group: 'ai', kind: 'feed', url: 'https://deepmind.google/blog/rss.xml', enabled: false },
  { id: 'huggingface', name: 'Hugging Face Blog', label: 'HF', group: 'ai', kind: 'feed', url: 'https://huggingface.co/blog/feed.xml', enabled: false },
  { id: 'pytorch', name: 'PyTorch Blog', label: 'PyTorch', group: 'ai', kind: 'feed', url: 'https://pytorch.org/blog/feed/', enabled: false },
  { id: 'mittr-ai', name: 'MIT TR · AI', label: 'MIT AI', group: 'ai', kind: 'feed', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', enabled: false },
  { id: 'verge-ai', name: 'The Verge · AI', label: 'Verge AI', group: 'ai', kind: 'feed', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', enabled: false },
  { id: 'ieee-ai', name: 'IEEE Spectrum AI', label: 'IEEE AI', group: 'ai', kind: 'feed', url: 'https://spectrum.ieee.org/feeds/topic/artificial-intelligence.rss', enabled: false },
  { id: 'venturebeat-ai', name: 'VentureBeat AI', label: 'VB AI', group: 'ai', kind: 'feed', url: 'https://venturebeat.com/category/ai/feed', enabled: false },
  { id: 'marktechpost', name: 'MarkTechPost', label: 'MarkTech', group: 'ai', kind: 'feed', url: 'https://www.marktechpost.com/feed/', enabled: false },
  { id: 'lastweek-ai', name: 'Last Week in AI', label: 'LWAI', group: 'ai', kind: 'feed', url: 'https://lastweekin.ai/feed', enabled: false },
  { id: 'import-ai', name: 'Import AI', label: 'Import AI', group: 'ai', kind: 'feed', url: 'https://jack-clark.net/feed/', enabled: false },
  { id: 'ahead-of-ai', name: 'Ahead of AI', label: 'Ahead of AI', group: 'ai', kind: 'feed', url: 'https://magazine.sebastianraschka.com/feed', enabled: false },
  { id: 'lil-log', name: 'Lil’Log', label: 'Lil’Log', group: 'ai', kind: 'feed', url: 'https://lilianweng.github.io/index.xml', enabled: false },
  { id: 'simonw', name: 'Simon Willison', label: 'SimonW', group: 'ai', kind: 'feed', url: 'https://simonwillison.net/atom/everything/', enabled: false },
  { id: 'interconnects', name: 'Interconnects', label: 'Interconnects', group: 'ai', kind: 'feed', url: 'https://www.interconnects.ai/feed', enabled: false },
  // —— AI 深度解读 / 评测（补强非一手信源：横向评测、产品体验与行业深读）——
  // 智东西：WP 站但 /feed 500（与新智元同病），走 WordPress REST
  {
    id: 'zhidx',
    name: '智东西',
    label: '智东西',
    group: 'ai',
    kind: 'wordpress',
    url: 'https://zhidx.com/wp-json/wp/v2/posts?per_page=30&_embed=1',
    requestHeaders: { Accept: 'application/json, text/plain, */*' },
    enabled: false,
  },
  // 宝玉：RSS 仅摘要，正文回落 Readability 抓静态页（Astro，全文在 DOM）
  { id: 'baoyu', name: '宝玉的分享', label: '宝玉', group: 'ai', kind: 'feed', url: 'https://baoyu.io/feed.xml', enabled: true },
  { id: 'oneusefulthing', name: 'One Useful Thing', label: 'Mollick', group: 'ai', kind: 'feed', url: 'https://www.oneusefulthing.org/feed', enabled: false },
  { id: 'understandingai', name: 'Understanding AI', label: '理解AI', group: 'ai', kind: 'feed', url: 'https://www.understandingai.org/feed', enabled: false },
  { id: 'latent-space', name: 'Latent Space', label: 'Latent', group: 'ai', kind: 'feed', url: 'https://www.latent.space/feed', enabled: false },
  // Zvi 周报综述极长，feed 近 2MB；默认关闭，按需启用
  { id: 'thezvi', name: "Don't Worry About the Vase", label: 'Zvi', group: 'ai', kind: 'feed', url: 'https://thezvi.substack.com/feed', enabled: false },
  // —— 公众号镜像（wechat2rss 第三方公共实例；feed 自带全文即正文主路径）——
  // 镜像属第三方维护、可能失效；默认关闭，探测与风险记录见 docs/news-sources.md §19.4
  wechatMirror('xixiaoyao', '夕小瑶科技说', '夕小瑶', 'a1cd365aa14ed7d64cabfc8aa086da40ecaba34d'),
  // PaperWeekly feed 约 3MB（20 篇论文深读全文），刷新流量较大
  wechatMirror('paperweekly', 'PaperWeekly', 'PaperWeekly', '3be891c2f4e526629ab055a297cc2cd6c1f0a563'),
  // 42章经：AI/创投深度访谈，更新频率低（月 2–3 篇）
  wechatMirror('42zhangjing', '42章经', '42章经', '31436fcc3bba8c2c2a9337a163afcb3b5a57a0a0'),
  wechatMirror('chaping', '差评 X.PIN', '差评', '8d839de8dd3290a1f1be7a94423cccb30c1b087d', {
    group: 'tech',
  }),
  // 优设无 RSS（/feed 返回首页 HTML、tag feed 与 WP REST 均 404）；解析 tag 列表页，/page/N 翻页
  {
    id: 'uisdc-aigc',
    name: '优设 · AIGC',
    label: '优设',
    group: 'ai',
    kind: 'uisdc',
    url: 'https://www.uisdc.com/tag/aigc',
    enabled: false,
  },
  // 人人都是产品经理 AI 分类：WP 分类 feed 全文可用（横评 / 产品拆解向）
  {
    id: 'woshipm-ai',
    name: '人人都是产品经理 · AI',
    label: '人人PM',
    group: 'ai',
    kind: 'feed',
    url: 'https://www.woshipm.com/category/ai/feed',
    enabled: false,
  },
  // Arena（原 LMArena）无官方 RSS；解析官网 Blog 列表页（Sanity 嵌入数据）
  {
    id: 'arena',
    name: 'Arena Blog',
    label: 'Arena',
    group: 'ai',
    kind: 'arena',
    url: 'https://arena.ai/blog',
    enabled: true,
  },
  // Anthropic News 无官方 RSS；解析官网 /news 列表页（Sanity 嵌入数据）
  {
    id: 'anthropic',
    name: 'Anthropic News',
    label: 'Anthropic',
    group: 'ai',
    kind: 'anthropic',
    // 带尾斜杠会 308 → /news；代理 rewrite 不跟随，必须无尾斜杠
    url: 'https://www.anthropic.com/news',
    enabled: true,
  },

  // —— 专栏 ——
  {
    id: 'zhihu-daily',
    name: '知乎日报',
    label: '知乎日报',
    group: 'special',
    kind: 'zhihu',
    url: 'https://news-at.zhihu.com/api/4/news/latest',
    enabled: false,
  },
  // 煎蛋：官方 /feed 对爬虫 403；用 i.jandan.net 旧版 JSON API（一次目录）
  {
    id: 'jandan',
    name: '煎蛋新鲜事',
    label: '煎蛋',
    group: 'special',
    kind: 'jandan',
    url: 'https://i.jandan.net/?oxwlxojflwblxbsapi=get_category_posts&slug=news&count=60',
    enabled: false,
  },

  // —— 深度长文 / 思想智库 ——
  {
    id: 'foreign-affairs',
    name: 'Foreign Affairs',
    label: '外交事务',
    group: 'intl',
    kind: 'feed',
    url: 'https://www.foreignaffairs.com/rss.xml',
    enabled: false,
  },
  {
    id: 'nyrb',
    name: 'The New York Review of Books',
    label: '纽约书评',
    group: 'intl',
    kind: 'feed',
    url: 'https://feeds.feedburner.com/nybooks',
    enabled: false,
  },
  {
    id: 'bloomberg-opinion',
    name: 'Bloomberg Opinion',
    label: '彭博观点',
    group: 'intl',
    kind: 'feed',
    url: 'https://feeds.bloomberg.com/bview/news.rss',
    enabled: false,
  },
  {
    id: 'project-syndicate',
    name: 'Project Syndicate',
    label: '辛迪加',
    group: 'intl',
    kind: 'feed',
    url: 'https://www.project-syndicate.org/rss/section/economics',
    enabled: false,
  },
  {
    id: 'sinocism',
    name: 'Sinocism',
    label: 'Sinocism',
    group: 'intl',
    kind: 'feed',
    url: 'https://sinocism.com/feed',
    enabled: false,
  },
  {
    id: 'theinitium',
    name: '端传媒',
    label: '端传媒',
    group: 'intl',
    kind: 'feed',
    url: 'https://theinitium.com/rss/',
    enabled: false,
  },
  {
    id: 'quanta',
    name: 'Quanta Magazine',
    label: 'Quanta',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.quantamagazine.org/feed/',
    enabled: false,
  },
  {
    id: 'stratechery',
    name: 'Stratechery',
    label: 'Stratechery',
    group: 'tech',
    kind: 'feed',
    url: 'https://stratechery.com/feed/',
    enabled: false,
  },
  {
    id: 'vitalik',
    name: "Vitalik Buterin's website",
    label: 'Vitalik',
    group: 'tech',
    kind: 'feed',
    url: 'https://vitalik.eth.limo/feed.xml',
    enabled: false,
  },
  {
    id: 'fabricated-knowledge',
    name: 'Fabricated Knowledge',
    label: '半导体深度',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.fabricatedknowledge.com/feed',
    enabled: false,
  },
  {
    id: 'construction-physics',
    name: 'Construction Physics',
    label: '建筑物理',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.construction-physics.com/feed',
    enabled: false,
  },
  {
    id: 'paulgraham',
    name: 'Paul Graham Essays',
    label: 'Paul Graham',
    group: 'tech',
    kind: 'paulgraham',
    url: 'https://www.paulgraham.com/articles.html',
    enabled: false,
  },
  {
    id: 'v2ex',
    name: 'V2EX 分享创造',
    label: 'V2EX 创造',
    group: 'tech',
    kind: 'feed',
    url: 'https://www.v2ex.com/feed/create.xml',
    enabled: false,
  },
  {
    id: 'astral-codex-ten',
    name: 'Astral Codex Ten',
    label: 'ACX',
    group: 'special',
    kind: 'feed',
    url: 'https://www.astralcodexten.com/feed',
    enabled: false,
  },
  {
    id: 'marginalian',
    name: 'The Marginalian',
    label: 'Marginalian',
    group: 'special',
    kind: 'feed',
    url: 'https://www.themarginalian.org/feed/',
    enabled: false,
  },
  {
    id: 'aldaily',
    name: 'Arts & Letters Daily',
    label: 'ALDaily',
    group: 'special',
    kind: 'feed',
    url: 'https://aldaily.com/feed',
    enabled: false,
  },
  {
    id: 'theue',
    name: '无业游民',
    label: '无业游民',
    group: 'special',
    kind: 'feed',
    url: 'https://theue.me/feed/',
    enabled: false,
  },
]

export function proxyPathFor(id: string): string {
  return `/api/feed/${id}`
}

export function userAgentFor(source: NewsSource): string {
  return source.userAgent ?? BROWSER_UA
}

export function makeCustomSourceId(url: string): string {
  const clean = url.trim().toLowerCase().replace(/\/+$/, '')
  return `custom_${md5Hex(clean).slice(0, 10)}`
}

export function isCustomSourceId(id: string): boolean {
  return id.startsWith('custom_')
}

export function findSource(id: string, extraSources?: NewsSource[]): NewsSource | undefined {
  if (extraSources?.length) {
    const extra = extraSources.find((s) => s.id === id)
    if (extra) return extra
  }
  return SOURCES.find((s) => s.id === id)
}

/** 网易频道分页：`/{offset}-{size}.html`，offset = page * 20 */
export function neteasePageUrl(source: NewsSource, page: number): string {
  const offset = Math.max(0, page) * NETEASE_PAGE_SIZE
  return source.url.replace(/\/\d+-\d+\.html(?:\?.*)?$/, `/${offset}-${NETEASE_PAGE_SIZE}.html`)
}

export type OffsetPageRequest = {
  url: string
  requestForm?: Record<string, string | number>
}

function searchParamsFromRecord(params: Record<string, string | number>): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value))
  }
  return search
}

/** 财联社 web 签名：参数按 key 排序后 SHA1→MD5（与官网前端一致） */
export function clsSignParams(params: Record<string, string | number>): string {
  const search = searchParamsFromRecord(params)
  search.sort()
  return md5Hex(sha1Hex(search.toString()))
}

/** 财联社电报列表 URL（每次请求重新签名） */
export function clsSignedListUrl(options?: { rn?: number; lastTime?: number }): string {
  const params: Record<string, string | number> = {
    app: 'CailianpressWeb',
    last_time: options?.lastTime ?? 0,
    os: 'web',
    refresh_type: 1,
    rn: options?.rn ?? 20,
    sv: '8.7.9',
  }
  params.sign = clsSignParams(params)
  return `https://www.cls.cn/v1/roll/get_roll_list?${searchParamsFromRecord(params).toString()}`
}

/**
 * 0-based 页码 → 上游请求。
 * 页码约定与网易一致：0 为首页；WordPress / 晚点 / 东财专栏上游是 1-based。
 */
export function offsetPageRequest(source: NewsSource, page: number): OffsetPageRequest {
  const safePage = Math.max(0, page)

  if (source.kind === 'netease') {
    return { url: neteasePageUrl(source, safePage) }
  }

  if (source.kind === 'wordpress') {
    const url = new URL(source.url)
    url.searchParams.set('page', String(safePage + 1))
    return { url: url.href }
  }

  if (source.kind === 'latepost') {
    return {
      url: source.url,
      requestForm: { ...(source.requestForm ?? {}), page: safePage + 1 },
    }
  }

  if (source.kind === 'cls') {
    // 财联社电报靠 last_time 游标翻页；页码路径尚未接入，暂始终拉首页
    return { url: clsSignedListUrl({ rn: 20, lastTime: 0 }) }
  }

  if (source.kind === 'eastmoney-news') {
    const url = new URL(source.url)
    url.searchParams.set('page_index', String(safePage + 1))
    url.searchParams.set('req_trace', String(Date.now()))
    return { url: url.href }
  }

  if (source.kind === 'eastmoney-kx') {
    // URL 形如 getlist_102_ajaxResult_50_1_.html，末段数字为 1-based 页码
    const url = source.url.replace(
      /(_ajaxResult_\d+_)(\d+)(_\.html(?:\?.*)?)$/i,
      `$1${safePage + 1}$3`,
    )
    return { url }
  }

  if (source.kind === 'uisdc') {
    // WP 归档路径翻页：/tag/aigc → /tag/aigc/page/2
    if (safePage === 0) return { url: source.url }
    return { url: `${source.url.replace(/\/+$/, '')}/page/${safePage + 1}` }
  }

  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) {
      return { url: frameworkPageUrl(source.url, safePage, source.frameworkHint.paginationPattern) }
    }
    return { url: buildCatalogPageUrl(source.url, safePage) }
  }

  return { url: source.url, requestForm: source.requestForm }
}

export function maxOffsetPages(source: NewsSource): number {
  if (source.kind === 'web-catalog') return catalogMaxOffsetPages()
  return OFFSET_MAX_PAGES[source.kind] ?? 1
}

/** 知乎日报历史：before/{yyyyMMdd} 返回该日之前的内容 */
export function zhihuBeforeUrl(editionDate: string): string {
  return `https://news-at.zhihu.com/api/4/news/before/${editionDate}`
}

/** 该来源的列表分页策略 */
export function pagingStrategyOf(source: NewsSource): PagingStrategy {
  if (source.kind === 'netease') return 'upstream-offset'
  if (source.kind === 'wordpress') return 'upstream-offset'
  if (source.kind === 'latepost') return 'upstream-offset'
  if (source.kind === 'eastmoney-news') return 'upstream-offset'
  if (source.kind === 'eastmoney-kx') return 'upstream-offset'
  if (source.kind === 'uisdc') return 'upstream-offset'
  if (source.kind === 'zhihu') return 'upstream-cursor'
  if (source.kind === 'web-catalog') {
    if (source.frameworkHint) return 'upstream-offset'
    return catalogUsesOffsetPaging(source.url) ? 'upstream-offset' : 'client-catalog'
  }
  return 'client-catalog'
}

/** 是否走「一次目录 + 客户端窗口」（RSS / Anthropic / Arena 等） */
export function usesClientCatalogPaging(source: NewsSource): boolean {
  return pagingStrategyOf(source) === 'client-catalog'
}

/** 该来源是否支持上拉加载更早内容（所有已注册策略均可） */
export function sourceSupportsPaging(source: NewsSource): boolean {
  return Boolean(pagingStrategyOf(source))
}
