export const ZHIHU_EDITOR_DOCUMENT_VERSION = 1 as const

export type ZhihuDraftKind = 'answer' | 'pin'
export type ZhihuPublishState = 'local' | 'remote-draft' | 'publishing' | 'unknown' | 'published' | 'failed'

export interface ZhihuEditorDocumentV1 {
  version: typeof ZHIHU_EDITOR_DOCUMENT_VERSION
  /** 可编辑 HTML。未知/未来块必须原样保留，不能经过阅读 sanitizer 回写。 */
  html: string
  /** 纯文本镜像，仅用于列表摘要、长度统计和无障碍兜底。 */
  text: string
}

export interface ZhihuDraftTopic {
  /** 知乎 topic_id；统一存字符串，避免大整数经过 JS number 丢精度。 */
  topicId: string
  name: string
}

export interface ZhihuDraftAsset {
  id: string
  mediaType: string
  fileName?: string
  remoteImageId?: string
  remoteUrl?: string
  remoteOriginalUrl?: string
  remoteWatermarkUrl?: string
  watermarkMode?: string
  width?: number
  height?: number
  uploadState: 'local' | 'requesting' | 'uploading' | 'processing' | 'ready' | 'failed'
  error?: string
}

export interface ZhihuDraftSnapshot {
  schemaVersion: 1
  localDraftId: string
  accountId: string
  kind: ZhihuDraftKind
  targetId?: string
  title?: string
  /** 想法发布时附带的结构化话题；旧草稿没有该字段时按空列表兼容。 */
  topics?: ZhihuDraftTopic[]
  document: ZhihuEditorDocumentV1
  assets: ZhihuDraftAsset[]
  localRevision: number
  remoteDraftId?: string
  publishedContentId?: string
  publishState: ZhihuPublishState
  publishOperationId?: string
  createdAt: number
  updatedAt: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function validateZhihuEditorDocument(value: unknown): ZhihuEditorDocumentV1 {
  if (!isObject(value) || value.version !== 1 || typeof value.html !== 'string' || typeof value.text !== 'string') {
    throw new Error('知乎草稿文档格式无效或版本不受支持')
  }
  return { version: 1, html: value.html, text: value.text }
}

export function validateZhihuDraftSnapshot(value: unknown): ZhihuDraftSnapshot {
  if (!isObject(value)) throw new Error('知乎草稿记录不是 object')
  const kind = value.kind
  if (kind !== 'answer' && kind !== 'pin') throw new Error('知乎草稿类型不受支持')
  if (typeof value.localDraftId !== 'string' || !value.localDraftId) throw new Error('知乎草稿缺少 localDraftId')
  if (typeof value.accountId !== 'string' || !value.accountId) throw new Error('知乎草稿缺少 accountId')
  if (typeof value.localRevision !== 'number' || !Number.isSafeInteger(value.localRevision) || value.localRevision < 0) {
    throw new Error('知乎草稿 localRevision 无效')
  }
  const states: ZhihuPublishState[] = ['local', 'remote-draft', 'publishing', 'unknown', 'published', 'failed']
  if (!states.includes(value.publishState as ZhihuPublishState)) throw new Error('知乎草稿 publishState 无效')
  if (typeof value.createdAt !== 'number' || typeof value.updatedAt !== 'number') throw new Error('知乎草稿时间字段无效')
  const topics = Array.isArray(value.topics) ? value.topics : []
  const validatedTopics: ZhihuDraftTopic[] = []
  const seenTopicIds = new Set<string>()
  for (const topic of topics) {
    if (!isObject(topic) || typeof topic.topicId !== 'string' || !topic.topicId.trim() || typeof topic.name !== 'string' || !topic.name.trim()) {
      throw new Error('知乎草稿话题记录无效')
    }
    const topicId = topic.topicId.trim()
    if (seenTopicIds.has(topicId)) continue
    seenTopicIds.add(topicId)
    validatedTopics.push({ topicId, name: topic.name.trim() })
  }
  const assets = Array.isArray(value.assets) ? value.assets : []
  for (const asset of assets) {
    if (!isObject(asset) || typeof asset.id !== 'string' || typeof asset.mediaType !== 'string' || typeof asset.uploadState !== 'string') {
      throw new Error('知乎草稿资源记录无效')
    }
  }
  return {
    schemaVersion: 1,
    localDraftId: value.localDraftId,
    accountId: value.accountId,
    kind,
    targetId: typeof value.targetId === 'string' ? value.targetId : undefined,
    title: typeof value.title === 'string' ? value.title : undefined,
    topics: validatedTopics.length > 0 ? validatedTopics : undefined,
    document: validateZhihuEditorDocument(value.document),
    assets: assets as unknown as ZhihuDraftAsset[],
    localRevision: value.localRevision,
    remoteDraftId: typeof value.remoteDraftId === 'string' ? value.remoteDraftId : undefined,
    publishedContentId: typeof value.publishedContentId === 'string' ? value.publishedContentId : undefined,
    publishState: value.publishState as ZhihuPublishState,
    publishOperationId: typeof value.publishOperationId === 'string' ? value.publishOperationId : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export function createEmptyZhihuDocument(): ZhihuEditorDocumentV1 {
  return { version: 1, html: '', text: '' }
}

export function createZhihuLocalId(prefix = 'draft'): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}
