import type { Page, ZhihuAuthor, ZhihuContentSummary, ZhihuEntityKind, ZhihuEntityRef } from '../types'

type JsonRecord = Record<string, unknown>

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter((item): item is string => Boolean(item))
}

function booleanCompat(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  return false
}

function htmlText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function pinContentHtml(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value.map((rawItem) => {
    const item = asRecord(rawItem)
    if (!item) return ''
    if (item.type === 'image') {
      const src = imageFromValue(item)
      if (!src) return ''
      const alt = stringValue(item.alt_text) ?? stringValue(item.alt) ?? ''
      return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></figure>`
    }
    const content = stringValue(item.content)?.trim()
    if (!content) return ''
    return /<\/?[a-z][^>]*>/i.test(content)
      ? content
      : `<p>${escapeHtml(content).replace(/\r?\n/g, '<br>')}</p>`
  }).filter(Boolean).join('')
}

function pinContentText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map(asRecord)
    .map((item) => htmlText(item?.content))
    .filter(Boolean)
    .join(' ')
}

function safeImageUrl(value: unknown): string | undefined {
  const raw = stringValue(value)?.trim().replaceAll('&amp;', '&')
  if (!raw) return undefined
  try {
    const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
    return url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function imageFromValue(value: unknown): string | undefined {
  const direct = safeImageUrl(value)
  if (direct) return direct
  if (Array.isArray(value)) {
    for (const item of value) {
      const image = imageFromValue(item)
      if (image) return image
    }
    return undefined
  }
  const record = asRecord(value)
  if (!record) return undefined
  for (const key of ['original_url', 'originalUrl', 'image_url', 'imageUrl', 'url', 'src', 'thumbnail']) {
    const image = safeImageUrl(record[key])
    if (image) return image
  }
  return undefined
}

function imageFromHtml(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const tag = value.match(/<img\b[^>]*>/i)?.[0]
  if (!tag) return undefined
  for (const attribute of ['data-original-src', 'data-original', 'data-actualsrc', 'src']) {
    const match = new RegExp(`${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)
    const image = safeImageUrl(match?.[2])
    if (image) return image
  }
  return undefined
}

function summaryImage(object: JsonRecord): string | undefined {
  for (const key of ['thumbnail', 'thumbnail_info', 'image_url', 'imageUrl', 'cover', 'cover_url']) {
    const image = imageFromValue(object[key])
    if (image) return image
  }
  for (const key of ['images', 'image_list']) {
    const image = imageFromValue(object[key])
    if (image) return image
  }
  if (Array.isArray(object.content)) {
    const image = object.content
      .map(asRecord)
      .filter((item): item is JsonRecord => Boolean(item) && item?.type === 'image')
      .map(imageFromValue)
      .find((item): item is string => Boolean(item))
    if (image) return image
  }
  return imageFromHtml(object.content) ?? imageFromHtml(object.content_html) ?? imageFromHtml(object.excerpt)
}

export function decodeZhihuAuthor(value: unknown): ZhihuAuthor | undefined {
  const author = asRecord(value)
  if (!author) return undefined
  const id = stringValue(author.id) ?? stringValue(author.url_token)
  const name = stringValue(author.name)
  if (!id || !name) return undefined
  return {
    id,
    token: stringValue(author.url_token),
    name,
    avatarUrl: stringValue(author.avatar_url),
    headline: stringValue(author.headline),
  }
}

function entityKind(value: unknown): ZhihuEntityKind | null {
  switch (value) {
    case 'answer': case 'article': case 'pin': case 'question': case 'people': case 'collection': case 'comment': case 'topic':
      return value
    default:
      return null
  }
}

function canonicalUrl(ref: ZhihuEntityRef, object: JsonRecord): string {
  const explicit = stringValue(object.url)
  if (explicit?.startsWith('http')) return explicit
  switch (ref.kind) {
    case 'answer': {
      const question = asRecord(object.question)
      const qid = stringValue(question?.id)
      return qid ? `https://www.zhihu.com/question/${qid}/answer/${ref.id}` : `https://www.zhihu.com/answer/${ref.id}`
    }
    case 'article': return `https://zhuanlan.zhihu.com/p/${ref.id}`
    case 'question': return `https://www.zhihu.com/question/${ref.id}`
    case 'pin': return `https://www.zhihu.com/pin/${ref.id}`
    case 'people': return `https://www.zhihu.com/people/${encodeURIComponent(stringValue(object.url_token) ?? ref.id)}`
    case 'collection': return `https://www.zhihu.com/collection/${encodeURIComponent(ref.id)}`
    case 'topic': return `https://www.zhihu.com/topic/${encodeURIComponent(ref.id)}/hot`
    default: return `https://www.zhihu.com/`
  }
}

function refFromZhihuUrl(raw: string | undefined): ZhihuEntityRef | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || !(url.hostname === 'zhihu.com' || url.hostname === 'www.zhihu.com' || url.hostname === 'zhuanlan.zhihu.com')) return null
    let match = /^\/question\/(\d+)\/answer\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'answer', id: match[2]! }
    match = /^\/question\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'question', id: match[1]! }
    match = /^\/p\/(\d+)/.exec(url.pathname)
    if (match && url.hostname === 'zhuanlan.zhihu.com') return { kind: 'article', id: match[1]! }
    match = /^\/pin\/(\d+)/.exec(url.pathname)
    if (match) return { kind: 'pin', id: match[1]! }
  } catch {
    return null
  }
  return null
}

function componentRouteUrl(card: JsonRecord): string | undefined {
  const action = asRecord(card.action)
  const parameter = stringValue(action?.parameter)
  if (!parameter) return undefined
  try {
    const route = new URLSearchParams(parameter).get('route_url')
    if (!route) return undefined
    const url = new URL(route)
    if (url.hostname === 'zhihu.com') url.hostname = 'www.zhihu.com'
    return url.href
  } catch {
    return undefined
  }
}

function collectRecords(value: unknown, output: JsonRecord[] = []): JsonRecord[] {
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, output)
    return output
  }
  const record = asRecord(value)
  if (!record) return output
  output.push(record)
  for (const nested of Object.values(record)) collectRecords(nested, output)
  return output
}

function componentText(records: JsonRecord[], suffix: string): string | undefined {
  const match = records.find((record) => stringValue(record.test_id)?.endsWith(suffix) && typeof record.text === 'string')
  return stringValue(match?.text)
}

function componentTextById(records: JsonRecord[], id: string): string | undefined {
  const match = records.find((record) => stringValue(record.id) === id && typeof record.text === 'string')
  return stringValue(match?.text)
}

function componentReactionCount(records: JsonRecord[], reaction: string): number | undefined {
  const match = records.find((record) => stringValue(record.reaction)?.toLowerCase() === reaction.toLowerCase())
  return numberValue(match?.count)
}

function decodeHotListFeed(card: JsonRecord): ZhihuContentSummary | null {
  if (card.type !== 'hot_list_feed') return null
  const target = asRecord(card.target)
  if (!target) return null
  const link = asRecord(target.link)
  const rawUrl = stringValue(link?.url)
  let ref = refFromZhihuUrl(rawUrl)
  if (!ref) {
    const cardId = stringValue(card.card_id)
    const questionId = cardId?.startsWith('Q_') ? cardId.slice(2) : undefined
    if (questionId && /^\d+$/.test(questionId)) ref = { kind: 'question', id: questionId }
  }
  if (!ref) return null
  const title = htmlText(stringValue(asRecord(target.title_area)?.text)) || '知乎热榜'
  const excerpt = htmlText(stringValue(asRecord(target.excerpt_area)?.text))
  const metrics = stringValue(asRecord(target.metrics_area)?.text)
  const tag = stringValue(asRecord(target.text_tag_area)?.text)
  return {
    ref,
    title,
    excerpt,
    url: rawUrl ?? canonicalUrl(ref, {}),
    imageUrl: imageFromValue(target.image_area) ?? summaryImage(target),
    recommendationReason: [tag, metrics].filter(Boolean).join(' · ') || undefined,
  }
}

function decodeComponentCard(card: JsonRecord): ZhihuContentSummary | null {
  if (card.type !== 'ComponentCard') return null
  const extra = asRecord(card.extra)
  const rawType = stringValue(extra?.content_type)?.toLowerCase()
  const contentId = stringValue(extra?.content_id)
  const routeUrl = componentRouteUrl(card)
  const routeRef = refFromZhihuUrl(routeUrl)
  const kind = entityKind(rawType)
  const ref = kind && contentId ? { kind, id: contentId } satisfies ZhihuEntityRef : routeRef
  if (!ref) return null

  const records = collectRecords(card.children)
  const passthrough = asRecord(extra?.passthrough_info ?? extra?.passthroughInfo)
  const passthroughContent = asRecord(passthrough?.content)
  const title = htmlText(
    componentText(records, '.title')
    ?? componentTextById(records, 'Text')
    ?? stringValue(passthroughContent?.title),
  )
  const excerpt = htmlText(
    componentText(records, '.description')
    ?? componentTextById(records, 'text_pin_summary'),
  )
  if (!title && !excerpt) return null
  const displayTitle = title || excerpt
  const displayExcerpt = title ? excerpt : ''
  const business = asRecord(extra?.business_ext_map)
  const user = asRecord(business?.userInfo)
  const authorName = stringValue(user?.userName)
  const authorId = stringValue(user?.memberHashId)
  const author = authorName && authorId ? {
    id: authorId,
    token: authorId,
    name: authorName,
    avatarUrl: stringValue(user?.avatarUrl),
  } : undefined
  const voteupCount = componentReactionCount(records, 'Vote')
  const commentCount = componentReactionCount(records, 'Comment')
  const imageRecord = records.find((record) => {
    const testId = stringValue(record.test_id)?.toLowerCase()
    const style = stringValue(record.style)?.toLowerCase()
    if (testId && /(?:author|avatar|feedback|badge|icon)/.test(testId)) return false
    return Boolean(
      testId?.endsWith('.image')
      || testId?.endsWith('.thumbnail')
      || testId?.endsWith('.cover')
      || (style && /(?:content|feed|cover|thumbnail).*image|image.*(?:content|feed|cover|thumbnail)/.test(style)),
    )
  })

  return {
    ref,
    title: displayTitle,
    excerpt: displayExcerpt,
    url: routeUrl ?? canonicalUrl(ref, {}),
    author,
    voteupCount,
    commentCount,
    imageUrl: imageRecord ? imageFromValue(imageRecord) : undefined,
  }
}

export function decodeZhihuSummary(value: unknown): ZhihuContentSummary | null {
  let object = asRecord(value)
  if (!object) return null
  const hot = decodeHotListFeed(object)
  if (hot) return hot
  const component = decodeComponentCard(object)
  if (component) return component

  // feed/search wrappers
  object = asRecord(object.target) ?? asRecord(object.object) ?? asRecord(object.content) ?? object

  const kind = entityKind(object.type) ?? (object.question && object.content ? 'answer' : null)
  const id = stringValue(object.id)
  if (!kind || !id) return null
  const ref: ZhihuEntityRef = { kind, id }
  const question = asRecord(object.question)
  const title = htmlText(stringValue(object.title) ?? stringValue(question?.title) ?? stringValue(object.name))
  const excerpt = htmlText(stringValue(object.excerpt))
    || htmlText(object.content)
    || (kind === 'pin' ? pinContentText(object.content) : '')
  if (!title && !excerpt && kind !== 'pin') return null
  return {
    ref,
    title: title || excerpt || '知乎想法',
    excerpt: title ? excerpt : '',
    url: canonicalUrl(ref, object),
    author: decodeZhihuAuthor(object.author),
    voteupCount: numberValue(object.voteup_count) ?? (kind === 'pin' ? numberValue(object.like_count) : undefined),
    commentCount: numberValue(object.comment_count),
    createdAt: numberValue(object.created_time) ?? numberValue(object.created_at),
    imageUrl: summaryImage(object),
  }
}

export interface DecodedZhihuPage extends Page<ZhihuContentSummary> {
  skipped: number
}

export function decodeZhihuPage(value: unknown): DecodedZhihuPage {
  const root = asRecord(value)
  if (!root) throw new Error('知乎响应不是 JSON object')
  const data = Array.isArray(root.data) ? root.data : []
  const items: ZhihuContentSummary[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const raw of data) {
    const item = decodeZhihuSummary(raw)
    if (!item) {
      skipped += 1
      continue
    }
    const key = `${item.ref.kind}:${item.ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
  }
  const paging = asRecord(root.paging)
  const next = stringValue(paging?.next)
  const isEnd = paging?.is_end === true
  return { items, nextCursor: next || undefined, hasMore: Boolean(next) && !isEnd, skipped }
}

export interface ZhihuSegmentMeta {
  segIds: string[]
  isLike: boolean
  likeCount: number
  commentCount: number
  myCommentCount: number
  isSpan: boolean
}

export interface ZhihuSegmentInfoMark {
  startIndex: number
  endIndex: number
  segInfo?: ZhihuSegmentMeta
  masterSegInfo?: ZhihuSegmentMeta
}

export interface ZhihuSegmentInfoParagraph {
  pid: string
  text: string
  marks: ZhihuSegmentInfoMark[]
}

function decodeZhihuSegmentMeta(value: unknown): ZhihuSegmentMeta | undefined {
  const root = asRecord(value)
  if (!root) return undefined
  return {
    segIds: stringArray(root.segIds ?? root.seg_ids),
    isLike: booleanCompat(root.isLike ?? root.is_like),
    likeCount: numberValue(root.likeCount ?? root.like_count) ?? 0,
    commentCount: numberValue(root.commentCount ?? root.comment_count) ?? 0,
    myCommentCount: numberValue(root.myCommentCount ?? root.my_comment_count) ?? 0,
    isSpan: booleanCompat(root.isSpan ?? root.is_span),
  }
}

export function decodeZhihuSegmentInfos(value: unknown): ZhihuSegmentInfoParagraph[] {
  if (!Array.isArray(value)) return []
  const paragraphs: ZhihuSegmentInfoParagraph[] = []
  for (const rawParagraph of value) {
    const paragraph = asRecord(rawParagraph)
    const pid = stringValue(paragraph?.pid)?.trim()
    const text = stringValue(paragraph?.text)
    if (!paragraph || !pid || text == null) continue
    const rawMarks = Array.isArray(paragraph.marks) ? paragraph.marks : []
    const marks: ZhihuSegmentInfoMark[] = []
    for (const rawMark of rawMarks) {
      const mark = asRecord(rawMark)
      const startIndex = numberValue(mark?.startIndex ?? mark?.start_index)
      const endIndex = numberValue(mark?.endIndex ?? mark?.end_index)
      if (!mark || startIndex == null || endIndex == null) continue
      const segInfo = decodeZhihuSegmentMeta(mark.segInfo ?? mark.seg_info)
      const masterSegInfo = decodeZhihuSegmentMeta(mark.masterSegInfo ?? mark.master_seg_info)
      if (!segInfo && !masterSegInfo) continue
      marks.push({ startIndex, endIndex, segInfo, masterSegInfo })
    }
    paragraphs.push({ pid, text, marks })
  }
  return paragraphs
}

export interface ZhihuContentDetail extends ZhihuContentSummary {
  contentHtml: string
  /** 编辑器专用原始可编辑 HTML；不能用阅读 sanitizer 的结果覆盖。 */
  editableContentHtml?: string
  createdAt?: number
  updatedAt?: number
  ipLocation?: string
  questionId?: string
  previousAnswerIds?: string[]
  nextAnswerIds?: string[]
  segmentInfos: ZhihuSegmentInfoParagraph[]
  allowSegmentInteraction: boolean
  voteState: 'up' | 'down' | 'neutral'
  isFollowing: boolean
}

export function decodeZhihuContentDetail(value: unknown): ZhihuContentDetail {
  const object = asRecord(value)
  const summary = decodeZhihuSummary(object)
  if (!object || !summary) throw new Error('知乎正文缺少实体 id/type')
  const contentHtml = stringValue(object.content)
    ?? (summary.ref.kind === 'pin' ? pinContentHtml(object.content) : undefined)
    ?? stringValue(object.detail)
    ?? ''
  const question = asRecord(object.question)
  const reaction = asRecord(object.reaction)
  const relation = asRecord(reaction?.relation)
  const relationship = asRecord(object.relationship)
  const pagination = asRecord(object.pagination_info) ?? asRecord(object.paginationInfo)
  const rawVote = stringValue(relation?.vote)?.toLowerCase()
  const ipInfo = asRecord(object.ip_info)
  const voteState = rawVote === 'up' || rawVote === 'down' ? rawVote : 'neutral'
  return {
    ...summary,
    contentHtml,
    editableContentHtml: stringValue(object.editable_content) ?? contentHtml,
    createdAt: numberValue(object.created_time) ?? numberValue(object.created),
    updatedAt: numberValue(object.updated_time) ?? numberValue(object.updated),
    ipLocation: stringValue(object.ip_info) ?? stringValue(ipInfo?.text) ?? stringValue(ipInfo?.location),
    questionId: stringValue(question?.id),
    previousAnswerIds: stringArray(pagination?.prev_answer_ids ?? pagination?.prevAnswerIds),
    nextAnswerIds: stringArray(pagination?.next_answer_ids ?? pagination?.nextAnswerIds),
    segmentInfos: decodeZhihuSegmentInfos(object.segment_infos ?? object.segmentInfos),
    allowSegmentInteraction: booleanCompat(object.allow_segment_interaction ?? object.allowSegmentInteraction),
    voteState,
    isFollowing: relationship?.is_following === true || relation?.following === true,
  }
}
