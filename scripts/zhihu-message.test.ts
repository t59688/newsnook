import assert from 'node:assert/strict'

import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { encryptZhihuMessageBody } from '../src/features/zhihu/crypto/messageBody'
import { ZhihuNotificationService, type ZhihuNotificationApi } from '../src/features/zhihu/notification/service'
import {
  createMemoryZhihuMessageDraftDatabase,
  ZhihuMessageDraftStore,
} from '../src/features/zhihu/notification/draftStore'

interface RawCall {
  operation: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body: string
  headers: Record<string, string>
  signing?: 'web-zse96' | 'none'
}

class RecordingApi implements ZhihuNotificationApi {
  calls: RawCall[] = []

  async getJson(): Promise<unknown> { throw new Error('send must not issue confirmation GET') }
  async postJson(): Promise<unknown> { throw new Error('send must use encrypted raw body') }
  async requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    _signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    this.calls.push({ operation, url, method, body, headers, signing: options?.signing })
    return {
      id: 'message-1',
      content: '测试 & 消息',
      created_time: Math.floor(Date.now() / 1000),
      sender: { id: 'me', name: '我' },
      receiver: { id: 'peer-id', name: '对方' },
    }
  }
}

assert.equal(
  encryptZhihuMessageBody('hello'),
  '14RJeQ+vLOS4ihOY/LtYCg==',
  '消息体加密必须保持官方 Android 11.3.0 固定向量',
)

const api = new RecordingApi()
const service = new ZhihuNotificationService(api)
const sent = await service.sendMessage('peer-id', ' 测试 & 消息 ')
assert.equal(sent.id, 'message-1')
assert.equal(api.calls.length, 1, '私信发送只能进行一次 POST，不能追加确认 GET 或自动重发')
const sendCall = api.calls[0]!
assert.equal(sendCall.operation, 'message.send')
assert.equal(sendCall.url, 'https://api.zhihu.com/messages')
assert.equal(sendCall.method, 'POST')
assert.equal(sendCall.headers['Content-Type'], 'application/x-www-form-urlencoded')
assert.equal(sendCall.headers['X-Zse-93'], '101_1_1.0')
assert.equal(sendCall.headers['x-api-version'], '3.1.8')
assert.equal(sendCall.headers['x-app-version'], '10.61.0')
assert.match(sendCall.headers['User-Agent'] ?? '', /^com\.zhihu\.android\//)
assert.equal(sendCall.signing, 'none')
const expectedForm = new URLSearchParams([
  ['receiver_id', 'peer-id'],
  ['content', '测试 & 消息'],
  ['content_type', '0'],
  ['source_type', 'message_list'],
]).toString()
assert.equal(sendCall.body, encryptZhihuMessageBody(expectedForm))
assert.ok(!sendCall.body.includes('测试'), '原生消息请求体不得携带私信明文')

const callsBeforeInvalid = api.calls.length
await assert.rejects(service.sendMessage('', '内容'), /接收者不能为空/)
await assert.rejects(service.sendMessage('peer-id', '   '), /内容不能为空/)
assert.equal(api.calls.length, callsBeforeInvalid, '非法输入不得触达 API')

class UnconfirmedApi implements ZhihuNotificationApi {
  rawPosts = 0
  async getJson(): Promise<unknown> { throw new Error('结果未知时不得自动 GET 猜测成功') }
  async postJson(): Promise<unknown> { throw new Error('unexpected JSON POST') }
  async requestRawJson(): Promise<unknown> {
    this.rawPosts += 1
    return { msg: 'success' }
  }
}
const unconfirmedApi = new UnconfirmedApi()
await assert.rejects(
  new ZhihuNotificationService(unconfirmedApi).sendMessage('peer-id', '只发一次'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'conflict',
  '发送响应没有消息实体时必须进入未知结果，不能冒充成功',
)
assert.equal(unconfirmedApi.rawPosts, 1, '非幂等私信发送不能自动重试 POST')

const draftDb = createMemoryZhihuMessageDraftDatabase()
const draftStore = new ZhihuMessageDraftStore(draftDb)
await draftStore.save('account-a', 'peer-1', '未发送内容')
assert.equal(await new ZhihuMessageDraftStore(draftDb).load('account-a', 'peer-1'), '未发送内容')
assert.equal(await draftStore.load('account-b', 'peer-1'), '', '私信草稿不得跨知乎账号读取')
assert.equal(await draftStore.load('account-a', 'peer-2'), '', '私信草稿不得跨会话读取')
await draftStore.clear('account-a', 'peer-1')
assert.equal(await draftStore.load('account-a', 'peer-1'), '')

console.log('zhihu private-message send/read/draft contract ok')
