import assert from 'node:assert/strict'

import {
  buildAnswerPublishPayload,
  buildPinPublishPayload,
  calculatePinHtmlTextLength,
  ZHIHU_ANSWER_PUBLISH_INCLUDE,
  ZHIHU_PIN_IMAGE_LIMIT,
} from '../src/features/zhihu/editor/codec'
import { ZhihuDraftStore } from '../src/features/zhihu/editor/draftStore'
import { ZhihuEditorService, type ZhihuEditorApi } from '../src/features/zhihu/editor/service'
import { createMemoryZhihuEditorDatabase } from '../src/features/zhihu/storage/database'

class EditorApi implements ZhihuEditorApi {
  readonly requests: Array<{
    operation: string
    url?: string
    body?: string
    headers?: Record<string, string>
    signing?: 'web-zse96' | 'none'
  }> = []
  failPublish = false
  existingAnswerId: string | null = null

  async getJson(operation: string, url: string): Promise<unknown> {
    this.requests.push({ operation, url })
    if (operation === 'answer.relationship') {
      return {
        relationship: {
          my_answer: this.existingAnswerId
            ? { answer_id: this.existingAnswerId, is_deleted: false }
            : null,
        },
      }
    }
    throw new Error(`unexpected GET operation: ${operation}`)
  }

  async requestRawJson(
    operation: string,
    url: string,
    _method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    _signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    this.requests.push({ operation, url, body, headers, signing: options?.signing })
    if (operation === 'pin.topic.recommend') {
      return {
        data: {
          list: [
            { id: 'suggestion-1', name: '人工智能', topicId: 19550517, discussCount: '12.3 万' },
            { id: 'suggestion-duplicate', name: '人工智能重复项', topicId: 19550517 },
            { id: 'suggestion-2', name: '机器学习', topicId: 19552832 },
          ],
        },
      }
    }
    if (operation === 'draft.answer.save' || operation === 'draft.pin.save') {
      return {}
    }
    if (operation === 'answer.publish' && this.failPublish) {
      throw new Error('socket closed after request bytes were sent')
    }
    if (operation === 'answer.publish') {
      return { message: 'success', data: { result: '{"publish":{"id":"answer-9"}}' } }
    }
    if (operation === 'pin.publish') {
      return { message: 'success', data: { result: '{"publish":{"id":"pin-7"}}' } }
    }
    throw new Error(`unexpected operation: ${operation}`)
  }
}

const unknownApi = new EditorApi()
unknownApi.failPublish = true
const unknownStore = new ZhihuDraftStore(createMemoryZhihuEditorDatabase())
let answerDraft = await unknownStore.create('account-a', 'answer', 'question-1')
answerDraft = await unknownStore.save({
  ...answerDraft,
  document: { version: 1, html: '<p>固定快照</p>', text: '固定快照' },
})
const answerPublishPayload = buildAnswerPublishPayload(answerDraft, 'answer-existing') as {
  data: { extra_info: { include: string }; draft: { contentId?: string } }
}
assert.equal(answerPublishPayload.data.extra_info.include, ZHIHU_ANSWER_PUBLISH_INCLUDE)
assert.match(answerPublishPayload.data.extra_info.include, /relationship\.is_authorized/)
assert.equal(answerPublishPayload.data.draft.contentId, 'answer-existing')

const remoteDraftApi = new EditorApi()
remoteDraftApi.existingAnswerId = 'answer-existing'
const remoteDraftStore = new ZhihuDraftStore(createMemoryZhihuEditorDatabase())
const remoteDraftEditor = new ZhihuEditorService(remoteDraftApi, remoteDraftStore)
const remotelySaved = await remoteDraftEditor.saveRemoteDraft(answerDraft)
assert.equal(remotelySaved.publishState, 'remote-draft')
const remoteDraftRequest = remoteDraftApi.requests.find((request) => request.operation === 'draft.answer.save')
assert.equal(
  remoteDraftRequest?.headers?.Referer,
  'https://www.zhihu.com/question/question-1/answer/answer-existing',
  '回答草稿 Referer 必须携带本人已有回答 id，与参考客户端一致',
)
assert.equal(remoteDraftApi.requests.filter((request) => request.operation === 'answer.relationship').length, 1)

const unknownEditor = new ZhihuEditorService(unknownApi, unknownStore)
const unknownResult = await unknownEditor.publish(answerDraft)
assert.equal(unknownResult.status, 'unknown', '发布请求失联不能显示失败后自动补发，也不能伪装成功')
assert.equal(unknownApi.requests.filter((request) => request.operation === 'answer.publish').length, 1, '非幂等发布绝不自动重发')
assert.ok(await unknownStore.get('account-a', answerDraft.localDraftId), 'unknown 发布必须保留本地草稿')
assert.equal((await unknownStore.get('account-a', answerDraft.localDraftId))?.publishState, 'unknown')

const confirmedApi = new EditorApi()
const confirmedStore = new ZhihuDraftStore(createMemoryZhihuEditorDatabase())
let pinDraft = await confirmedStore.create('account-a', 'pin')
pinDraft = await confirmedStore.save({
  ...pinDraft,
  title: '想法标题',
  topics: [
    { topicId: '19550517', name: '人工智能' },
    { topicId: '19552832', name: '#机器学习#' },
  ],
  document: { version: 1, html: '<p>发布正文</p>', text: '发布正文' },
})
assert.equal(calculatePinHtmlTextLength('<p>A <strong>B</strong></p><p>&amp; C</p>'), 7)
const pinPayload = buildPinPublishPayload(pinDraft) as {
  data: {
    hybrid?: { textLength?: number }
    topic?: { topics?: Array<{ topic_id: string; topic_name: string }> }
  }
}
assert.equal(pinPayload.data.hybrid?.textLength, 4, '想法 textLength 必须按编译后 HTML 可见文本计算')
assert.deepEqual(pinPayload.data.topic?.topics, [
  { topic_id: '19550517', topic_name: '#人工智能#' },
  { topic_id: '19552832', topic_name: '#机器学习#' },
])
assert.throws(
  () => buildPinPublishPayload({
    ...pinDraft,
    assets: Array.from({ length: ZHIHU_PIN_IMAGE_LIMIT + 1 }, (_, index) => ({
      id: `asset-${index}`,
      mediaType: 'image/png',
      uploadState: 'ready' as const,
      remoteUrl: `https://pic.example/${index}.png`,
    })),
  }),
  /最多添加 9 张图片/,
  '想法图片上限必须与参考客户端 PIN_IMAGE_LIMIT=9 一致',
)
const editor = new ZhihuEditorService(confirmedApi, confirmedStore)
const suggestions = await editor.recommendPinTopics(' #人工 智能 ', '想法标题', '<p>发布正文</p>')
assert.deepEqual(suggestions.map((item) => [item.topicId, item.name]), [
  ['19550517', '人工智能'],
  ['19552832', '机器学习'],
])
const recommendRequest = confirmedApi.requests.find((request) => request.operation === 'pin.topic.recommend')
assert.match(recommendRequest?.url ?? '', /recommend_type=pin&key_word=%E4%BA%BA%E5%B7%A5\+%E6%99%BA%E8%83%BD/)
assert.deepEqual(JSON.parse(recommendRequest?.body ?? '{}'), { title: '想法标题', content: '<p>发布正文</p>' })
assert.equal(recommendRequest?.signing, 'web-zse96', '话题推荐必须复用参考客户端的 postSigned Web ZSE96')
const confirmed = await editor.publish(pinDraft)
assert.deepEqual(confirmed, { status: 'confirmed', operationId: confirmed.operationId, contentId: 'pin-7' })
const persisted = await confirmedStore.get('account-a', pinDraft.localDraftId)
assert.equal(persisted?.publishState, 'published')
assert.equal(persisted?.publishedContentId, 'pin-7')
assert.equal(confirmedApi.requests.filter((request) => request.operation === 'pin.publish').length, 1)

console.log('zhihu editor publish contract ok')
