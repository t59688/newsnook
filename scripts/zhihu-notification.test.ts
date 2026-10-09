import assert from 'node:assert/strict'

import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import {
  mergeZhihuNotificationItems,
  type ZhihuNotificationApi,
  ZhihuNotificationService,
} from '../src/features/zhihu/notification/service'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from '../src/features/zhihu/transport/types'

class NotificationTransport implements ZhihuTransport {
  calls: ZhihuRequest[] = []

  async request(input: ZhihuRequest): Promise<ZhihuResponse> {
    this.calls.push(input)
    if (input.operation === 'notification.list') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          head: [
            { detail_title: '评论转发@', unread_count: 3 },
            { detail_title: '赞同喜欢', unread_count: 2 },
          ],
          unread: { message: { count: 9 } },
          column_head: [{
            id: 'invite-entry',
            title: '邀请回答',
            text_prefix: '你有 ',
            text: '新的回答邀请',
            target_link: 'https://www.zhihu.com/notifications/invited-questions',
            unread_count: 2,
            created: 1785742999,
            avatar_urls: [{ url: 'https://pic.example/invite.jpg', night_url: 'https://pic.example/invite-night.jpg' }],
          }],
          data: [{
            unique_id: 'overview-1',
            created: 1785743000,
            is_read: false,
            content: { title: '有人评论了你', text: '测试通知' },
          }, {
            unique_id: 'message-thread-1',
            type: 'aggregate_notification',
            unread_count: 4,
            is_read: true,
            created_str: '1785743002',
            head: {
              avatar_url: 'https://pic.example/thread.jpg',
              target_link: 'https://www.zhihu.com/notifications',
              author: { id: 'peer-id', url_token: 'peer-token', name: '私信用户' },
            },
            content: {
              title: '私信用户',
              text: '会话摘要',
              target_link: 'https://www.zhihu.com/notifications',
              sub_target_link: 'https://www.zhihu.com/inbox/peer-token?source_type=message_list',
            },
          }],
          paging: {
            is_end: false,
            next: 'https://api.zhihu.com/notifications/v3/message/v3?limit=20&offset=20',
          },
        }),
      }
    }
    if (input.operation === 'notification.timeline') {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: [{
            unique_id: 'comment-1',
            created: 1785743001,
            is_read: false,
            content: {
              title: '评论',
              text: '分类通知',
              target_link: 'zhihu://comment/list/answer/2?anchor_comment_id=3',
            },
            target_source: {
              text: '被评论的回答',
              target_link: 'https://www.zhihu.com/question/1/answer/2',
            },
          }],
          paging: { is_end: true, next: '' },
        }),
      }
    }
    if (input.operation === 'notification.readall') {
      return { status: 200, headers: {}, body: '{}' }
    }
    throw new Error(`unexpected operation: ${input.operation}`)
  }
}

const session = new ZhihuSessionService()
session.switchAccount({ id: 'me', name: '我' }, 'authenticated')
const transport = new NotificationTransport()
const service = new ZhihuNotificationService(new ZhihuApiClient(transport, session))

const overview = await service.overview()
assert.equal(overview.items[0]?.id, 'overview-1')
assert.equal(overview.unread.comment, 3)
assert.equal(overview.unread.like, 2)
assert.equal(overview.unread.favlist_me, 0)
assert.equal(overview.totalUnread, 9, 'message/v3 unread.message.count 是消息页总未读，不是私信未读')
assert.equal(overview.invitation?.id, 'invite-entry')
assert.equal(overview.invitation?.title, '邀请回答')
assert.equal(overview.invitation?.text, '你有 新的回答邀请')
assert.equal(overview.invitation?.avatarUrl, 'https://pic.example/invite.jpg')
assert.equal(overview.items[1]?.title, '私信用户')
assert.equal(overview.items[1]?.unread, true, '会话卡 unread_count > 0 时应显示未读')
assert.equal(overview.items[1]?.avatarUrl, 'https://pic.example/thread.jpg')
assert.match(overview.items[1]?.targetUrl ?? '', /\/inbox\/peer-token/, '同一卡片有多个链接时必须优先私信 inbox 链接')
assert.match(overview.nextCursor ?? '', /offset=20/)
assert.equal(transport.calls.at(-1)?.url, 'https://api.zhihu.com/notifications/v3/message/v3?limit=20')
assert.equal(transport.calls.at(-1)?.headers?.['x-api-version'], '3.1.8')
assert.equal(transport.calls.at(-1)?.headers?.['x-app-version'], '10.61.0')
assert.match(transport.calls.at(-1)?.headers?.['User-Agent'] ?? '', /^com\.zhihu\.android\//)
assert.equal(transport.calls.at(-1)?.signing, 'none', '移动通知读取不能混入 Web x-zse-96 签名')

const timeline = await service.timeline('comment')
assert.equal(timeline.items[0]?.id, 'comment-1')
assert.equal(timeline.items[0]?.unread, true)
assert.equal(
  timeline.items[0]?.targetUrl,
  'zhihu://comment/list/answer/2?anchor_comment_id=3',
  '评论通知必须保留官方 zhihu:// comment deep link，由应用内评论定位器处理',
)
assert.equal(
  transport.calls.at(-1)?.url,
  'https://api.zhihu.com/notifications/v3/timeline/entry/comment?limit=20',
)

await service.timeline('invite')
assert.equal(
  transport.calls.at(-1)?.url,
  'https://api.zhihu.com/notifications/v3/timeline/entry/invite?invite_with_time_slice=1&limit=20',
  '邀请回答必须使用官方移动端带 time-slice 参数的时间线入口',
)

await assert.rejects(
  service.timeline('comment', 'https://evil.example/notifications'),
  /请求目标不在允许域内/,
  '分类通知 next URL 必须拒绝非知乎域',
)

const callsBeforeMark = transport.calls.length
await service.markCategoryRead('comment')
assert.equal(transport.calls.length, callsBeforeMark + 1, '已有明确 endpoint 的通知已读操作应触达 transport')
assert.equal(transport.calls.at(-1)?.operation, 'notification.readall')
assert.equal(
  transport.calls.at(-1)?.url,
  'https://api.zhihu.com/notifications/v3/timeline/entry/comment/actions/readall',
)
assert.equal(transport.calls.at(-1)?.headers?.['x-api-version'], '3.1.8')
assert.match(transport.calls.at(-1)?.headers?.['User-Agent'] ?? '', /^com\.zhihu\.android\//)
assert.equal(transport.calls.at(-1)?.signing, 'none', '移动通知已读操作不能混入 Web x-zse-96 签名')

class ReadAllApi implements ZhihuNotificationApi {
  calls: Array<{ operation: string; url: string }> = []
  async getJson(): Promise<unknown> { throw new Error('unexpected GET') }
  async postJson(operation: string, url: string): Promise<unknown> {
    this.calls.push({ operation, url })
    return {}
  }
  async requestRawJson(): Promise<unknown> { throw new Error('unexpected raw write') }
}
const readAllApi = new ReadAllApi()
await new ZhihuNotificationService(readAllApi).markCategoryRead('comment')
assert.deepEqual(readAllApi.calls, [{
  operation: 'notification.readall',
  url: 'https://api.zhihu.com/notifications/v3/timeline/entry/comment/actions/readall',
}])

const merged = mergeZhihuNotificationItems(
  [{ id: 'same', title: '旧', text: '', unread: true }],
  [
    { id: 'same', title: '重复', text: '', unread: false },
    { id: 'new', title: '新', text: '', unread: true },
  ],
)
assert.deepEqual(merged.map((item) => item.id), ['same', 'new'])

const guest = new ZhihuSessionService()
const guestService = new ZhihuNotificationService(new ZhihuApiClient(new NotificationTransport(), guest))
await assert.rejects(
  guestService.overview(),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'auth-expired',
)

console.log('zhihu notification contract ok')
