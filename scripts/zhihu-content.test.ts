import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { feedArticleId } from '../src/lib/articleId'
import { articleFromSharePayload, buildShareUrl, parseShareUrl, sharePayloadFromArticle } from '../src/lib/shareLink'
import { decodeZhihuContentDetail } from '../src/features/zhihu/api/decode'
import { zhihuEntityUrl } from '../src/features/zhihu/api/endpoints'
import { parseZhihuJson } from '../src/features/zhihu/api/json'
import { toNewsArticle } from '../src/features/zhihu/content/bridge'
import { normalizeZhihuContentHtml } from '../src/features/zhihu/content/normalize'
import { parseZhihuCommentDeepLink, parseZhihuLink, parseZhihuVideoId } from '../src/features/zhihu/content/links'
import { ZhihuContentService } from '../src/features/zhihu/content/service'
import { ZhihuSearchScreen } from '../src/features/zhihu/ui/ZhihuSearchScreen'
import { ZhihuAnswerContinuation, ZhihuAnswerMeta, ZhihuAnswerPeek } from '../src/features/zhihu/ui/ZhihuUi'

;(globalThis as typeof globalThis & { React: typeof React }).React = React

assert.deepEqual(
  parseZhihuLink('https://www.zhihu.com/question/123/answer/456'),
  { kind: 'answer', id: '456' },
)
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/question/123'), { kind: 'question', id: '123' })
assert.deepEqual(parseZhihuLink('https://zhuanlan.zhihu.com/p/789'), { kind: 'article', id: '789' })
assert.deepEqual(parseZhihuLink('https://www.zhihu.com/people/example-user'), { kind: 'people', id: 'example-user' })
assert.equal(parseZhihuLink('https://example.com/question/123'), null)
assert.deepEqual(
  parseZhihuCommentDeepLink('zhihu://comment/list/answer/2?anchor_comment_id=3'),
  { ref: { kind: 'answer', id: '2' }, commentId: '3' },
  '评论通知的 zhihu:// deep link 必须在应用内解析，不能交给外部 Browser',
)
assert.equal(parseZhihuCommentDeepLink('zhihu://comment/list/answer/2'), null, '缺少 anchor_comment_id 的评论 deep link 不得伪造目标')
assert.equal(parseZhihuVideoId('https://www.zhihu.com/video/2081068623192224666'), '2081068623192224666')
assert.equal(parseZhihuVideoId('https://www.zhihu.com/question/123'), null)

const answerUrl = zhihuEntityUrl({ kind: 'answer', id: '2027676063409484209' })
assert.match(answerUrl ?? '', /include=/)
assert.doesNotMatch(decodeURIComponent(answerUrl ?? ''), /pagination_info/, '回答详情不得请求不保证默认排序的上下回答 ID')
const pagedDetail = decodeZhihuContentDetail(parseZhihuJson(`{
  "id": 2027676063409484209,
  "type": "answer",
  "content": "<p>正文</p>",
  "editable_content": "<p data-pid='editable'>可编辑正文</p>",
  "created_time": 1700000000,
  "updated_time": 1700003600,
  "ip_info": "上海",
  "question": { "id": 423780782, "title": "问题" },
  "pagination_info": {
    "index": 12,
    "prev_answer_ids": [2027000000000000001],
    "next_answer_ids": [2028000000000000002, 2028000000000000003]
  }
}`))
assert.equal(pagedDetail?.ref.id, '2027676063409484209')
assert.equal(pagedDetail?.editableContentHtml, "<p data-pid='editable'>可编辑正文</p>", '编辑已有回答必须保留 editable_content，而不是把阅读 HTML 回写')
// 解码器继续兼容偶尔随详情返回的字段，但回答导航不会消费它们。
assert.deepEqual(pagedDetail?.previousAnswerIds, ['2027000000000000001'])
assert.deepEqual(pagedDetail?.nextAnswerIds, ['2028000000000000002', '2028000000000000003'])
assert.equal(pagedDetail?.createdAt, 1700000000)
assert.equal(pagedDetail?.updatedAt, 1700003600)
assert.equal(pagedDetail?.ipLocation, '上海')

const reportedPinDetail = decodeZhihuContentDetail(parseZhihuJson(`{
  "id": 2087929019488548306,
  "type": "pin",
  "content": [
    { "type": "text", "content": "<p>这是一条想法正文。</p>" },
    { "type": "image", "url": "https://pic1.zhimg.com/reported-pin.jpg" }
  ],
  "like_count": 17,
  "comment_count": 3,
  "created": 1700000000,
  "author": { "id": "pin-author", "name": "想法作者" }
}`))
assert.deepEqual(reportedPinDetail.ref, { kind: 'pin', id: '2087929019488548306' })
assert.match(reportedPinDetail.contentHtml, /<p>这是一条想法正文。<\/p>/, '想法的结构化文本必须转换为正文 HTML')
assert.match(reportedPinDetail.contentHtml, /<img[^>]+reported-pin\.jpg/, '想法的结构化图片必须进入正文')
assert.equal(reportedPinDetail.voteupCount, 17, '想法的 like_count 必须映射为统一赞同数')
assert.equal(reportedPinDetail.createdAt, 1700000000)

const answerMeta = renderToStaticMarkup(React.createElement(ZhihuAnswerMeta, {
  createdAt: pagedDetail.createdAt,
  updatedAt: pagedDetail.updatedAt,
  ipLocation: pagedDetail.ipLocation,
}))
assert.match(answerMeta, /发布于/)
assert.match(answerMeta, /编辑于/)
assert.match(answerMeta, /IP 属地/)
assert.match(answerMeta, /上海/)

const answerLoading = renderToStaticMarkup(React.createElement(ZhihuAnswerContinuation, {
  state: 'loading',
}))
assert.match(answerLoading, /正在加载相邻回答/, '回答队列解析中必须有明确状态')
const answerRetry = renderToStaticMarkup(React.createElement(ZhihuAnswerContinuation, {
  state: 'error',
  error: '网络暂不可用',
  onRetry: () => undefined,
}))
assert.match(answerRetry, /网络暂不可用/)
assert.match(answerRetry, /重试加载相邻回答/, '回答队列失败必须提供显式重试入口')
const answerEnd = renderToStaticMarkup(React.createElement(ZhihuAnswerContinuation, {
  state: 'end',
}))
assert.match(answerEnd, /已是最后一个回答/, '问题末尾必须明确告知用户')

const previousAnswerPeek = renderToStaticMarkup(React.createElement(ZhihuAnswerPeek, {
  direction: 'previous',
  phase: 'ready',
  item: {
    ref: { kind: 'answer', id: 'previous-answer' },
    title: '同一问题',
    excerpt: '上一个回答的摘要预览',
    url: 'https://www.zhihu.com/answer/previous-answer',
    author: { id: 'author-1', name: '上一位答主' },
  },
}))
assert.match(previousAnswerPeek, /上一个回答/)
assert.match(previousAnswerPeek, /上一位答主/)
assert.match(previousAnswerPeek, /正在预加载完整回答/)
assert.doesNotMatch(previousAnswerPeek, /上一个回答的摘要预览/, '未完成正文预载时不得拿摘要卡冒充页面')
assert.match(previousAnswerPeek, /松开切换/)

const nextAnswerPeek = renderToStaticMarkup(React.createElement(ZhihuAnswerPeek, {
  direction: 'next',
  phase: 'pulling',
  item: {
    ref: { kind: 'answer', id: 'next-answer' },
    title: '同一问题',
    excerpt: '下一个回答的摘要预览',
    url: 'https://www.zhihu.com/answer/next-answer',
  },
}))
assert.match(nextAnswerPeek, /下一个回答/)
assert.match(nextAnswerPeek, /继续上拉/)

const renderedAnswerPeek = renderToStaticMarkup(React.createElement(
  ZhihuAnswerPeek as React.ComponentType<Record<string, unknown>>,
  {
    direction: 'next',
    phase: 'ready',
    item: {
      ref: { kind: 'answer', id: 'rendered-answer' },
      title: '应展示的问题',
      excerpt: '摘要不能代替正文',
      url: 'https://www.zhihu.com/answer/rendered-answer',
      author: { id: 'author-rendered', name: '完整答主' },
    },
    detail: {
      ref: { kind: 'answer', id: 'rendered-answer' },
      title: '应展示的问题',
      excerpt: '摘要不能代替正文',
      url: 'https://www.zhihu.com/answer/rendered-answer',
      author: { id: 'author-rendered', name: '完整答主' },
      contentHtml: '<p>这是已预加载并排版的完整回答正文。</p><p>第二段正文。</p>',
      segmentInfos: [],
      allowSegmentInteraction: false,
      voteState: 'neutral',
      isFollowing: false,
      questionId: 'question-rendered',
    },
  },
))
assert.match(renderedAnswerPeek, /这是已预加载并排版的完整回答正文/, '拖动预览必须渲染已预载的正文')
assert.match(renderedAnswerPeek, /第二段正文/, '预览不能只截取列表摘要')
assert.doesNotMatch(renderedAnswerPeek, /line-clamp-4/, '完整回答预览不得再退化为摘要卡片')

const restoredSearch = renderToStaticMarkup(React.createElement(ZhihuSearchScreen, {
  initialQuery: '本地优先',
  initialState: {
    input: '尚未提交的新输入',
    query: '本地优先',
    tab: 'general',
    sort: 'latest',
    contentType: 'answer',
    timeRange: 'month',
    items: [{
      ref: { kind: 'answer', id: 'search-answer-1' },
      title: '应恢复的搜索结果',
      excerpt: '保留列表',
      url: 'https://www.zhihu.com/answer/search-answer-1',
    }],
    nextCursor: 'search-page-2',
  },
  service: { search: async () => ({ items: [], hasMore: false }) },
  onQueryChange: () => undefined,
  onOpen: () => undefined,
}))
assert.match(restoredSearch, /value="尚未提交的新输入"/, '返回搜索页必须恢复输入框未提交文字')
assert.match(restoredSearch, /最新发布/, '返回搜索页必须恢复排序选择')
assert.match(restoredSearch, />回答</, '返回搜索页必须恢复内容类型选择')
assert.match(restoredSearch, /一个月内/, '返回搜索页必须恢复时间选择')
assert.match(restoredSearch, /应恢复的搜索结果/, '返回搜索页必须先恢复已有结果，不等待重新请求')

const dirty = '<p>正文<img src="https://pic.example/a.jpg" onerror="alert(1)"></p><script>alert(1)</script>'
const sanitized = normalizeZhihuContentHtml(dirty)
assert.ok(sanitized.includes('正文'))
assert.ok(!sanitized.includes('<script'))
assert.ok(!sanitized.includes('onerror'))
assert.ok(sanitized.includes('data-reader-role="zhihu-image-host"'), '知乎正文图片必须有稳定加载占位容器')
assert.ok(sanitized.includes('图片加载中'), '知乎正文图片加载完成前必须显示加载中占位')
assert.ok(sanitized.includes('图片加载失败'), '知乎正文图片失败时必须有明确占位而不是空白洞')

const fallbackImage = normalizeZhihuContentHtml('<p><img src="https://pic1.zhimg.com/50/fallback_b.jpg" data-actualsrc="https://pic1.zhimg.com/80/preferred_b.jpg" data-original="https://pic1.zhimg.com/100/original_r.jpg"></p>')
assert.ok(fallbackImage.includes('https://pic1.zhimg.com/80/preferred_b.jpg'), '知乎图片应优先保留正文实际图源')
assert.ok(fallbackImage.includes('data-reader-image-fallbacks='), '知乎图片应保留备用源供失败自动重试')
assert.ok(fallbackImage.includes('https://pic1.zhimg.com/100/original_r.jpg'), '原图 URL 应进入安全备用源列表')

const videoCard = normalizeZhihuContentHtml('<p><a class="video-box" href="https://link.zhihu.com/?target=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1test"><img src="https://pic.example/video.jpg">DeepSeek 唱歌测试</a></p>')
assert.ok(videoCard.includes('data-reader-role="zhihu-video-page"'), '知乎视频必须在清洗阶段直接生成稳定播放器宿主，不能先退化成链接卡片')
assert.ok(videoCard.includes('bilibili.com/video/BV1test'), '知乎 link.zhihu.com 跳转必须恢复真实站外目标')
assert.ok(videoCard.includes('data-reader-role="zhihu-link-image"'), '有封面的知乎视频卡片应保留安全缩略图')
assert.ok(videoCard.includes('data-media-format="video-page"'), '站外视频卡片必须标记为可交给 NewsNook 媒体嗅探/InkVideoPlayer 的视频页')
assert.ok(videoCard.includes('data-source-page='), '站外视频卡片必须保留真实视频页面供媒体嗅探')
assert.ok(videoCard.includes('DeepSeek 唱歌测试'))

const nativeZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2081068623192224666" href="https://www.zhihu.com/video/2081068623192224666"><img src="https://pic.example/zhihu-video.jpg">https://www.zhihu.com/video/2081068623192224666</a></p>')
assert.ok(nativeZhihuVideoCard.includes('data-reader-role="zhihu-video-page"'), '知乎自身 /video/:id 必须直接生成稳定播放器宿主，不能留下截图 + 裸 URL 链接')
assert.ok(nativeZhihuVideoCard.includes('data-media-format="video-page"'), '知乎自身视频也必须进入 NewsNook 视频页播放器管线')
assert.ok(nativeZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/2081068623192224666"'), '知乎视频卡片必须保留原始视频页供原生嗅探')
assert.ok(nativeZhihuVideoCard.includes('data-reader-role="zhihu-link-image"'), '知乎视频封面必须作为视频卡片封面保留')

const reportedZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2084728115234858023" href="https://www.zhihu.com/video/2084728115234858023"><img src="https://pic.example/reported-video.jpg">https://www.zhihu.com/video/2084728115234858023</a></p>')
assert.ok(reportedZhihuVideoCard.includes('data-reader-role="zhihu-video-page"'), '用户报告的知乎视频必须直接进入稳定播放器宿主')
assert.ok(reportedZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/2084728115234858023"'))
assert.ok(!reportedZhihuVideoCard.includes('href="https://www.zhihu.com/video/2084728115234858023"'), '回归：不得再次显示成截图中的 URL 链接卡片')

const latestReportedZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2084894365282051809" href="https://www.zhihu.com/video/2084894365282051809"><img src="https://pic.example/latest-reported-video.jpg">https://www.zhihu.com/video/2084894365282051809</a></p>')

const legacyReportedZhihuVideoCard = normalizeZhihuContentHtml('<a class="video-box" href="https://link.zhihu.com/?target=https%3A//www.zhihu.com/video/1622530298419245056" data-lens-id="1622530298419245056"><img src="https://pic.example/legacy-video.jpg">https://www.zhihu.com/video/1622530298419245056</a>')
assert.ok(legacyReportedZhihuVideoCard.includes('data-reader-role="zhihu-video-page"'), '旧知乎 video-box + link.zhihu.com 包装也必须生成播放器宿主')
assert.ok(legacyReportedZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/1622530298419245056"'))
assert.ok(!legacyReportedZhihuVideoCard.includes('data-reader-role="zhihu-link-card"'), '当前实测旧视频不能退化成普通链接卡片')
assert.ok(latestReportedZhihuVideoCard.includes('data-reader-role="zhihu-video-page"'), '最新用户报告的视频必须在 sanitize 后保留稳定播放器宿主')
assert.ok(latestReportedZhihuVideoCard.includes('data-media-format="video-page"'))
assert.ok(latestReportedZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/2084894365282051809"'))
assert.ok(!latestReportedZhihuVideoCard.includes('href="https://www.zhihu.com/video/2084894365282051809"'), '最新回归：静态宿主不得仍是可点击 URL 卡片')

const cachedLegacyZhihuVideoCard = normalizeZhihuContentHtml('<a href="https://www.zhihu.com/video/2084894365282051809" data-reader-role="zhihu-link-card" data-related-title="知乎视频" data-media-format="video-page" data-source-page="https://www.zhihu.com/video/2084894365282051809"><img src="https://pic.example/cached-video.jpg" data-reader-role="zhihu-link-image"><span data-reader-role="zhihu-link-kind">视频</span><span data-reader-role="zhihu-link-body"><span data-reader-role="zhihu-link-title">https://www.zhihu.com/video/2084894365282051809</span><span data-reader-role="zhihu-link-host">zhihu.com</span></span></a>')
assert.ok(cachedLegacyZhihuVideoCard.includes('data-reader-role="zhihu-video-page"'), '升级后必须把旧缓存中的 zhihu-link-card 重新规范化成播放器宿主')
assert.ok(!cachedLegacyZhihuVideoCard.includes('data-reader-role="zhihu-link-card"'), '旧缓存不得让升级后的回答继续停留在历史链接卡片形态')

const lensOnlyZhihuVideoCard = normalizeZhihuContentHtml('<p><a class="video-box" data-lens-id="2081068623192224666"><img src="https://pic.example/zhihu-video.jpg"></a></p>')
assert.ok(lensOnlyZhihuVideoCard.includes('data-source-page="https://www.zhihu.com/video/2081068623192224666"'), '只有 data-lens-id 的知乎视频也必须恢复成稳定播放器宿主')
assert.ok(!lensOnlyZhihuVideoCard.includes('href="https://www.zhihu.com/video/2081068623192224666"'), '知乎视频宿主不能再是可点击链接')

const videoCalls: Array<{ operation: string; url: string; body: unknown }> = []
const videoService = new ZhihuContentService({
  async getJson() {
    throw new Error('not used')
  },
  async postJsonWithHeaders(operation, url, _headers, body) {
    videoCalls.push({ operation, url, body })
    return {
      video_play: {
        playlist: {
          mp4: [
            { bitrate: 480, url: ['https://video.example/480.mp4'] },
            { bitrate: 1080, url: ['https://video.example/1080.mp4'] },
            { bitrate: 720, url: ['https://video.example/720.mp4'] },
          ],
        },
      },
    }
  },
})
const playback = await videoService.readVideo('2080667445237319967', { kind: 'answer', id: 'answer-1' })
assert.equal(playback?.url, 'https://video.example/1080.mp4', '知乎视频应优先使用 play_info 返回的最高 bitrate MP4')
assert.equal(videoCalls[0]?.operation, 'video.play-info')
assert.match(videoCalls[0]?.url ?? '', /\/api\/v4\/video\/play_info\?r=2080667445237319967$/)
assert.deepEqual(videoCalls[0]?.body, {
  content_id: 'answer-1',
  content_type_str: 'answer',
  video_id: '2080667445237319967',
  scene_code: 'answer_detail_web',
  is_only_video: true,
})

const latestReportedVideoService = new ZhihuContentService({
  async getJson() { throw new Error('not used') },
  async postJsonWithHeaders() {
    return {
      video_play: {
        playlist: {
          mp4: [
            { quality: 'SD', codec: 'H265', bitrate: 242, url: ['https://video.example/h265-480.mp4'] },
            { quality: 'FHD', codec: 'H265', bitrate: 263, url: ['https://video.example/h265-1080.mp4'] },
            { quality: 'SD', codec: 'H264', bitrate: 573.09, url: ['https://video.example/h264-480.mp4'] },
          ],
        },
      },
    }
  },
})
const latestReportedPlayback = await latestReportedVideoService.readVideo('2084894365282051809', { kind: 'answer', id: 'reported-answer' })
assert.equal(latestReportedPlayback?.url, 'https://video.example/h264-480.mp4', '真实返回形态下应优先选中高 bitrate H264 源，避免老 WebView 误选 H265')

const zhihuContentScreenSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuContentScreen.tsx', import.meta.url), 'utf8')
const zhihuWorkspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
const inlineVideoPagesSource = readFileSync(new URL('../src/components/InlineVideoPages.tsx', import.meta.url), 'utf8')
assert.match(zhihuContentScreenSource, /<InlineVideoPages/, '知乎回答正文必须原地挂载 video-page 播放器')
assert.doesNotMatch(zhihuContentScreenSource, /videoPage &&/, '知乎视频不能再通过二级全屏视频页播放')
assert.match(zhihuContentScreenSource, /useSpeedRead/, '知乎正文必须复用统一 AI 速读生命周期')
assert.match(zhihuContentScreenSource, /\['answer', 'article', 'pin'\]/, '速读范围只能覆盖回答、文章与想法，不把问题壳当正文')
assert.match(zhihuContentScreenSource, /zhihu-answer/, '知乎回答必须使用独立的回答速读提示词档案')
assert.match(zhihuContentScreenSource, /zhihu:\$\{refValue\.kind\}:\$\{refValue\.id\}/, '每个知乎实体必须拥有独立本地速读缓存身份')
assert.match(zhihuContentScreenSource, /onSpeedReadHeaderActionChange/, '正文速读状态必须上送工作区顶部栏')
assert.match(zhihuWorkspaceSource, /<span>AI 速读<\/span>/, '知乎速读入口必须常驻工作区顶部栏')
assert.doesNotMatch(zhihuContentScreenSource, /<span>AI 速读<\/span>/, '正文头部不应重复显示速读入口')
assert.match(inlineVideoPagesSource, /<OriginPlayerSurface[\s\S]*embedded/, '通用嗅探失败时也必须在正文原位显示原站播放表面')
assert.match(inlineVideoPagesSource, /resolveDirect/, '知乎已知视频协议应优先直取播放源，避免先展示原站页面')
assert.match(inlineVideoPagesSource, /removeChild\(shell\.firstChild\)/, '播放器只能接管稳定宿主内部，不能 replaceWith 掉第三方正文根节点')
assert.match(inlineVideoPagesSource, /appendChild\(host\)/, '播放器宿主必须使用 Android WebView 69 已支持的 DOM API')
assert.match(inlineVideoPagesSource, /useLayoutEffect/, '视频宿主必须在布局阶段接管，不能依赖一次性的被动 effect')
assert.match(inlineVideoPagesSource, /new MutationObserver\(\(\) => scan\(\)\)/, '正文 DOM 被 React/WebView 重写后必须自动重新接管视频宿主')
assert.match(inlineVideoPagesSource, /\[data-media-format="video-page"\]\[data-source-page\]/, '运行时接管应依赖稳定媒体语义，而不是脆弱的展示 role')
assert.doesNotMatch(inlineVideoPagesSource, /shell\.replaceChildren\(/, 'Android WebView 69 不支持 Element.replaceChildren，禁止在知乎视频挂载链路使用')
assert.doesNotMatch(inlineVideoPagesSource, /element\.replaceWith\(host\)|anchor\.replaceWith\(host\)/, '播放器挂载不得再次替换第三方正文根节点')

const article = toNewsArticle({
  ref: { kind: 'answer', id: '456' },
  title: '示例回答',
  excerpt: '摘要',
  contentHtml: dirty,
  createdAt: 1700000000,
  url: 'https://www.zhihu.com/question/123/answer/456',
})
assert.ok(article)
assert.equal(article?.sourceId, 'zhihu-community')
assert.equal(article?.id, feedArticleId('zhihu-community', 'https://www.zhihu.com/question/123/answer/456'))
assert.equal(article?.hasRealDate, true)
assert.ok(!article?.contentHtml?.includes('<script'))

const sharePayload = sharePayloadFromArticle(article!)
const shareUrl = buildShareUrl(sharePayload, { origin: 'https://news.aizeek.com', salt: 'fixture' })
const receivedPayload = parseShareUrl(shareUrl)
assert.ok(receivedPayload)
const receivedArticle = articleFromSharePayload(receivedPayload!)
assert.equal(receivedArticle.sourceId, 'zhihu-community')
assert.equal(receivedArticle.sourceName, '知乎')
assert.equal(receivedArticle.id, article?.id, '知乎公共正文分享发出/接收必须生成同一 Article.id')

assert.equal(toNewsArticle({
  ref: { kind: 'question', id: '123' },
  title: '问题', excerpt: '', contentHtml: '', url: 'https://www.zhihu.com/question/123',
}), null, '问题壳不应伪装成 NewsNook Article')

console.log('zhihu content/link/article bridge contract ok')
