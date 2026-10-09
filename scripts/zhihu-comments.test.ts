import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createMemoryZhihuCommentDraftDatabase, ZhihuCommentDraftStore } from '../src/features/zhihu/comments/draftStore'
import { ZhihuCommentsService, decodeZhihuComment, zhihuCommentDraftRef } from '../src/features/zhihu/comments/service'
import { isZhihuOperationEnabled, zhihuOperation } from '../src/features/zhihu/protocol'

const decoded = decodeZhihuComment({
  id: 'comment-1',
  content: '<p>示例评论</p>',
  created_time: 1700000000,
  like_count: 4,
  liked: false,
  child_comment_count: 1,
  author: { id: 'person-1', url_token: 'person-token', name: '示例用户', avatar_url: 'https://pic.example/comment-avatar.jpg' },
  child_comments: [{
    id: 'comment-2',
    content: '<p>示例回复</p>',
    author: { id: 'person-2', url_token: 'person-token-2', name: '回复用户' },
  }],
})
assert.ok(decoded)
assert.equal(decoded?.author.token, 'person-token')
assert.equal(decoded?.author.avatarUrl, 'https://pic.example/comment-avatar.jpg')
assert.equal(decoded?.childCount, 1)
assert.equal(decoded?.children[0]?.id, 'comment-2')
assert.deepEqual(decoded?.media, [])

const mediaDecoded = decodeZhihuComment({
  id: 'comment-media',
  content: '<p>这张图说明得很清楚 <a class="comment_img" href="https://picx.zhimg.com/example.jpg">&lt;图片&gt;</a></p><p><a class="comment_gif" href="//picx.zhimg.com/example.gif">&lt;图片&gt;</a></p><p><a class="comment_sticker" href="https://picx.zhimg.com/sticker.webp">&lt;图片&gt;</a></p>',
  created_time: 1700000000,
  comment_tag: [{ type: 'ip_info', text: '上海' }],
  author: { id: 'person-media', name: '图片用户' },
})
assert.ok(mediaDecoded)
assert.doesNotMatch(mediaDecoded?.contentHtml ?? '', /<图片>|&lt;图片&gt;/, '媒体占位文字不得泄漏到评论正文')
assert.match(mediaDecoded?.contentHtml ?? '', /这张图说明得很清楚/, '媒体前后的评论文字必须保留')
assert.deepEqual(mediaDecoded?.media.map((item) => item.kind), ['image', 'gif', 'sticker'])
assert.equal(mediaDecoded?.media[0]?.url, 'https://picx.zhimg.com/example.jpg')
assert.equal(mediaDecoded?.media[1]?.url, 'https://picx.zhimg.com/example.gif')
assert.equal(mediaDecoded?.ipLocation, '上海')

const inlineImageDecoded = decodeZhihuComment({
  id: 'comment-inline-image',
  content: '<p>直接图片</p><img data-actualsrc="https://picx.zhimg.com/inline.webp" alt="现场照片">',
  author: { id: 'person-inline', name: '内嵌图片用户' },
})
assert.equal(inlineImageDecoded?.media[0]?.url, 'https://picx.zhimg.com/inline.webp')
assert.equal(inlineImageDecoded?.media[0]?.alt, '现场照片')
assert.doesNotMatch(inlineImageDecoded?.contentHtml ?? '', /<img/i, '评论媒体必须由 React 独立渲染，不留 Reader 图片节点')

const calls: Array<{ operation: string; url: string }> = []
const service = new ZhihuCommentsService({
  async getJson(operation, url) {
    calls.push({ operation, url })
    return {
      data: [{
        id: 'comment-1',
        content: '<p>示例评论</p>',
        author: { id: 'person-1', url_token: 'person-token', name: '示例用户' },
      }],
      paging: {
        is_end: false,
        next: 'https://www.zhihu.com/api/v4/comment_v5/answers/answer-1/root_comment?offset=20',
      },
    }
  },
})

const root = await service.listRoot({ kind: 'answer', id: 'answer-1' })
assert.equal(root.items.length, 1)
assert.equal(root.hasMore, true)
assert.equal(service.cachedRoot({ kind: 'answer', id: 'answer-1' })?.items[0]?.id, 'comment-1')
assert.equal(calls[0]?.operation, 'comment.list-root')
assert.ok(calls[0]?.url.includes('/comment_v5/answers/answer-1/root_comment'))
assert.ok(calls[0]?.url.includes('order_by=score'))

await service.listRoot({ kind: 'answer', id: 'answer-1' }, undefined, undefined, 'time')
assert.ok(calls[1]?.url.includes('order_by=ts'))
assert.equal(service.cachedRoot({ kind: 'answer', id: 'answer-1' }, 'time')?.items[0]?.id, 'comment-1')

await service.listChildren('comment-1')
assert.equal(calls[2]?.operation, 'comment.list-child')
assert.ok(calls[2]?.url.includes('/comment_v5/comment/comment-1/child_comment'))
assert.equal(service.cachedChildren('comment-1')?.items[0]?.id, 'comment-1')

const anchorCalls: Array<{ operation: string; url: string }> = []
const anchorService = new ZhihuCommentsService({
  async getJson(operation, url) {
    anchorCalls.push({ operation, url })
    if (operation !== 'comment.read') throw new Error(`unexpected ${operation}`)
    if (url.endsWith('/comment/300')) {
      return {
        id: '300',
        content: '<p>目标子评论</p>',
        reply_root_comment_id: '200',
        author: { id: 'child-user', name: '子评论用户' },
      }
    }
    if (url.endsWith('/comment/200')) {
      return {
        id: '200',
        content: '<p>对应根评论</p>',
        child_comment_count: 3,
        author: { id: 'root-user', name: '根评论用户' },
      }
    }
    throw new Error(`unexpected url ${url}`)
  },
})
const resolvedAnchor = await anchorService.resolveCommentAnchor('300')
assert.equal(resolvedAnchor.target.id, '300')
assert.equal(resolvedAnchor.root.id, '200')
assert.equal(resolvedAnchor.root.children[0]?.id, '300', '评论通知指向子评论时必须把目标子评论挂到根评论下以便直接定位')
assert.deepEqual(anchorCalls.map((call) => call.operation), ['comment.read', 'comment.read'])
assert.match(anchorCalls[0]?.url ?? '', /\/comment\/300$/)
assert.match(anchorCalls[1]?.url ?? '', /\/comment\/200$/)
assert.equal(zhihuOperation('comment.read')?.retry, 'safe-read')

await assert.rejects(
  service.listRoot({ kind: 'answer', id: 'answer-1' }, 'https://example.com/comments'),
  /非法分页地址/,
)

assert.equal(zhihuOperation('comment.create')?.retry, 'never')
assert.equal(zhihuOperation('comment.create')?.status, 'source-only')
assert.equal(isZhihuOperationEnabled('comment.create'), false)
assert.equal(isZhihuOperationEnabled('vote.set'), false)

const draftDb = createMemoryZhihuCommentDraftDatabase()
const draftStore = new ZhihuCommentDraftStore(draftDb)
const answerRef = { kind: 'answer' as const, id: 'answer-1' }
await draftStore.save('account-a', answerRef, undefined, '根评论草稿')
await draftStore.save('account-a', answerRef, 'comment-1', '回复草稿')
assert.equal(await new ZhihuCommentDraftStore(draftDb).load('account-a', answerRef), '根评论草稿')
assert.equal(await draftStore.load('account-a', answerRef, 'comment-1'), '回复草稿')
assert.equal(await draftStore.load('account-b', answerRef), '', '评论草稿不得跨账号读取')
assert.equal(await draftStore.load('account-a', { kind: 'answer', id: 'answer-2' }), '', '评论草稿不得跨内容读取')
await draftStore.clear('account-a', answerRef, 'comment-1')
assert.equal(await draftStore.load('account-a', answerRef, 'comment-1'), '')

const segmentDraftRef = zhihuCommentDraftRef({
  kind: 'segment',
  contentId: 'answer-1',
  contentType: 'answer',
  segmentId: 'seg-a,seg-b',
  segmentIds: ['seg-a', 'seg-b'],
  segmentContent: '段落',
  displayText: '段落',
  paragraphId: 'p-1',
  startOffset: 0,
  endOffset: 2,
  liked: false,
  likeCount: 0,
  commentCount: 0,
  myCommentCount: 0,
  isSpan: false,
})
assert.deepEqual(segmentDraftRef, {
  kind: 'comment',
  id: 'segment:answer:answer-1:seg-a,seg-b',
})
await draftStore.save('account-a', segmentDraftRef, undefined, '段评草稿')
assert.equal(await draftStore.load('account-a', answerRef), '根评论草稿', '段评草稿不得覆盖全文评论草稿')
assert.equal(await draftStore.load('account-a', segmentDraftRef), '段评草稿')

const commentsUiSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuCommentsSection.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(
  commentsUiSource,
  /\[loadedOnce,\s*loading,\s*refValue,\s*service,\s*sort\]/,
  '评论自动加载 effect 不能依赖自己刚 set 的 loading，否则 cleanup 会丢弃唯一响应并永久卡在加载中',
)
assert.match(commentsUiSource, /const controller = new AbortController\(\)/, '评论首屏请求必须可取消而不是用 disposed + loading 自相取消')
assert.match(commentsUiSource, /ZhihuAuthorAvatar author=\{comment\.author\}/, '评论必须显示服务端返回的用户头像，不能只显示姓名首字')
assert.match(commentsUiSource, /查看 \$\{comment\.author\.name\} 的主页/, '评论头像必须保留进入用户主页的点击语义')
assert.match(commentsUiSource, /CommentMedia/, '评论图片、GIF 与贴纸必须走独立媒体组件')
assert.match(commentsUiSource, /onOpenImage/, '评论媒体必须支持点击查看大图')
assert.match(commentsUiSource, /IP属地/, '评论元信息应以低权重常显 IP 属地')
assert.match(commentsUiSource, /resolveCommentAnchor/, '评论通知携带 anchor_comment_id 时必须主动解析目标评论，不能只依赖根评论第一页')

console.log('zhihu comments/drafts contract ok')
