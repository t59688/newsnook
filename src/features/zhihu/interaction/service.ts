import { asRecord } from '../api/decode'
import type { ZhihuApiClient } from '../api/client'
import { validateZhihuCursor } from '../api/endpoints'
import { ZhihuApiError } from '../api/errors'
import type { ZhihuSegmentTarget } from '../segments/normalize'
import type { ZhihuEntityRef } from '../types'

export type ZhihuVoteState = 'up' | 'down' | 'neutral'
export type ZhihuFollowKind = 'person' | 'question' | 'topic'

export interface ZhihuCollectionSummary {
  id: string
  title: string
  description?: string
  isPublic: boolean
  isDefault: boolean
  isFavorited: boolean
  itemCount?: number
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown): boolean {
  return value === true
}

function decodeCollection(value: unknown): ZhihuCollectionSummary | null {
  const root = asRecord(value)
  if (!root) return null
  const id = stringValue(root.id)
  if (!id) return null
  return {
    id,
    title: stringValue(root.title) ?? '未命名收藏夹',
    description: stringValue(root.description),
    isPublic: booleanValue(root.is_public ?? root.isPublic),
    isDefault: booleanValue(root.is_default ?? root.isDefault),
    isFavorited: booleanValue(root.is_favorited ?? root.isFavorited),
    itemCount: numberValue(root.item_count ?? root.itemCount),
  }

}

function decodeCollections(value: unknown): ZhihuCollectionSummary[] {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎收藏夹响应不是 JSON object')
  const data = Array.isArray(root.data) ? root.data : []
  return data.map(decodeCollection).filter((item): item is ZhihuCollectionSummary => Boolean(item))
}

function contentCollectionType(ref: ZhihuEntityRef): 'answer' | 'article' {
  if (ref.kind === 'answer' || ref.kind === 'article') return ref.kind
  throw new ZhihuApiError('unsupported', `${ref.kind} 暂无收藏关系协议`)
}

export class ZhihuInteractionService {
  private readonly api: ZhihuApiClient

  constructor(api: ZhihuApiClient) {
    this.api = api
  }

  async setVote(
    ref: ZhihuEntityRef,
    state: ZhihuVoteState,
    signal?: AbortSignal,
  ): Promise<{ state: ZhihuVoteState; voteupCount?: number }> {
    if (ref.kind !== 'answer' && ref.kind !== 'article') {
      throw new ZhihuApiError('unsupported', `${ref.kind} 暂不支持赞同操作`)
    }
    if (ref.kind === 'article' && state === 'down') {
      throw new ZhihuApiError('unsupported', '知乎文章协议没有可确认的“反对”目标态，不能用取消赞同冒充反对')
    }
    const body = ref.kind === 'answer'
      ? { type: state }
      : { voting: state === 'up' ? 1 : 0 }
    const raw = await this.api.postJson(
      'vote.set',
      `https://www.zhihu.com/api/v4/${ref.kind}s/${encodeURIComponent(ref.id)}/voters`,
      body,
      signal,
    )
    const root = asRecord(raw)
    const voteupCount = numberValue(root?.voteup_count)
    // 赞同写入响应通常返回 voteup_count；neutral/article 响应若只给 2xx 也允许，
    // 但 UI 只在这个 await 成功后切换目标态。
    return { state, voteupCount }
  }

  async setSegmentLiked(
    target: ZhihuSegmentTarget,
    liked: boolean,
    signal?: AbortSignal,
  ): Promise<ZhihuSegmentTarget> {
    const url = `https://www.zhihu.com/api/v4/reaction/${target.contentType}s/${encodeURIComponent(target.contentId)}/segment_reaction`
    if (liked) {
      const body: Record<string, unknown> = {
        content: target.segmentContent,
        position: {
          start: { paragraph_id: target.paragraphId, offset: target.startOffset },
          end: { paragraph_id: target.paragraphId, offset: target.endOffset },
        },
      }
      if (target.segmentIds.length > 0) body.seg_id = target.segmentIds.join(',')
      const raw = await this.api.postJson('segment.like.set', url, body, signal)
      const root = asRecord(raw)
      const payload = asRecord(root?.payload)
      const returnedIds = stringValue(payload?.segId ?? payload?.seg_id)
        ?.split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      const segmentIds = returnedIds?.length ? returnedIds : target.segmentIds
      return {
        ...target,
        segmentIds,
        segmentId: segmentIds.join(',') || target.segmentId,
        liked: true,
        likeCount: target.liked ? target.likeCount : target.likeCount + 1,
      }
    }
    await this.api.deleteJson(
      'segment.like.clear',
      url,
      { seg_ids: target.segmentIds.join(',') || target.segmentId },
      signal,
    )
    return {
      ...target,
      liked: false,
      likeCount: target.liked ? Math.max(0, target.likeCount - 1) : target.likeCount,
    }
  }

  async setFollowing(
    kind: ZhihuFollowKind,
    id: string,
    following: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!id) throw new ZhihuApiError('invalid-response', '关注目标 id 为空')
    const encoded = encodeURIComponent(id)
    const url = kind === 'person'
      ? `https://www.zhihu.com/api/v4/members/${encoded}/followers`
      : kind === 'question'
        ? `https://www.zhihu.com/api/v4/questions/${encoded}/followers`
        : `https://www.zhihu.com/api/v4/topics/${encoded}/followers`
    const operation = `follow.${kind}.${following ? 'set' : 'clear'}`
    if (following) await this.api.postJson(operation, url, undefined, signal)
    else await this.api.deleteJson(operation, url, undefined, signal)
  }

  async setPersonBlocked(urlToken: string, blocked: boolean, signal?: AbortSignal): Promise<void> {
    const normalized = urlToken.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '屏蔽用户 token 为空')
    const url = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/actions/block`
    if (blocked) await this.api.postJson('block.person.set', url, undefined, signal)
    else await this.api.deleteJson('block.person.clear', url, undefined, signal)
  }

  async listContentCollections(ref: ZhihuEntityRef, signal?: AbortSignal): Promise<ZhihuCollectionSummary[]> {
    const type = contentCollectionType(ref)
    const raw = await this.api.getJson(
      'collection.content-list',
      `https://api.zhihu.com/collections/contents/${type}/${encodeURIComponent(ref.id)}?limit=50`,
      signal,
    )
    return decodeCollections(raw)
  }

  async listAccountCollections(
    urlToken: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<{ items: ZhihuCollectionSummary[]; nextCursor?: string; hasMore: boolean }> {
    const normalized = urlToken.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '收藏夹账号 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://www.zhihu.com/api/v4/people/${encodeURIComponent(normalized)}/collections?limit=20&offset=0`
    const raw = await this.api.getJson('collection.list', url, signal)
    const root = asRecord(raw)
    if (!root) throw new ZhihuApiError('invalid-response', '知乎收藏夹列表不是 JSON object')
    const paging = asRecord(root.paging)
    const next = stringValue(paging?.next)
    const hasMore = paging?.is_end !== true && Boolean(next)
    return {
      items: decodeCollections(raw),
      nextCursor: hasMore && next ? validateZhihuCursor(next) : undefined,
      hasMore,
    }
  }

  async createCollection(
    title: string,
    description = '',
    isPublic = false,
    signal?: AbortSignal,
  ): Promise<ZhihuCollectionSummary> {
    const normalized = title.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '收藏夹标题不能为空')
    const raw = await this.api.postJson('collection.create', 'https://www.zhihu.com/api/v4/collections', {
      title: normalized,
      description,
      is_public: isPublic,
    }, signal)
    const root = asRecord(raw)
    const collection = decodeCollection(root?.collection)
    if (!root || numberValue(root.status) !== 100 || !collection) {
      throw new ZhihuApiError('invalid-response', stringValue(root?.message) ?? '知乎没有确认收藏夹创建成功')
    }
    return collection
  }

  async deleteCollection(collection: ZhihuCollectionSummary, signal?: AbortSignal): Promise<void> {
    if (collection.isDefault) throw new ZhihuApiError('unsupported', '默认收藏夹不能删除')
    const raw = await this.api.deleteJson(
      'collection.delete',
      `https://www.zhihu.com/api/v4/collections/${encodeURIComponent(collection.id)}`,
      undefined,
      signal,
    )
    const root = asRecord(raw)
    if (root && root.success !== true) {
      throw new ZhihuApiError('invalid-response', stringValue(root.message) ?? '知乎没有确认收藏夹删除成功')
    }
  }

  async setCollectionMembership(
    ref: ZhihuEntityRef,
    collectionId: string,
    included: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const type = contentCollectionType(ref)
    const field = included ? 'add_collections' : 'remove_collections'
    const body = `${field}=${encodeURIComponent(collectionId)}`
    await this.api.requestRawJson(
      'collection.membership',
      `https://api.zhihu.com/collections/contents/${type}/${encodeURIComponent(ref.id)}`,
      'PUT',
      body,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
      { signing: 'none' },
    )
  }
}
