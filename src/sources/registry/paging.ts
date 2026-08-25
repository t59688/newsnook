/**
 * 列表分页：分页策略判定、上游 offset/游标翻页 URL 构造与财联社签名。
 */

import {
  buildCatalogPageUrl,
  catalogMaxOffsetPages,
  catalogUsesOffsetPaging,
} from '../../features/catalogEngine/pagination'
import { frameworkPageUrl } from '../../features/frameworkDetect/buildPageUrl'
import { md5Hex, sha1Hex } from '../../lib/hash'
import {
  NETEASE_PAGE_SIZE,
  OFFSET_MAX_PAGES,
  type NewsSource,
  type PagingStrategy,
} from './model'

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
