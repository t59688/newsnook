/**
 * 列表解析统一入口。实现按边界拆在 parseFeed/ 子模块。
 */

import { catalogHtmlToArticles } from '../features/catalogEngine/toArticles'
import type { NewsSource, SourceKind } from '../sources/registry'
import type { Article } from './types'
import { parseGenericFeed, parseXmlFeed } from './parseFeed/generic'
import { parseNetease } from './parseFeed/netease'
import { parseZhihuDaily, parseZhihuMain } from './parseFeed/zhihu'
import { parseAnthropicNews, parseArenaBlog } from './parseFeed/flightSites'
import {
  parseClaudeAcademy,
  parseClaudeWebflow,
  parseOpenaiCookbook,
} from './parseFeed/aiFirstparty'
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

const PARSERS: Record<SourceKind, SourceParser> = {
  feed: parseGenericFeed,
  'google-news': parseXmlFeed,
  netease: parseNetease,
  zhihu: parseZhihuDaily,
  'zhihu-main': parseZhihuMain,
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
  'claude-webflow': parseClaudeWebflow,
  'claude-academy': parseClaudeAcademy,
  'openai-cookbook': parseOpenaiCookbook,
  'web-catalog': parseWebCatalog,
}

export function parseSourcePayload(source: NewsSource, payload: string): Article[] {
  const fetchedAt = Date.now()
  const articles = (PARSERS[source.kind] ?? parseXmlFeed)(source, payload, fetchedAt)
  const seen = new Set<string>()
  return articles.filter((article) => {
    if (seen.has(article.id)) return false
    seen.add(article.id)
    return true
  })
}
