/**
 * 列表解析统一入口。实现按边界拆在 parseFeed/ 子模块：
 * - generic：RSS / Atom / RDF / JSON Feed 通用路径
 * - netease / zhihu / flightSites / sites / finance / wechat：站点定制 kind
 * - dateEnrichment：晚点 / 甲子光年 / Paul Graham 的详情页日期补全
 * 对外导入路径保持 `lib/parseFeed` 不变。
 */

import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
import type { NewsSource, SourceKind } from '../sources/registry'
import type { Article } from './types'
import { parseGenericFeed, parseXmlFeed } from './parseFeed/generic'
import { parseNetease } from './parseFeed/netease'
import { parseZhihuDaily } from './parseFeed/zhihu'
import { parseAnthropicNews, parseArenaBlog } from './parseFeed/flightSites'
import {
  parseGuokrList,
  parseJandan,
  parseJazzyear,
  parseJiqizhixin,
  parseLatepost,
  parsePaulGraham,
  parseUisdcTag,
  parseWordpressRest,
} from './parseFeed/sites'
import {
  parseClsTelegraph,
  parseEastmoneyKx,
  parseEastmoneyNews,
  parseWscnLive,
} from './parseFeed/finance'
import { parseWechatSource } from './parseFeed/wechat'

export {
  enrichJazzyearDates,
  enrichLatepostDates,
  enrichPaulGrahamDates,
  extractJazzyearPublishTime,
  extractLatepostReleaseTime,
  extractPaulGrahamPublishTime,
  isBogusLatepostListDate,
} from './parseFeed/dateEnrichment'
export { neteasePageEntryCount } from './parseFeed/netease'
export { zhihuEditionDate } from './parseFeed/zhihu'
export { cleanWechatArticleHtml } from './parseFeed/wechat'

function parseWebCatalog(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  return catalogHtmlToArticles(source, payload, fetchedAt)
}

type SourceParser = (source: NewsSource, payload: string, fetchedAt: number) => Article[]

/**
 * kind → 解析器。
 * 用 Record 而非条件分派：新增 SourceKind 时缺失解析器会在编译期报错。
 */
const PARSERS: Record<SourceKind, SourceParser> = {
  feed: parseGenericFeed,
  'google-news': parseXmlFeed,
  netease: parseNetease,
  zhihu: parseZhihuDaily,
  arena: parseArenaBlog,
  anthropic: parseAnthropicNews,
  jandan: parseJandan,
  jiqizhixin: parseJiqizhixin,
  latepost: parseLatepost,
  wordpress: parseWordpressRest,
  guokr: parseGuokrList,
  jazzyear: parseJazzyear,
  cls: parseClsTelegraph,
  'eastmoney-kx': parseEastmoneyKx,
  'eastmoney-news': parseEastmoneyNews,
  'wscn-live': parseWscnLive,
  paulgraham: parsePaulGraham,
  wechat: parseWechatSource,
  uisdc: parseUisdcTag,
  'web-catalog': parseWebCatalog,
}

export function parseSourcePayload(source: NewsSource, payload: string): Article[] {
  const fetchedAt = Date.now()
  const articles = (PARSERS[source.kind] ?? parseXmlFeed)(source, payload, fetchedAt)

  // 上游偶尔重复推送同一条，按 id 去重
  const seen = new Set<string>()
  return articles.filter((article) => {
    if (seen.has(article.id)) return false
    seen.add(article.id)
    return true
  })
}
