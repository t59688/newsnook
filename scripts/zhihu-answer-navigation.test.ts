import assert from 'node:assert/strict'

import * as answerNavigationModule from '../src/features/zhihu/content/answerNavigation'
import { ZhihuAnswerNavigator } from '../src/features/zhihu/content/answerNavigation'
import type { ZhihuContentDetail } from '../src/features/zhihu/api/decode'
import {
  answerSwipeCommitDistance,
  answerSwipeStartEdge,
  canStartAnswerWheelSequence,
  resolveAnswerSwipeDirection,
  shouldCommitAnswerSwipe,
} from '../src/features/zhihu/content/answerSwipe'
import type { Page, ZhihuContentSummary } from '../src/features/zhihu/types'

function answers(...ids: string[]): ZhihuContentSummary[] {
  return ids.map((id) => ({
    ref: { kind: 'answer', id },
    title: id,
    excerpt: '',
    url: `https://www.zhihu.com/answer/${id}`,
  }))
}

const answerPages = new Map<string, Page<ZhihuContentSummary>>([
  ['first', {
    items: answers('answer-1', 'answer-2'),
    nextCursor: 'page-2',
    hasMore: true,
  }],
  ['page-2', {
    items: answers('answer-3', 'answer-4'),
    hasMore: false,
  }],
])
const calls: Array<{ questionId: string; order: string; cursor?: string }> = []
const navigator = new ZhihuAnswerNavigator({
  async questionAnswers(questionId, order, cursor) {
    calls.push({ questionId, order, cursor })
    return answerPages.get(cursor ?? 'first')!
  },
})

const second = await navigator.neighbors('question-1', 'answer-2')
assert.deepEqual(second, {
  previous: { kind: 'answer', id: 'answer-1' },
  next: { kind: 'answer', id: 'answer-3' },
  previousPreview: answers('answer-1')[0],
  nextPreview: answers('answer-3')[0],
}, '默认排序分页边界上的回答必须连接成连续队列')

const third = await navigator.neighbors('question-1', 'answer-3')
assert.equal(second.next?.id, 'answer-3')
assert.equal(third.previous?.id, 'answer-2', '点击下一个后再点上一个必须回到刚才的回答')
assert.deepEqual(calls, [
  { questionId: 'question-1', order: 'default', cursor: undefined },
  { questionId: 'question-1', order: 'default', cursor: 'page-2' },
], '回答导航只能按问题回答列表的默认排序读取，且已读取顺序必须复用')

assert.deepEqual(await navigator.neighbors('question-1', 'answer-1'), {
  previous: undefined,
  next: { kind: 'answer', id: 'answer-2' },
  previousPreview: undefined,
  nextPreview: answers('answer-2')[0],
}, '第一个回答必须禁用向上导航')
assert.deepEqual(await navigator.neighbors('question-1', 'answer-4'), {
  previous: { kind: 'answer', id: 'answer-3' },
  next: undefined,
  previousPreview: answers('answer-3')[0],
  nextPreview: undefined,
}, '最后一个回答必须禁用向下导航')

let releaseConcurrentPage: ((page: Page<ZhihuContentSummary>) => void) | undefined
let concurrentCalls = 0
const concurrentNavigator = new ZhihuAnswerNavigator({
  async questionAnswers() {
    concurrentCalls += 1
    return new Promise<Page<ZhihuContentSummary>>((resolve) => {
      releaseConcurrentPage = resolve
    })
  },
})
const concurrentFirst = concurrentNavigator.neighbors('question-concurrent', 'answer-1')
const concurrentSecond = concurrentNavigator.neighbors('question-concurrent', 'answer-1')
await Promise.resolve()
assert.equal(concurrentCalls, 1, '同一问题同一游标的并发导航解析只能发出一次分页请求')
releaseConcurrentPage?.({ items: answers('answer-1', 'answer-2'), hasMore: false })
assert.deepEqual(await concurrentFirst, {
  previous: undefined,
  next: { kind: 'answer', id: 'answer-2' },
  previousPreview: undefined,
  nextPreview: answers('answer-2')[0],
})
assert.deepEqual(await concurrentSecond, {
  previous: undefined,
  next: { kind: 'answer', id: 'answer-2' },
  previousPreview: undefined,
  nextPreview: answers('answer-2')[0],
})

let retryCalls = 0
const retryNavigator = new ZhihuAnswerNavigator({
  async questionAnswers() {
    retryCalls += 1
    if (retryCalls === 1) throw new Error('temporary failure')
    return { items: answers('answer-1', 'answer-2'), hasMore: false }
  },
})
await assert.rejects(
  retryNavigator.neighbors('question-retry', 'answer-1'),
  /temporary failure/,
  '回答队列失败必须暴露给界面，而不是伪装成已到末尾',
)
assert.deepEqual(await retryNavigator.neighbors('question-retry', 'answer-1'), {
  previous: undefined,
  next: { kind: 'answer', id: 'answer-2' },
  previousPreview: undefined,
  nextPreview: answers('answer-2')[0],
}, '失败游标必须允许显式重试')
assert.equal(retryCalls, 2)

assert.equal(answerSwipeStartEdge(300, 1200, 600), 'none', '从正文中间开始的快速滑动不得进入回答切换')
assert.equal(answerSwipeStartEdge(0, 1200, 600), 'start')
assert.equal(answerSwipeStartEdge(600, 1200, 600), 'end')
assert.equal(answerSwipeStartEdge(0, 500, 600), 'both', '短回答必须允许用户明确选择上拉或下拉方向')
assert.equal(resolveAnswerSwipeDirection('start', 80), 'previous')
assert.equal(resolveAnswerSwipeDirection('start', -80), null, '顶部向上滚动不得误判为切换')
assert.equal(resolveAnswerSwipeDirection('end', -80), 'next')
assert.equal(resolveAnswerSwipeDirection('end', 80), null, '底部向下滚动不得误判为切换')
assert.equal(resolveAnswerSwipeDirection('both', 80), 'previous')
assert.equal(resolveAnswerSwipeDirection('both', -80), 'next')

const phoneHeight = 720
const commitDistance = answerSwipeCommitDistance(phoneHeight)
assert.ok(commitDistance >= 120)
assert.equal(shouldCommitAnswerSwipe(commitDistance - 1, phoneHeight, true, 500), false, '短拖拽松手必须回弹')
assert.equal(shouldCommitAnswerSwipe(commitDistance, phoneHeight, true, 120), false, '快速轻扫必须采用更严格的位移阈值，避免误触')
assert.equal(shouldCommitAnswerSwipe(phoneHeight * 0.4, phoneHeight, true, 120), true, '短时间且有明确大位移的快速甩动应该切换')
assert.equal(shouldCommitAnswerSwipe(phoneHeight, phoneHeight, true, 60), false, '极短触摸仍不能误触切换')
assert.equal(shouldCommitAnswerSwipe(commitDistance, phoneHeight, true, 300), true, '持续拖过阈值后松手才切换')
assert.equal(shouldCommitAnswerSwipe(phoneHeight, phoneHeight, false, 500), false, '首尾没有相邻回答时永不提交')
assert.equal(canStartAnswerWheelSequence('end', 'next', 40), false, '把页面惯性滚到边界的同一轮滚动不得触发')
assert.equal(canStartAnswerWheelSequence('end', 'next', 220), true, '停顿后新一轮持续边界滚动才可开始预览')
assert.equal(canStartAnswerWheelSequence('start', 'next', 220), false)

type AnswerDetailPreloaderConstructor = new (reader: {
  read: (ref: { kind: 'answer'; id: string }) => Promise<ZhihuContentDetail>
}) => {
  load: (ref: { kind: 'answer'; id: string }) => Promise<ZhihuContentDetail>
  peek: (ref: { kind: 'answer'; id: string }) => ZhihuContentDetail | undefined
}
const AnswerDetailPreloader = (answerNavigationModule as unknown as {
  ZhihuAnswerDetailPreloader?: AnswerDetailPreloaderConstructor
}).ZhihuAnswerDetailPreloader
assert.ok(AnswerDetailPreloader, '回答切换必须有可复用的正文预载器')

let detailCalls = 0
let releaseDetail: ((detail: ZhihuContentDetail) => void) | undefined
const detailPreloader = new AnswerDetailPreloader({
  read: async () => {
    detailCalls += 1
    return new Promise<ZhihuContentDetail>((resolve) => { releaseDetail = resolve })
  },
})
const prefetchedDetail: ZhihuContentDetail = {
  ...answers('answer-2')[0]!,
  contentHtml: '<p>已预加载的完整正文</p>',
  segmentInfos: [],
  allowSegmentInteraction: false,
  voteState: 'neutral',
  isFollowing: false,
  questionId: 'question-1',
}
const detailFirst = detailPreloader.load({ kind: 'answer', id: 'answer-2' })
const detailSecond = detailPreloader.load({ kind: 'answer', id: 'answer-2' })
await Promise.resolve()
assert.equal(detailCalls, 1, '相同回答的预载与页面打开必须复用同一请求')
releaseDetail?.(prefetchedDetail)
assert.equal(await detailFirst, prefetchedDetail)
assert.equal(await detailSecond, prefetchedDetail)
assert.equal(detailPreloader.peek({ kind: 'answer', id: 'answer-2' }), prefetchedDetail)
assert.equal(await detailPreloader.load({ kind: 'answer', id: 'answer-2' }), prefetchedDetail)
assert.equal(detailCalls, 1, '已预载的回答在切换时不得重复请求')

console.log('zhihu ordered answer navigation ok')
