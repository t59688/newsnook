import type { ZhihuApiClient } from '../api/client'
import { asRecord, decodeZhihuAuthor, decodeZhihuPage } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { validateZhihuCursor } from '../api/endpoints'
import type { Page, ZhihuAuthor, ZhihuContentSummary } from '../types'

export interface ZhihuCollectionDetail {
  id: string
  title: string
  description?: string
  isPublic: boolean
  isFollowing: boolean
  isFavorited: boolean
  isDefault: boolean
  followerCount?: number
  itemCount?: number
  likeCount?: number
  viewCount?: number
  commentCount?: number
  createdAt?: number
  updatedAt?: number
  creator?: ZhihuAuthor
  url: string
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function decodeZhihuCollectionDetail(value: unknown): ZhihuCollectionDetail {
  const root = asRecord(value)
  const collection = asRecord(root?.collection) ?? root
  if (!collection) throw new ZhihuApiError('invalid-response', '知乎收藏夹详情不是 JSON object')
  const id = stringValue(collection.id)
  const title = stringValue(collection.title)
  if (!id || !title) throw new ZhihuApiError('invalid-response', '知乎收藏夹详情缺少 id/title')
  return {
    id,
    title,
    description: stringValue(collection.description),
    isPublic: collection.is_public === true || collection.isPublic === true,
    isFollowing: collection.is_following === true || collection.isFollowing === true,
    isFavorited: collection.is_favorited === true || collection.isFavorited === true,
    isDefault: collection.is_default === true || collection.isDefault === true,
    followerCount: numberValue(collection.follower_count ?? collection.followerCount),
    itemCount: numberValue(collection.item_count ?? collection.itemCount ?? collection.answer_count),
    likeCount: numberValue(collection.like_count ?? collection.likeCount),
    viewCount: numberValue(collection.view_count ?? collection.viewCount),
    commentCount: numberValue(collection.comment_count ?? collection.commentCount),
    createdAt: numberValue(collection.created_time ?? collection.createdTime),
    updatedAt: numberValue(collection.updated_time ?? collection.updatedTime),
    creator: decodeZhihuAuthor(collection.creator),
    url: stringValue(collection.url) ?? `https://www.zhihu.com/collection/${encodeURIComponent(id)}`,
  }
}

export class ZhihuCollectionService {
  private readonly api: Pick<ZhihuApiClient, 'getJson'>

  constructor(api: Pick<ZhihuApiClient, 'getJson'>) {
    this.api = api
  }

  async read(collectionId: string, signal?: AbortSignal): Promise<ZhihuCollectionDetail> {
    const id = collectionId.trim()
    if (!id) throw new ZhihuApiError('invalid-response', '收藏夹 id 为空')
    const raw = await this.api.getJson(
      'collection.read',
      `https://www.zhihu.com/api/v4/collections/${encodeURIComponent(id)}`,
      signal,
    )
    return decodeZhihuCollectionDetail(raw)
  }

  async items(
    collectionId: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const id = collectionId.trim()
    if (!id) throw new ZhihuApiError('invalid-response', '收藏夹 id 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://www.zhihu.com/api/v4/collections/${encodeURIComponent(id)}/items?offset=0&limit=20`
    const decoded = decodeZhihuPage(await this.api.getJson('collection.items', url, signal))
    return {
      items: decoded.items,
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }
}
