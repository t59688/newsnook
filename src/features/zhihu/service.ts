import type { NewsSource } from '../../sources/registry'
import type { Article } from '../../lib/types'
import { normalizeZhihuList } from './normalize'
import { readZhihuSession } from './session'
import { zhihuAppUrl, zhihuRequest, zhihuWebUrl } from './client'
import { ZhihuApiError, type ZhihuListResult, type ZhihuProfile } from './types'

const RECOMMEND_LIMIT = 20
const ANSWER_INCLUDE = [
  'content',
  'editable_content',
  'paid_info',
  'can_comment',
  'excerpt',
  'thanks_count',
  'voteup_count',
  'comment_count',
  'visited_count',
  'attachment',
  'reaction',
  'ip_info',
  'pagination_info',
  'question.topics',
  'question.author',
  'author.badge_v2',
  'settings.table_of_contents.enabled',
].join(',')

const PUBLISH_INCLUDE =
  'is_visible,paid_info,paid_info_content,has_column,admin_closed_comment,reward_info,annotation_action,annotation_detail,collapse_reason,is_normal,is_sticky,collapsed_by,suggest_edit,comment_count,thanks_count,favlists_count,can_comment,content,editable_content,voteup_count,reshipment_settings,comment_permission,created_time,updated_time,review_info,relevant_info,question,excerpt,attachment,content_source,is_labeled,endorsements,reaction_instruction,ip_info,relationship.is_authorized,voting,is_thanked,is_author,is_nothelp,is_favorited;author.vip_info,kvip_info,badge[*].topics;settings.table_of_contents.enabled'

type UnknownRecord = Record<string, unknown>
function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : value == null ? '' : String(value) }

export function zhihuRecommendUrl(page = 0): string {
  const offset = Math.max(0, page) * RECOMMEND_LIMIT
  return zhihuWebUrl(`/api/v3/feed/topstory/recommend?desktop=true&limit=${RECOMMEND_LIMIT}&offset=${offset}`)
}

export async function fetchZhihuRecommendRaw(page = 0, signal?: AbortSignal): Promise<unknown> {
  const url = zhihuRecommendUrl(page)
  return zhihuRequest(url, { referer: 'https://www.zhihu.com/', signal })
}

export async function fetchZhihuRecommendText(page = 0, signal?: AbortSignal): Promise<string> {
  return JSON.stringify(await fetchZhihuRecommendRaw(page, signal))
}

export async function fetchZhihuRecommendations(
  source: NewsSource,
  page = 0,
  signal?: AbortSignal,
): Promise<ZhihuListResult> {
  return normalizeZhihuList(source, await fetchZhihuRecommendRaw(page, signal))
}

export async function searchZhihu(
  source: NewsSource,
  query: string,
  offset = 0,
  signal?: AbortSignal,
): Promise<ZhihuListResult> {
  const q = query.trim()
  if (!q) return { articles: [] }
  const params = new URLSearchParams({
    t: 'general',
    q,
    correction: '1',
    offset: String(Math.max(0, offset)),
    limit: '20',
    lc_idx: String(Math.max(0, offset)),
    show_all_topics: '0',
    search_source: 'Normal',
  })
  const payload = await zhihuRequest(zhihuWebUrl(`/api/v4/search_v3?${params.toString()}`), {
    referer: `https://www.zhihu.com/search?type=content&q=${encodeURIComponent(q)}`,
    signal,
  })
  return normalizeZhihuList(source, payload)
}

export async function fetchZhihuHot(
  source: NewsSource,
  signal?: AbortSignal,
): Promise<ZhihuListResult> {
  const payload = await zhihuRequest(zhihuAppUrl('/topstory/hot-lists/total?limit=50&reverse_order=0'), {
    signed: false,
    referer: 'https://www.zhihu.com/hot',
    signal,
  })
  return normalizeZhihuList(source, payload)
}

export async function fetchZhihuFollowing(
  source: NewsSource,
  offset = 0,
  signal?: AbortSignal,
): Promise<ZhihuListResult> {
  const payload = await zhihuRequest(
    zhihuAppUrl(`/moments_v3?feed_type=recommend&offset=${Math.max(0, offset)}`),
    { signed: false, referer: 'https://www.zhihu.com/follow', signal },
  )
  return normalizeZhihuList(source, payload)
}

export async function fetchZhihuContentDetail(article: Article, signal?: AbortSignal): Promise<UnknownRecord> {
  const ref = article.externalRef
  if (ref?.provider !== 'zhihu-main' || !ref.id) throw new ZhihuApiError('API_SCHEMA_CHANGED', '缺少知乎内容标识')
  let path: string
  if (ref.type === 'answer') path = `/api/v4/answers/${ref.id}?include=${encodeURIComponent(ANSWER_INCLUDE)}`
  else if (ref.type === 'article') path = `/api/v4/articles/${ref.id}`
  else if (ref.type === 'question') path = `/api/v4/questions/${ref.id}`
  else if (ref.type === 'pin') path = `/api/v4/pins/${ref.id}`
  else throw new ZhihuApiError('API_SCHEMA_CHANGED', `暂不支持的知乎内容类型：${ref.type}`)

  const payload = await zhihuRequest(zhihuWebUrl(path), { referer: article.originUrl, signal })
  const result = record(payload)
  if (!result) throw new ZhihuApiError('API_SCHEMA_CHANGED', '知乎详情返回格式已变化')
  return result
}

export async function fetchZhihuCommentsRaw(
  type: string,
  id: string,
  nextUrl?: string,
  signal?: AbortSignal,
): Promise<UnknownRecord> {
  const collection = type === 'article' ? 'articles' : type === 'pin' ? 'pins' : type === 'question' ? 'questions' : 'answers'
  const url = nextUrl || zhihuWebUrl(`/api/v4/comment_v5/${collection}/${id}/root_comment?order=normal&limit=20&offset=0`)
  const payload = await zhihuRequest(url, { referer: `https://www.zhihu.com/${type}/${id}`, signal })
  const result = record(payload)
  if (!result) throw new ZhihuApiError('API_SCHEMA_CHANGED', '知乎评论返回格式已变化')
  return result
}

export async function fetchZhihuProfile(signal?: AbortSignal): Promise<ZhihuProfile | undefined> {
  const payload = await zhihuRequest(zhihuWebUrl('/api/v4/me'), { referer: 'https://www.zhihu.com/', signal })
  const root = record(payload)
  if (!root) return undefined
  return {
    id: text(root.id) || undefined,
    urlToken: text(root.url_token ?? root.urlToken) || undefined,
    name: text(root.name) || '知乎用户',
    avatarUrl: text(root.avatar_url ?? root.avatarUrl) || undefined,
    headline: text(root.headline) || undefined,
  }
}

export async function findMyAnswerId(questionId: string, signal?: AbortSignal): Promise<string | undefined> {
  const include = encodeURIComponent('relationship,relationship.my_answer')
  const payload = await zhihuRequest(zhihuWebUrl(`/api/v4/questions/${questionId}?include=${include}`), {
    referer: `https://www.zhihu.com/question/${questionId}`,
    signal,
  })
  const relationship = record(record(payload)?.relationship)
  const answer = record(relationship?.my_answer ?? relationship?.myAnswer)
  if (!answer || answer.is_deleted === true || answer.isDeleted === true) return undefined
  return text(answer.id ?? answer.answer_id ?? answer.answerId) || undefined
}

export interface ZhihuExistingAnswer {
  id: string
  html: string
  tocEnabled: boolean
}

export async function loadMyAnswer(questionId: string, signal?: AbortSignal): Promise<ZhihuExistingAnswer | undefined> {
  const id = await findMyAnswerId(questionId, signal)
  if (!id) return undefined
  const payload = await zhihuRequest(zhihuWebUrl(`/api/v4/answers/${id}?include=${encodeURIComponent(ANSWER_INCLUDE)}`), {
    referer: `https://www.zhihu.com/question/${questionId}/answer/${id}`,
    signal,
  })
  const root = record(payload)
  if (!root) return undefined
  const settings = record(root.settings)
  const toc = record(settings?.table_of_contents ?? settings?.tableOfContents)
  return {
    id,
    html: text(root.editable_content ?? root.editableContent ?? root.content),
    tocEnabled: toc?.enabled === true,
  }
}

function traceId(): string {
  const uuid = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
        const value = Math.floor(Math.random() * 16)
        return (char === 'x' ? value : (value & 0x3) | 0x8).toString(16)
      })
  return `${Date.now()},${uuid}`
}

function pcBusinessParams(tocEnabled: boolean): string {
  return JSON.stringify({
    reshipment_settings: 'allowed',
    comment_permission: 'all',
    reward_setting: { can_reward: false },
    disclaimer_status: 'close',
    disclaimer_type: 'none',
    commercial_report_info: { is_report: false },
    commercial_zhitask_bind_info: null,
    is_report: false,
    table_of_contents_enabled: tocEnabled,
    thank_inviter_status: 'close',
    thank_inviter: '',
  })
}

export async function saveZhihuAnswerDraft(
  questionId: string,
  html: string,
  tocEnabled: boolean,
  answerId?: string,
): Promise<void> {
  const session = await readZhihuSession()
  const xsrf = session?.cookies._xsrf
  if (!xsrf) throw new ZhihuApiError('AUTH_REQUIRED', '知乎登录态缺少 _xsrf，请重新登录')
  await zhihuRequest(zhihuWebUrl(`/api/v4/questions/${questionId}/draft`), {
    method: 'POST',
    referer: `https://www.zhihu.com/question/${questionId}/answer/${answerId ?? ''}`,
    headers: { 'x-xsrftoken': xsrf },
    body: {
      content: html,
      draft_type: 'normal',
      delta_time: 30,
      settings: {
        reshipment_settings: 'allowed',
        comment_permission: 'all',
        can_reward: false,
        tagline: '',
        disclaimer_status: 'close',
        disclaimer_type: 'none',
        commercial_report_info: { is_report: true },
        push_activity: false,
        table_of_contents_enabled: tocEnabled,
        thank_inviter_status: 'close',
        thank_inviter: '',
      },
    },
  })
}

export async function publishZhihuAnswer(
  questionId: string,
  html: string,
  tocEnabled: boolean,
  answerId?: string,
): Promise<string> {
  await saveZhihuAnswerDraft(questionId, html, tocEnabled, answerId)
  const session = await readZhihuSession()
  const xsrf = session?.cookies._xsrf
  if (!xsrf) throw new ZhihuApiError('AUTH_REQUIRED', '知乎登录态缺少 _xsrf，请重新登录')

  const payload = await zhihuRequest(zhihuWebUrl('/api/v4/content/publish'), {
    method: 'POST',
    referer: `https://www.zhihu.com/question/${questionId}/answer/${answerId ?? ''}`,
    headers: { 'x-xsrftoken': xsrf },
    body: {
      action: 'answer',
      data: {
        publish: { traceId: traceId() },
        hybridInfo: {},
        draft: { disabled: 1, isPublished: Boolean(answerId), ...(answerId ? { contentId: answerId } : {}) },
        extra_info: {
          question_id: questionId,
          publisher: 'pc',
          include: PUBLISH_INCLUDE,
          pc_business_params: pcBusinessParams(tocEnabled),
        },
        hybrid: { html },
        reprint: { reshipment_settings: 'allowed' },
        commentsPermission: { comment_permission: 'all' },
        appreciate: { can_reward: false },
        publishSwitch: { draft_type: 'normal' },
        creationStatement: { disclaimer_status: 'close', disclaimer_type: 'none' },
        commercialReportInfo: { isReport: 0 },
        toFollower: {},
        contentsTables: { table_of_contents_enabled: tocEnabled },
        thanksInvitation: { thank_inviter_status: 'close', thank_inviter: '' },
      },
    },
  })

  const root = record(payload)
  if (!root) throw new ZhihuApiError('API_SCHEMA_CHANGED', '知乎发布响应格式已变化')
  if (text(root.message) && text(root.message) !== 'success') {
    throw new ZhihuApiError('REQUEST_FAILED', `知乎发布失败：${text(root.message)}`)
  }
  const resultText = text(record(root.data)?.result)
  if (resultText) {
    try {
      const result = record(JSON.parse(resultText) as unknown)
      const published = record(result?.publish)
      const id = text(published?.id ?? result?.id)
      if (id) return id
    } catch {
      // fall through to known existing id
    }
  }
  if (answerId) return answerId
  throw new ZhihuApiError('API_SCHEMA_CHANGED', '知乎已接受发布，但未返回回答 ID')
}
