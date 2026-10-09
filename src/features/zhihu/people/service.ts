import { asRecord, decodeZhihuPage, decodeZhihuSummary } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { validateZhihuCursor } from '../api/endpoints'
import type { Page, ZhihuContentSummary } from '../types'
import type { ZhihuReadApi } from '../feed/service'

export type PeopleContentKind = 'answers' | 'articles' | 'questions' | 'pins'
export type PeopleRelationKind = 'followers' | 'following'
export type PeopleCollectionKind = 'collections' | 'following-collections'
export type PeopleColumnKind = 'columns' | 'following-columns'

// 知乎这些分页端点不是同一套“members/:token/:kind”模板。
// 尤其想法实际走 /api/v4/v2/pins/:token/moments；回答/文章/提问也依赖各自 include。
// 缺字段或套错路径时上游会直接返回“请求参数异常，请升级客户端后重试”。
const PEOPLE_CONTENT_INCLUDE: Record<PeopleContentKind, string> = {
  answers: 'data[*].is_normal,admin_closed_comment,reward_info,is_collapsed,annotation_action,annotation_detail,collapse_reason,collapsed_by,suggest_edit,comment_count,thanks_count,can_comment,content,editable_content,attachment,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,excerpt,paid_info,reaction_instruction,is_labeled,label_info,relationship.is_authorized,voting,is_author,is_thanked,is_nothelp,author.badge_v2',
  articles: 'data[*].comment_count,suggest_edit,is_normal,thumbnail_extra_info,thumbnail,can_comment,comment_permission,admin_closed_comment,content,voteup_count,created,updated,upvoted_followees,voting,review_info,reaction_instruction,is_labeled,label_info,author.badge_v2;data[*].vessay_info;data[*].author.badge[?(type=best_answerer)].topics;',
  questions: 'data[*].created,answer_count,follower_count,author,visit_count,comment_count,detail,relationship,topics,voteup_count',
  pins: 'data[*].like_count,comment_count,created,updated,content',
}

const PEOPLE_RELATION_INCLUDE = 'data[*].answer_count,articles_count,gender,follower_count,is_followed,is_following,badge_v2,badge[?(type=best_answerer)].topics'
const PEOPLE_COLLECTION_INCLUDE = 'data[*].updated_time,answer_count,follower_count,creator'
const PEOPLE_COLUMN_INCLUDE = 'data[*].articles_count,followers,author'

function withInclude(raw: string, include: string): string {
  const url = new URL(raw)
  if (include) url.searchParams.set('include', include)
  return url.href
}

function peopleContentInitialUrl(token: string, kind: PeopleContentKind): string {
  const encoded = encodeURIComponent(token)
  const raw = kind === 'pins'
    ? `https://www.zhihu.com/api/v4/v2/pins/${encoded}/moments`
    : `https://www.zhihu.com/api/v4/members/${encoded}/${kind}`
  const url = new URL(raw)
  if (kind === 'answers') url.searchParams.set('sort_by', 'voteups')
  if (kind === 'articles') url.searchParams.set('sort_by', 'created')
  url.searchParams.set('include', PEOPLE_CONTENT_INCLUDE[kind])
  return url.href
}

export interface ZhihuPeopleColumn {
  id: string
  title: string
  description?: string
  intro?: string
  avatarUrl?: string
  articlesCount: number
  followerCount: number
  isFollowing: boolean
  url: string
}

export interface ZhihuPeopleProfile {
  id: string
  token: string
  name: string
  avatarUrl?: string
  headline?: string
  description?: string
  followerCount?: number
  followingCount?: number
  answerCount?: number
  articleCount?: number
  questionCount?: number
  isFollowing: boolean
  isBlocking: boolean
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function paging(value: unknown): { nextCursor?: string; hasMore: boolean } {
  const root = asRecord(value)
  const valuePaging = asRecord(root?.paging)
  const next = stringValue(valuePaging?.next)
  const nextCursor = next ? validateZhihuCursor(next) : undefined
  return {
    nextCursor,
    hasMore: valuePaging?.is_end !== true && Boolean(nextCursor),
  }
}

function pageData(value: unknown): unknown[] {
  const root = asRecord(value)
  return Array.isArray(root?.data) ? root.data : []
}

function zhihuColumnWebUrl(rawUrl: unknown, id: string): string {
  const value = stringValue(rawUrl)?.trim()
  if (value) {
    try {
      const url = new URL(value.replace(/^http:\/\//i, 'https://'))
      if (url.protocol === 'https:' && (url.hostname === 'zhihu.com' || url.hostname.endsWith('.zhihu.com'))) {
        if (url.pathname.includes('/api/v4/columns/')) {
          const columnId = url.pathname.split('/api/v4/columns/')[1]?.split('/')[0] || id
          return `https://www.zhihu.com/column/${encodeURIComponent(columnId)}`
        }
        if (!url.pathname.startsWith('/api/')) return url.href
      }
    } catch {
      // Fall back to the canonical first-party column URL below.
    }
  }
  return `https://www.zhihu.com/column/${encodeURIComponent(id)}`
}

export function decodeZhihuPeopleColumn(value: unknown): ZhihuPeopleColumn {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎专栏不是 JSON object')
  const id = stringValue(root.id)?.trim()
  const title = stringValue(root.title)?.trim()
  if (!id || !title) throw new ZhihuApiError('invalid-response', '知乎专栏缺少 id/title')
  const followerCount = Math.max(
    numberValue(root.follower_count) ?? 0,
    numberValue(root.followers) ?? 0,
  )
  return {
    id,
    title,
    description: stringValue(root.description)?.trim() || undefined,
    intro: stringValue(root.intro)?.trim() || undefined,
    avatarUrl: stringValue(root.avatar_url ?? root.avatarUrl)?.trim() || undefined,
    articlesCount: numberValue(root.articles_count ?? root.articlesCount) ?? 0,
    followerCount,
    isFollowing: root.is_following === true || root.isFollowing === true,
    url: zhihuColumnWebUrl(root.url, id),
  }
}

export function decodeZhihuPeopleProfile(value: unknown): ZhihuPeopleProfile {
  const root = asRecord(value)
  if (!root) throw new ZhihuApiError('invalid-response', '知乎用户资料不是 JSON object')
  const id = stringValue(root.id) ?? stringValue(root.url_token)
  const token = stringValue(root.url_token) ?? id
  const name = stringValue(root.name)
  if (!id || !token || !name) throw new ZhihuApiError('invalid-response', '知乎用户资料缺少 id/token/name')
  return {
    id,
    token,
    name,
    avatarUrl: stringValue(root.avatar_url),
    headline: stringValue(root.headline),
    description: stringValue(root.description),
    followerCount: numberValue(root.follower_count),
    followingCount: numberValue(root.following_count),
    answerCount: numberValue(root.answer_count),
    articleCount: numberValue(root.articles_count),
    questionCount: numberValue(root.question_count),
    isFollowing: root.is_following === true || root.isFollowing === true,
    isBlocking: root.is_blocking === true || root.isBlocking === true,
  }
}

export class ZhihuPeopleService {
  private readonly api: ZhihuReadApi

  constructor(api: ZhihuReadApi) {
    this.api = api
  }

  async read(token: string, signal?: AbortSignal): Promise<ZhihuPeopleProfile> {
    if (!token.trim()) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = `https://api.zhihu.com/people/${encodeURIComponent(token)}`
    return decodeZhihuPeopleProfile(await this.api.getJson('people.read', url, signal))
  }

  async listContent(
    token: string,
    kind: PeopleContentKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : peopleContentInitialUrl(normalized, kind)
    const decoded = decodeZhihuPage(await this.api.getJson('people.content', url, signal))
    return {
      items: decoded.items,
      nextCursor: decoded.nextCursor,
      hasMore: decoded.hasMore,
    }
  }

  async listActivities(
    token: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : `https://www.zhihu.com/api/v3/moments/${encodeURIComponent(normalized)}/activities`
    const decoded = decodeZhihuPage(await this.api.getJson('people.activities', url, signal))
    return { items: decoded.items, nextCursor: decoded.nextCursor, hasMore: decoded.hasMore }
  }

  async listRelations(
    profile: Pick<ZhihuPeopleProfile, 'id' | 'token'>,
    kind: PeopleRelationKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuPeopleProfile>> {
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'followers'
        ? withInclude(`https://api.zhihu.com/people/${encodeURIComponent(profile.id)}/followers`, PEOPLE_RELATION_INCLUDE)
        : withInclude(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(profile.token)}/followees`, PEOPLE_RELATION_INCLUDE)
    const raw = await this.api.getJson(kind === 'followers' ? 'people.followers' : 'people.following', url, signal)
    const items = pageData(raw).map((item) => {
      try {
        return decodeZhihuPeopleProfile(item)
      } catch {
        return null
      }
    }).filter((item): item is ZhihuPeopleProfile => Boolean(item))
    return { items, ...paging(raw) }
  }

  async listFollowingEntities(
    token: string,
    kind: 'questions' | 'topics',
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'questions'
        ? `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-questions`
        : `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-topic-contributions`
    const operation = kind === 'questions' ? 'people.following-questions' : 'people.following-topics'
    const raw = await this.api.getJson(operation, url, signal)
    const items = pageData(raw).map((entry) => {
      const object = asRecord(entry)
      const candidate = kind === 'topics' ? object?.topic ?? entry : entry
      return decodeZhihuSummary(candidate)
    }).filter((item): item is ZhihuContentSummary => Boolean(item))
    return { items, ...paging(raw) }
  }

  async listColumns(
    token: string,
    kind: PeopleColumnKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuPeopleColumn>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : withInclude(
          `https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/${kind === 'columns' ? 'column-contributions' : 'following-columns'}`,
          PEOPLE_COLUMN_INCLUDE,
        )
    const raw = await this.api.getJson(`people.${kind}`, url, signal)
    const items = pageData(raw).map((entry) => {
      try {
        return decodeZhihuPeopleColumn(entry)
      } catch {
        return null
      }
    }).filter((item): item is ZhihuPeopleColumn => Boolean(item))
    return { items, ...paging(raw) }
  }

  async listCollections(
    token: string,
    kind: PeopleCollectionKind,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<ZhihuContentSummary>> {
    const normalized = token.trim()
    if (!normalized) throw new ZhihuApiError('invalid-response', '用户 token 为空')
    const url = cursor
      ? validateZhihuCursor(cursor)
      : kind === 'collections'
        ? withInclude(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/favlists`, PEOPLE_COLLECTION_INCLUDE)
        : withInclude(`https://www.zhihu.com/api/v4/members/${encodeURIComponent(normalized)}/following-favlists`, PEOPLE_COLLECTION_INCLUDE)
    const raw = await this.api.getJson(`people.${kind}`, url, signal)
    const items = pageData(raw).map((entry) => {
      const object = asRecord(entry)
      if (!object) return null
      return decodeZhihuSummary({ ...object, type: stringValue(object.type) ?? 'collection' })
    }).filter((item): item is ZhihuContentSummary => Boolean(item))
    return { items, ...paging(raw) }
  }
}
