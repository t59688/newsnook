import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { decodeZhihuContentDetail, decodeZhihuPage } from '../src/features/zhihu/api/decode'
import { zhihuSearchUrl } from '../src/features/zhihu/api/endpoints'
import { parseZhihuJson } from '../src/features/zhihu/api/json'
import { mergeZhihuPages, ZhihuFeedService } from '../src/features/zhihu/feed/service'
import { ZhihuContentRow } from '../src/features/zhihu/ui/ZhihuUi'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

const recommended = JSON.parse(readFileSync('scripts/fixtures/zhihu/feed.recommended.source.json', 'utf8')) as unknown
const decoded = decodeZhihuPage(recommended)
assert.equal(decoded.items.length, 1)
assert.equal(decoded.items[0]?.ref.kind, 'answer')
assert.equal(decoded.items[0]?.ref.id, 'answer-fixture-1')
assert.equal(decoded.items[0]?.title, '用于回归测试的推荐问题')
assert.equal(decoded.hasMore, true)

const unsafeIdPayload = parseZhihuJson('{"data":[{"target":{"type":"answer","id":2082853501567243734,"excerpt":"摘要","question":{"id":2048070738075301109,"title":"大整数问题"}}}],"paging":{"is_end":true}}')
const unsafeIdPage = decodeZhihuPage(unsafeIdPayload)
assert.equal(unsafeIdPage.items[0]?.ref.id, '2082853501567243734', '19 位知乎 ID 不能被 JSON.parse 四舍五入')
assert.equal(unsafeIdPage.items[0]?.title, '大整数问题')

const htmlMarkedSearch = decodeZhihuPage({
  data: [{ target: { type: 'answer', id: 'html-title-1', title: '<em>DeepSeek</em> 崩了吗？', excerpt: '讨论 <em>DeepSeek</em> 的近况' } }],
  paging: { is_end: true },
})
assert.equal(htmlMarkedSearch.items[0]?.title, 'DeepSeek 崩了吗？', '搜索/列表标题不能把 <em> 等服务端高亮标签直接显示给用户')
assert.equal(htmlMarkedSearch.items[0]?.excerpt, '讨论 DeepSeek 的近况')

const illustratedFeed = decodeZhihuPage({
  data: [{
    target: {
      type: 'answer',
      id: 'illustrated-answer-1',
      excerpt: '从正文中提取第一张图片作为信息流封面。',
      content: '<p>正文</p><figure><img src="https://pic.example/preview.jpg" data-original="https://pic.example/original.jpg"></figure>',
      voteup_count: 321,
      question: { id: 'question-1', title: '有图片的回答应该怎样展示？' },
    },
  }],
  paging: { is_end: true },
})
assert.equal(illustratedFeed.items[0]?.imageUrl, 'https://pic.example/original.jpg', '信息流必须从正文第一张图片提取清晰图源')
assert.equal(illustratedFeed.items[0]?.voteupCount, 321)

const illustratedRow = renderToStaticMarkup(React.createElement(ZhihuContentRow, {
  item: illustratedFeed.items[0]!,
  onOpen: () => undefined,
  compact: true,
  showReason: false,
}))
assert.match(illustratedRow, /有图片的回答应该怎样展示？/)
assert.match(illustratedRow, /从正文中提取第一张图片作为信息流封面。/)
assert.match(illustratedRow, /src="https:\/\/pic\.example\/original\.jpg"/)
assert.match(illustratedRow, /321 赞同/, '首页卡片必须展示赞同数量')

const componentCard = {
  data: [{
    id: 'card-1',
    type: 'ComponentCard',
    action: {
      type: 'Route',
      parameter: 'route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F423780782%2Fanswer%2F2027676063409484209%3Fnative%3D0',
    },
    extra: {
      content_id: '2027676063409484209',
      content_type: 'answer',
      business_ext_map: {
        userInfo: {
          memberHashId: 'member-1',
          userName: '示例作者',
          avatarUrl: 'https://pic.example/avatar.jpg',
        },
      },
    },
    children: [
      { type: 'Image', test_id: 'answer.2027676063409484209.author', url: 'https://pic.example/avatar.jpg' },
      { type: 'Text', test_id: 'answer.2027676063409484209.title', text: '现阶段的时代红利是什么？' },
      { type: 'Text', test_id: 'answer.2027676063409484209.description', text: '这是新版 ComponentCard 摘要' },
      { type: 'Image', test_id: 'answer.2027676063409484209.thumbnail', url: 'https://pic.example/content-cover.jpg' },
      {
        type: 'Line',
        elements: [
          { type: 'Reaction', reaction: 'Vote', count: 12345 },
          { type: 'Reaction', reaction: 'Comment', count: '678' },
          { type: 'Reaction', reaction: 'Collect', count: 90 },
        ],
      },
    ],
  }],
  paging: { is_end: true },
}
const componentPage = decodeZhihuPage(componentCard)
assert.equal(componentPage.items.length, 1, '新版 Android ComponentCard 信息流必须可见')
assert.equal(componentPage.items[0]?.ref.id, '2027676063409484209')
assert.equal(componentPage.items[0]?.title, '现阶段的时代红利是什么？')
assert.equal(componentPage.items[0]?.author?.name, '示例作者')
assert.equal(componentPage.items[0]?.voteupCount, 12345, 'Android ComponentCard 必须从 footer reaction=Vote 读取真实赞同数')
assert.equal(componentPage.items[0]?.commentCount, 678, 'Android ComponentCard 必须从 footer reaction=Comment 读取真实评论数')
assert.equal(componentPage.items[0]?.imageUrl, 'https://pic.example/content-cover.jpg', 'ComponentCard 必须跳过作者头像并提取正文缩略图')
assert.match(componentPage.items[0]?.url ?? '', /question\/423780782\/answer\/2027676063409484209/)
const componentRow = renderToStaticMarkup(React.createElement(ZhihuContentRow, {
  item: componentPage.items[0]!,
  onOpen: () => undefined,
  compact: true,
  showReason: false,
}))
assert.match(componentRow, /1\.2万 赞同/, 'Android 推荐卡必须展示解析后的真实赞同数量，而不是横线占位')

const legacyComponentPage = decodeZhihuPage({
  data: [{
    type: 'ComponentCard',
    action: {
      type: 'Route',
      parameter: 'route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F100%2Fanswer%2F200',
    },
    extra: { content_id: '200', content_type: 'answer' },
    children: [
      { type: 'Text', id: 'Text', text: '旧版 Android 卡片标题' },
      { type: 'Text', id: 'text_pin_summary', text: '旧版 Android 卡片摘要' },
    ],
  }],
  paging: { is_end: true },
})
assert.equal(legacyComponentPage.items[0]?.title, '旧版 Android 卡片标题', 'ComponentCard 必须兼容 children.id=Text 标题结构')
assert.equal(legacyComponentPage.items[0]?.excerpt, '旧版 Android 卡片摘要', 'ComponentCard 必须兼容 text_pin_summary 摘要结构')

const blankComponentPage = decodeZhihuPage({
  data: [{
    type: 'ComponentCard',
    action: {
      type: 'Route',
      parameter: 'route_url=https%3A%2F%2Fzhihu.com%2Fquestion%2F100%2Fanswer%2F201',
    },
    extra: { content_id: '201', content_type: 'answer' },
    children: [{ type: 'Image', style: 'ContentImage_default', url: 'https://pic.example/placeholder.png' }],
  }],
  paging: { is_end: true },
})
assert.equal(blankComponentPage.items.length, 0, '没有标题/摘要的占位 ComponentCard 必须跳过，不能渲染成“知乎内容”空卡')

const blankGenericPage = decodeZhihuPage({
  data: [{ target: { type: 'answer', id: 'blank-answer', question: { id: 'blank-question' } } }],
  paging: { is_end: true },
})
assert.equal(blankGenericPage.items.length, 0, '普通 feed wrapper 缺少标题/摘要/正文时也必须跳过，不能伪造“知乎内容”')

const hotListPayload = {
  data: [{
    type: 'hot_list_feed',
    card_id: 'Q_2083123101873844765',
    target: {
      title_area: { text: '如何看待这条知乎热榜？' },
      excerpt_area: { text: '这是热榜摘要' },
      metrics_area: { text: '3590 万热度' },
      text_tag_area: { text: '热议' },
      link: { url: 'https://www.zhihu.com/question/2083123101873844765' },
    },
  }],
}
const hotListPage = decodeZhihuPage(hotListPayload)
assert.equal(hotListPage.items.length, 1, 'hot_list_feed 必须解码成可点击的问题卡片')
assert.deepEqual(hotListPage.items[0]?.ref, { kind: 'question', id: '2083123101873844765' })
assert.equal(hotListPage.items[0]?.title, '如何看待这条知乎热榜？')
assert.equal(hotListPage.items[0]?.excerpt, '这是热榜摘要')
assert.match(hotListPage.items[0]?.recommendationReason ?? '', /3590 万热度/)

const merged = mergeZhihuPages(
  { items: decoded.items, nextCursor: 'cursor-a', hasMore: true },
  { items: decoded.items, nextCursor: 'cursor-a', hasMore: true },
)
assert.equal(merged.items.length, 1, '重叠分页实体必须去重')
assert.equal(merged.hasMore, false, '重复游标必须停止，避免无限加载循环')

const answer = JSON.parse(readFileSync('scripts/fixtures/zhihu/answer.read.source.json', 'utf8')) as unknown
const detail = decodeZhihuContentDetail(answer)
assert.equal(detail.ref.kind, 'answer')
assert.equal(detail.author?.name, '示例用户')
assert.ok(detail.url.includes('/question/question-fixture-1/answer/answer-fixture-1'))

const calls: Array<{ operation: string; url: string }> = []
const service = new ZhihuFeedService({
  async getJson(operation, url) {
    calls.push({ operation, url })
    return recommended
  },
})
const page = await service.listFeed('recommended')
assert.equal(page.items.length, 1)
assert.equal(calls[0]?.operation, 'feed.recommended')
assert.equal(calls[0]?.url, 'https://api.zhihu.com/topstory/recommend')

const hotCalls: Array<{ operation: string; url: string; headers?: Record<string, string>; signing?: string }> = []
const hotService = new ZhihuFeedService({
  async getJson(operation, url) {
    hotCalls.push({ operation, url })
    return recommended
  },
  async getJsonWithHeaders(operation, url, headers, _signal, options) {
    hotCalls.push({ operation, url, headers, signing: options?.signing })
    return recommended
  },
})
await hotService.listFeed('hot')
assert.equal(hotCalls[0]?.operation, 'feed.hot')
assert.match(hotCalls[0]?.url ?? '', /hot-lists\/total/)
assert.match(hotCalls[0]?.headers?.['User-Agent'] ?? '', /^com\.zhihu\.android\//, '游客热榜必须带知乎 Android 公共读取头，否则上游直接 401')
assert.equal(hotCalls[0]?.headers?.['x-api-version'], '3.1.8')
assert.equal(hotCalls[0]?.signing, 'none', '游客热榜没有 d_c0，不应伪造 ZSE 签名')

const filteredSearchUrl = new URL(zhihuSearchUrl('储能 系统', 40, 20, {
  tab: 'general',
  sort: 'most-voted',
  contentType: 'answer',
  timeRange: 'month',
}))
assert.equal(filteredSearchUrl.searchParams.get('t'), 'general')
assert.equal(filteredSearchUrl.searchParams.get('offset'), '40')
assert.equal(filteredSearchUrl.searchParams.get('sort'), 'upvoted_count')
assert.equal(filteredSearchUrl.searchParams.get('vertical'), 'answer')
assert.equal(filteredSearchUrl.searchParams.get('time_interval'), 'a_month')
assert.equal(filteredSearchUrl.searchParams.get('search_source'), 'Filter')

const restrictedSearchUrl = new URL(zhihuSearchUrl('储能', 0, 20, {
  tab: 'general',
  restrictedMemberHashId: 'member-hash-1',
}))
assert.equal(restrictedSearchUrl.searchParams.get('restricted_scene'), 'member')
assert.equal(restrictedSearchUrl.searchParams.get('restricted_field'), 'member_hash_id')
assert.equal(restrictedSearchUrl.searchParams.get('restricted_value'), 'member-hash-1')
assert.equal(restrictedSearchUrl.searchParams.get('filter_fields'), '')
assert.equal(restrictedSearchUrl.searchParams.get('lc_idx'), '0')

const peopleSearchUrl = new URL(zhihuSearchUrl('示例用户', 0, 20, {
  tab: 'people',
  sort: 'latest',
  contentType: 'article',
  timeRange: 'year',
}))
assert.equal(peopleSearchUrl.searchParams.get('t'), 'people')
assert.equal(peopleSearchUrl.searchParams.get('sort'), null, '用户搜索不应错误继承内容排序过滤器')
assert.equal(peopleSearchUrl.searchParams.get('vertical'), null)
assert.equal(peopleSearchUrl.searchParams.get('time_interval'), null)

const topicSearchUrl = new URL(zhihuSearchUrl('电池', 0, 20, { tab: 'topic' }))
assert.equal(topicSearchUrl.searchParams.get('show_all_topics'), '1')

console.log('zhihu feed decoder/service contract ok')
