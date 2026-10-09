import type { ZhihuApiClient } from '../api/client'
import {
  validateZhihuCursor,
  zhihuHotUrl,
  zhihuQuestionAnswersUrl,
  zhihuSearchUrl,
} from '../api/endpoints'
import type { ZhihuQuestionAnswerOrder, ZhihuSearchOptions } from '../api/endpoints'
import { decodeZhihuPage } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import type {
  Page,
  ZhihuContentSummary,
  ZhihuFeedMode,
  ZhihuRecommendationMode,
} from '../types'
import { rankZhihuLocalRecommendations } from './recommendation'
import { ZhihuSmartRecommendationCoordinator, type ZhihuSmartRecallSource } from './smart'

export interface ZhihuReadApi {
  getJson(operation: string, url: string, signal?: AbortSignal): Promise<unknown>
  getJsonWithHeaders?(
    operation: string,
    url: string,
    headers: Record<string, string>,
    signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown>
}

export const ANDROID_PUBLIC_HEADERS: Record<string, string> = {
  'User-Agent': 'com.zhihu.android/Futureve/10.61.0 Mozilla/5.0 (Linux; Android 12; sdk_gphone64_arm64 Build/SE1A.220630.001.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/57.0.1000.10 Mobile Safari/537.36',
  'x-api-version': '3.1.8',
  'x-app-version': '10.61.0',
  'x-app-za': 'OS=Android&Release=12&Model=sdk_gphone64_arm64&VersionName=10.61.0&VersionCode=26107&Product=com.zhihu.android&Width=1440&Height=2952&Installer=%E7%81%B0%E5%BA%A6&DeviceType=AndroidPhone&Brand=google',
}

const WEB_RECOMMEND_URL = 'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true&limit=50'
const ANDROID_RECOMMEND_URL = 'https://api.zhihu.com/topstory/recommend'

interface MixedCursor {
  web?: string
  android?: string
}

function encodeMixedCursor(cursor: MixedCursor): string | undefined {
  if (!cursor.web && !cursor.android) return undefined
  return `mixed:${encodeURIComponent(JSON.stringify(cursor))}`
}

function decodeMixedCursor(value: string): MixedCursor {
  if (!value.startsWith('mixed:')) throw new ZhihuApiError('invalid-response', '混合推荐游标格式无效')
  try {
    const parsed = JSON.parse(decodeURIComponent(value.slice(6))) as MixedCursor
    return {
      web: parsed.web ? validateZhihuCursor(parsed.web) : undefined,
      android: parsed.android ? validateZhihuCursor(parsed.android) : undefined,
    }
  } catch (error) {
    if (error instanceof ZhihuApiError) throw error
    throw new ZhihuApiError('invalid-response', '混合推荐游标无法解析')
  }
}

function localOffset(cursor?: string): number {
  if (!cursor) return 0
  const match = /^local:(\d+)$/.exec(cursor)
  if (!match) throw new ZhihuApiError('invalid-response', '本地推荐游标格式无效')
  return Math.max(0, Number(match[1]))
}

function markSource(
  items: ZhihuContentSummary[],
  source: 'web' | 'android' | 'hot' | 'following',
): ZhihuContentSummary[] {
  return items.map((item) => ({ ...item, recommendationSource: source }))
}

function interleaveRecommendationSources(
  android: ZhihuContentSummary[],
  web: ZhihuContentSummary[],
): ZhihuContentSummary[] {
  const result: ZhihuContentSummary[] = []
  const seen = new Set<string>()
  const max = Math.max(android.length, web.length)
  for (let index = 0; index < max; index += 1) {
    for (const item of [android[index], web[index]]) {
      if (!item) continue
      const key = `${item.ref.kind}:${item.ref.id}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }
  return result
}

function mergeUnique(items: ZhihuContentSummary[]): ZhihuContentSummary[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.ref.kind}:${item.ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeZhihuPages(
  current: Page<ZhihuContentSummary>,
  incoming: Page<ZhihuContentSummary>,
): Page<ZhihuContentSummary> {
  const nextCursor = incoming.nextCursor === current.nextCursor ? undefined : incoming.nextCursor
  return {
    items: mergeUnique([...current.items, ...incoming.items]),
    nextCursor,
    hasMore: incoming.hasMore && Boolean(nextCursor),
  }
}

export class ZhihuFeedService {
  private readonly api: ZhihuReadApi
  private readonly smart: ZhihuSmartRecommendationCoordinator

  constructor(api: ZhihuReadApi) {
    this.api = api
    this.smart = new ZhihuSmartRecommendationCoordinator({
      fetch: (source, cursor, signal) => this.readSmartSource(source, cursor, signal),
    })
  }

  resetSmartRecommendation(accountId?: string | null): void {
    this.smart.reset(accountId)
  }

  private async readAndroidRecommendation(url: string, signal?: AbortSignal): Promise<Page<ZhihuContentSummary>> {
    const raw = this.api.getJsonWithHeaders
      ? await this.api.getJsonWithHeaders(
          'feed.recommended',
          url,
          ANDROID_PUBLIC_HEADERS,
          signal,
          { signing: 'none' },
        )
      : await this.api.getJson('feed.recommended', url, signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: markSource(decoded.items, 'android'),
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  private async readWebRecommendation(url: string, signal?: AbortSignal): Promise<Page<ZhihuContentSummary>> {
    const raw = await this.api.getJson('feed.recommended-web', url, signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: markSource(decoded.items, 'web'),
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  private async readHotRecommendation(
    url = `${zhihuHotUrl()}?limit=50&mobile=true`,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const raw = this.api.getJsonWithHeaders
      ? await this.api.getJsonWithHeaders(
          'feed.hot',
          url,
          ANDROID_PUBLIC_HEADERS,
          signal,
          { signing: 'none' },
        )
      : await this.api.getJson('feed.hot', url, signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: markSource(decoded.items, 'hot'),
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  private async readFollowingRecommendation(
    url = 'https://api.zhihu.com/moments_v3?feed_type=recommend',
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const raw = this.api.getJsonWithHeaders
      ? await this.api.getJsonWithHeaders(
          'feed.following',
          url,
          ANDROID_PUBLIC_HEADERS,
          signal,
          { signing: 'none' },
        )
      : await this.api.getJson('feed.following', url, signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: markSource(decoded.items, 'following'),
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  private readSmartSource(
    source: ZhihuSmartRecallSource,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    switch (source) {
      case 'android':
        return this.readAndroidRecommendation(cursor ? validateZhihuCursor(cursor) : ANDROID_RECOMMEND_URL, signal)
      case 'web':
        return this.readWebRecommendation(cursor ? validateZhihuCursor(cursor) : WEB_RECOMMEND_URL, signal)
      case 'hot':
        return this.readHotRecommendation(cursor ? validateZhihuCursor(cursor) : undefined, signal)
      case 'following':
        return this.readFollowingRecommendation(cursor ? validateZhihuCursor(cursor) : undefined, signal)
    }
  }

  private async listRecommended(
    recommendationMode: ZhihuRecommendationMode,
    cursor: string | undefined,
    signal: AbortSignal | undefined,
    accountId: string | null | undefined,
  ): Promise<Page<ZhihuContentSummary>> {
    if (recommendationMode === 'smart') {
      return this.smart.list(cursor, signal, accountId)
    }
    if (recommendationMode === 'android') {
      return this.readAndroidRecommendation(cursor ? validateZhihuCursor(cursor) : ANDROID_RECOMMEND_URL, signal)
    }
    if (recommendationMode === 'web') {
      return this.readWebRecommendation(cursor ? validateZhihuCursor(cursor) : WEB_RECOMMEND_URL, signal)
    }
    if (recommendationMode === 'mixed') {
      const state = cursor ? decodeMixedCursor(cursor) : { web: WEB_RECOMMEND_URL, android: ANDROID_RECOMMEND_URL }
      const [androidPage, webPage] = await Promise.all([
        state.android
          ? this.readAndroidRecommendation(state.android, signal)
          : Promise.resolve<Page<ZhihuContentSummary>>({ items: [], hasMore: false }),
        state.web
          ? this.readWebRecommendation(state.web, signal)
          : Promise.resolve<Page<ZhihuContentSummary>>({ items: [], hasMore: false }),
      ])
      const nextCursor = encodeMixedCursor({
        android: androidPage.hasMore ? androidPage.nextCursor : undefined,
        web: webPage.hasMore ? webPage.nextCursor : undefined,
      })
      return {
        items: interleaveRecommendationSources(androidPage.items, webPage.items),
        nextCursor,
        hasMore: Boolean(nextCursor),
      }
    }

    // 本地模式抓取公开候选，但排名、画像和解释均只在本机完成。单路失败时仍可用另一路，
    // 两路都失败才上抛；这样不会因为某个上游推荐协议暂时变化而把本地模式整体打空。
    const offset = localOffset(cursor)
    const settled = await Promise.allSettled([
      this.readAndroidRecommendation(ANDROID_RECOMMEND_URL, signal),
      this.readWebRecommendation(WEB_RECOMMEND_URL, signal),
    ])
    if (settled.every((result) => result.status === 'rejected')) {
      throw settled[0].status === 'rejected' ? settled[0].reason : new ZhihuApiError('network', '本地推荐候选读取失败')
    }
    const androidItems = settled[0].status === 'fulfilled' ? settled[0].value.items : []
    const webItems = settled[1].status === 'fulfilled' ? settled[1].value.items : []
    const ranked = rankZhihuLocalRecommendations(
      interleaveRecommendationSources(androidItems, webItems),
      accountId,
    )
    const pageSize = 20
    const items = ranked.slice(offset, offset + pageSize)
    const nextOffset = offset + items.length
    const hasMore = nextOffset < ranked.length
    return {
      items,
      nextCursor: hasMore ? `local:${nextOffset}` : undefined,
      hasMore,
    }
  }

  async listFeed(
    mode: ZhihuFeedMode,
    cursor?: string,
    signal?: AbortSignal,
    recommendationMode: ZhihuRecommendationMode = 'smart',
    accountId?: string | null,
  ): Promise<Page<ZhihuContentSummary>> {
    if (mode === 'recommended') {
      return this.listRecommended(recommendationMode, cursor, signal, accountId)
    }
    if (mode === 'hot') {
      return this.readHotRecommendation(cursor ? validateZhihuCursor(cursor) : undefined, signal)
    }
    return this.readFollowingRecommendation(cursor ? validateZhihuCursor(cursor) : undefined, signal)
  }

  async search(
    query: string,
    cursor?: string,
    signal?: AbortSignal,
    options: ZhihuSearchOptions = {},
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = query.trim()
    if (!normalized) return { items: [], hasMore: false }
    const url = cursor
      ? validateZhihuCursor(cursor)
      : zhihuSearchUrl(normalized, 0, 20, options)
    const raw = await this.api.getJson('search.query', url, signal)
    const decoded = decodeZhihuPage(raw)
    return {
      items: decoded.items,
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  async questionAnswers(
    questionId: string,
    order: ZhihuQuestionAnswerOrder = 'default',
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    if (!questionId) throw new ZhihuApiError('invalid-response', '问题 id 为空')
    const url = cursor ? validateZhihuCursor(cursor) : zhihuQuestionAnswersUrl(questionId, order)
    const raw = await this.api.getJson('question.answers', url, signal)
    const decoded = decodeZhihuPage(raw)
    return { items: decoded.items, nextCursor: decoded.nextCursor, hasMore: decoded.hasMore }
  }
}

export function createZhihuFeedService(api: ZhihuApiClient): ZhihuFeedService {
  return new ZhihuFeedService(api)
}
