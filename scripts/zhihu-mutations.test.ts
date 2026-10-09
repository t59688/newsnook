import assert from 'node:assert/strict'

import type { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuCommentsService } from '../src/features/zhihu/comments/service'
import { ZhihuInteractionService } from '../src/features/zhihu/interaction/service'

type Call = {
  method: string
  operation: string
  url: string
  body?: unknown
  headers?: Record<string, string>
  signing?: 'web-zse96' | 'none'
}

class RecordingApi {
  calls: Call[] = []

  async getJson(operation: string, url: string): Promise<unknown> {
    this.calls.push({ method: 'GET', operation, url })
    if (operation === 'collection.list') {
      return {
        data: [{ id: 'fav-list-1', title: '账号收藏夹', is_public: true, item_count: 5 }],
        paging: {
          is_end: false,
          next: 'https://www.zhihu.com/api/v4/people/account-token/collections?limit=20&offset=20',
        },
      }
    }
    if (operation === 'comment.list-root' || operation === 'segment.comment.list-root') {
      return {
        data: [{
          id: 'c-1',
          content: '<p>root</p>',
          author: { id: 'u-1', name: '甲' },
          like_count: 2,
          liked: false,
          can_delete: true,
          child_comment_count: 0,
        }],
        paging: { is_end: true },
      }
    }
    throw new Error(`unexpected GET ${operation}`)
  }

  async postJson(operation: string, url: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method: 'POST', operation, url, body })
    if (operation === 'comment.create' || operation === 'segment.comment.create') {
      return {
        id: 'c-created',
        content: '<p>created</p>',
        author: { id: 'me', name: '我' },
        like_count: 0,
        liked: false,
        can_delete: true,
        child_comment_count: 0,
      }
    }
    if (operation === 'collection.create') {
      return { status: 100, collection: { id: 'fav-1', title: '资料', is_public: false } }
    }
    if (operation === 'segment.like.set') {
      return { payload: { segId: 'seg-new-a,seg-new-b' } }
    }
    return { voteup_count: 10 }
  }

  async deleteJson(operation: string, url: string, body?: unknown): Promise<unknown> {
    this.calls.push({ method: 'DELETE', operation, url, body })
    if (operation === 'collection.delete') return { success: true }
    return null
  }

  async requestRawJson(
    operation: string,
    url: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    body: string,
    headers: Record<string, string>,
    _signal?: AbortSignal,
    options?: { signing?: 'web-zse96' | 'none' },
  ): Promise<unknown> {
    this.calls.push({ method, operation, url, body, headers, signing: options?.signing })
    return null
  }
}

const api = new RecordingApi()
const interaction = new ZhihuInteractionService(api as unknown as ZhihuApiClient)

const vote = await interaction.setVote({ kind: 'answer', id: '42' }, 'up')
assert.deepEqual(vote, { state: 'up', voteupCount: 10 })
assert.deepEqual(api.calls.at(-1), {
  method: 'POST',
  operation: 'vote.set',
  url: 'https://www.zhihu.com/api/v4/answers/42/voters',
  body: { type: 'up' },
})

await interaction.setVote({ kind: 'answer', id: '42' }, 'down')
assert.deepEqual(api.calls.at(-1)?.body, { type: 'down' })
const beforeArticleDown = api.calls.length
await assert.rejects(
  interaction.setVote({ kind: 'article', id: '9' }, 'down'),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'unsupported',
)
assert.equal(api.calls.length, beforeArticleDown, '文章反对没有可靠协议时不得把取消赞同冒充反对')

const segmentTarget = {
  kind: 'segment' as const,
  contentId: '42',
  contentType: 'answer' as const,
  segmentId: 'seg-old',
  segmentIds: ['seg-old'],
  segmentContent: '被选中的段落',
  displayText: '被选中的段落',
  paragraphId: 'p-1',
  startOffset: 2,
  endOffset: 9,
  liked: false,
  likeCount: 3,
  commentCount: 4,
  myCommentCount: 0,
  isSpan: false,
}
const likedSegment = await interaction.setSegmentLiked(segmentTarget, true)
assert.deepEqual(api.calls.at(-1), {
  method: 'POST',
  operation: 'segment.like.set',
  url: 'https://www.zhihu.com/api/v4/reaction/answers/42/segment_reaction',
  body: {
    seg_id: 'seg-old',
    content: '被选中的段落',
    position: {
      start: { paragraph_id: 'p-1', offset: 2 },
      end: { paragraph_id: 'p-1', offset: 9 },
    },
  },
})
assert.equal(likedSegment.segmentId, 'seg-new-a,seg-new-b')
assert.deepEqual(likedSegment.segmentIds, ['seg-new-a', 'seg-new-b'])
assert.equal(likedSegment.likeCount, 4)
const unlikedSegment = await interaction.setSegmentLiked(likedSegment, false)
assert.deepEqual(api.calls.at(-1), {
  method: 'DELETE',
  operation: 'segment.like.clear',
  url: 'https://www.zhihu.com/api/v4/reaction/answers/42/segment_reaction',
  body: { seg_ids: 'seg-new-a,seg-new-b' },
})
assert.equal(unlikedSegment.likeCount, 3)

await interaction.setFollowing('person', 'alice', true)
assert.equal(api.calls.at(-1)?.operation, 'follow.person.set')
assert.equal(api.calls.at(-1)?.method, 'POST')
await interaction.setFollowing('question', '88', false)
assert.equal(api.calls.at(-1)?.operation, 'follow.question.clear')
assert.equal(api.calls.at(-1)?.method, 'DELETE')

await interaction.setPersonBlocked('alice', true)
assert.equal(api.calls.at(-1)?.operation, 'block.person.set')
assert.equal(api.calls.at(-1)?.url, 'https://www.zhihu.com/api/v4/members/alice/actions/block')
await interaction.setPersonBlocked('alice', false)
assert.equal(api.calls.at(-1)?.operation, 'block.person.clear')
assert.equal(api.calls.at(-1)?.method, 'DELETE')

const collection = await interaction.createCollection(' 资料 ', 'desc', false)
assert.equal(collection.id, 'fav-1')
assert.deepEqual(api.calls.at(-1)?.body, { title: '资料', description: 'desc', is_public: false })

const accountCollections = await interaction.listAccountCollections('account-token')
assert.equal(accountCollections.items[0]?.id, 'fav-list-1')
assert.match(accountCollections.nextCursor ?? '', /offset=20/)
assert.equal(api.calls.at(-1)?.operation, 'collection.list')
await assert.rejects(
  interaction.listAccountCollections('account-token', 'https://evil.example/collections'),
  /请求目标不在允许域内/,
  '账号收藏夹分页必须拒绝非知乎 next URL',
)

const callCountBeforeDefaultDelete = api.calls.length
await assert.rejects(
  interaction.deleteCollection({ id: 'default', title: '默认', isPublic: false, isDefault: true, isFavorited: false }),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'unsupported',
)
assert.equal(api.calls.length, callCountBeforeDefaultDelete, '默认收藏夹必须在发请求前拒绝删除')

await interaction.deleteCollection({ id: 'fav-1', title: '资料', isPublic: false, isDefault: false, isFavorited: false })
assert.equal(api.calls.at(-1)?.url, 'https://www.zhihu.com/api/v4/collections/fav-1')

await interaction.setCollectionMembership({ kind: 'answer', id: '42' }, 'fav-1', true)
assert.deepEqual(api.calls.at(-1), {
  method: 'PUT',
  operation: 'collection.membership',
  url: 'https://api.zhihu.com/collections/contents/answer/42',
  body: 'add_collections=fav-1',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  signing: 'none',
})

const comments = new ZhihuCommentsService(api)
await comments.listRoot({ kind: 'answer', id: '42' })
await comments.setLiked('c-1', true)
assert.equal(comments.cachedRoot({ kind: 'answer', id: '42' })?.items[0]?.liked, true)
assert.equal(comments.cachedRoot({ kind: 'answer', id: '42' })?.items[0]?.likeCount, 3)

await comments.create({ kind: 'answer', id: '42' }, 'A < B & "C"\nnext', 'c-1')
const createCall = api.calls.at(-1)
assert.equal(createCall?.operation, 'comment.create')
assert.deepEqual(createCall?.body, {
  content: '<p>A &lt; B &amp; &quot;C&quot;<br>next</p>',
  reply_comment_id: 'c-1',
})

await comments.listRoot(segmentTarget)
const segmentListCall = api.calls.at(-1)
assert.equal(segmentListCall?.operation, 'segment.comment.list-root')
assert.match(segmentListCall?.url ?? '', /\/comment_v5\/answers\/42\/segment\/root_comment\?segment_id=seg-old/)
assert.match(segmentListCall?.url ?? '', /order_by=score/)
await comments.create(segmentTarget, '段评 <ok>', 'c-1')
const segmentCreateCall = api.calls.at(-1)
assert.equal(segmentCreateCall?.operation, 'segment.comment.create')
assert.equal(segmentCreateCall?.url, 'https://www.zhihu.com/api/v4/comment_v5/answers/42/segment/comment')
assert.deepEqual(segmentCreateCall?.body, {
  content: '<p>段评 &lt;ok&gt;</p>',
  reply_comment_id: 'c-1',
  segment: {
    content: '被选中的段落',
    position: {
      start: { offset: 2, paragraph_id: 'p-1' },
      end: { offset: 9, paragraph_id: 'p-1' },
    },
  },
})

await comments.delete('c-1')
assert.equal(api.calls.at(-1)?.operation, 'comment.delete')
assert.equal(comments.cachedRoot({ kind: 'answer', id: '42' })?.items.some((item) => item.id === 'c-1'), false)

console.log('zhihu mutation services contract ok')
