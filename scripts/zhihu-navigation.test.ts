import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { loadActiveSiteId, saveActiveSiteId, type LayoutStorage } from '../src/features/sites/layoutState'
import { createZhihuRootFrame, reduceRoutes, updateCurrentSearchState } from '../src/features/zhihu/navigation'
import type { RouteFrame, ZhihuSearchState } from '../src/features/zhihu/types'
import { SOURCES, findSource, findSite } from '../src/sources/registry'
import { allRegisteredSources } from '../src/sources/preferences/categoryPrefs'
import { parseSourcePayload } from '../src/lib/parseFeed'

const before: RouteFrame[] = [
  {
    route: { screen: 'entity', ref: { kind: 'answer', id: '1' } },
    anchor: 'comment-9',
    scrollTop: 860,
  },
]
const next = reduceRoutes(before, {
  type: 'push',
  frame: { route: { screen: 'entity', ref: { kind: 'people', id: 'u' } }, scrollTop: 0 },
})
assert.equal(next.length, 2)
assert.deepEqual(reduceRoutes(next, { type: 'back' }), before, '返回必须恢复原锚点/scrollTop')

const repeated = reduceRoutes(next, {
  type: 'push',
  frame: { route: { screen: 'entity', ref: { kind: 'people', id: 'u' } }, anchor: 'bio', scrollTop: 12 },
})
assert.equal(repeated.length, 2, '重复打开同一目标应 replace 而不是堆重复 route')
assert.equal(repeated.at(-1)?.anchor, 'bio')
assert.equal(repeated.at(-1)?.scrollTop, 12)

assert.deepEqual(reduceRoutes([], { type: 'back' }), [])
const root = [createZhihuRootFrame()]
assert.deepEqual(reduceRoutes(root, { type: 'back' }), root, '根栈退出由 App 宿主负责，reducer 不删除根 frame')

const searchState: ZhihuSearchState = {
  input: '本地优先',
  query: '本地优先',
  tab: 'general',
  sort: 'latest',
  contentType: 'answer',
  timeRange: 'month',
  items: [{
    ref: { kind: 'answer', id: 'search-answer-1' },
    title: '搜索结果',
    excerpt: '已加载结果必须保留',
    url: 'https://www.zhihu.com/answer/search-answer-1',
  }],
  nextCursor: 'search-page-2',
}
const searchFrames = updateCurrentSearchState([
  createZhihuRootFrame(),
  { route: { screen: 'search', query: '本地优先' }, scrollTop: 640 },
], searchState)
const searchAnswerFrames = reduceRoutes(searchFrames, {
  type: 'push',
  frame: { route: { screen: 'entity', ref: { kind: 'answer', id: 'search-answer-1' } }, scrollTop: 0 },
})
const restoredSearchFrame = reduceRoutes(searchAnswerFrames, { type: 'back' }).at(-1)
assert.equal(restoredSearchFrame?.scrollTop, 640, '从回答返回搜索结果必须恢复滚动位置')
assert.deepEqual(restoredSearchFrame?.searchState, searchState, '从回答返回搜索结果必须恢复筛选、结果与分页游标')

const answerStack: RouteFrame[] = [
  createZhihuRootFrame('hot'),
  { route: { screen: 'entity', ref: { kind: 'answer', id: 'answer-1' } }, scrollTop: 123 },
]
const replacedAnswer = reduceRoutes(answerStack, {
  type: 'replace',
  frame: { route: { screen: 'entity', ref: { kind: 'answer', id: 'answer-2' } }, scrollTop: 0 },
})
assert.equal(replacedAnswer.length, 2, '上下回答切换必须 replace 当前回答，不能继续堆叠回答历史')
assert.deepEqual(replacedAnswer.at(-1)?.route, { screen: 'entity', ref: { kind: 'answer', id: 'answer-2' } })

function memoryStorage(): LayoutStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

const storage = memoryStorage()
assert.equal(loadActiveSiteId(storage), null)
saveActiveSiteId('zhihu', storage)
assert.equal(loadActiveSiteId(storage), 'zhihu')
storage.setItem('newsnook:layout:active-site:v1', 'unknown-site')
assert.equal(loadActiveSiteId(storage), null, '未知持久化 site id 不能污染布局状态')
saveActiveSiteId(null, storage)
assert.equal(loadActiveSiteId(storage), null)

const daily = findSource('zhihu-daily')
const community = findSource('zhihu-community')
assert.equal(daily?.kind, 'zhihu', '知乎日报旧 kind 语义必须保持')
assert.equal(community?.kind, 'zhihu-community')
assert.equal(community?.workspaceOnly, true)
assert.ok(SOURCES.includes(community!))
assert.equal(allRegisteredSources().some((source) => source.id === 'zhihu-community'), false)
assert.equal(findSite('zhihu')?.sourceId, 'zhihu-community')
assert.throws(
  () => parseSourcePayload(community!, '{}'),
  /workspaceOnly source must be loaded by its dedicated site adapter/,
  '知乎社区源误走普通 Feed 解析时必须显式失败，不能落进 RSS/日报解析器',
)

// 知乎工作区属于 AppShell 的子工作区：自身不能重复叠 safe-area，且站点切换器只属于一级页面。
const workspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(
  workspaceSource,
  /<header[^>]+paddingTop:\s*'var\(--sat\)'/,
  '知乎工作区挂在 AppShell 内，header 不能再次叠加顶部 safe-area',
)
assert.match(workspaceSource, /\{primaryRoute && <PresetSwitcher \{\.\.\.presetSwitcher\} \/>\}/, '深层阅读页不得继续显示站点切换器')

// 推荐传输策略是内部实现细节，不能再暴露成 Web/Android/混合/本地这类开发者选项。
const zhihuFeedScreenSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuFeedScreen.tsx', import.meta.url), 'utf8')
const zhihuFeedHookSource = readFileSync(new URL('../src/features/zhihu/feed/useZhihuFeed.ts', import.meta.url), 'utf8')
const pullToRefreshHookSource = readFileSync(new URL('../src/hooks/usePullToRefresh.ts', import.meta.url), 'utf8')
const zhihuWorkspaceSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuWorkspace.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(zhihuFeedScreenSource, /ZHIHU_RECOMMENDATION_MODES|recommendationMode|onRecommendationModeChange/)
assert.doesNotMatch(zhihuFeedScreenSource, />\s*(Web|Android|混合|本地)\s*</)
assert.match(zhihuWorkspaceSource, /const feedEnabled = sessionHydrated \|\| homeFeedMode !== 'following'/, '推荐/热榜不能被账号会话恢复阻塞')
assert.match(zhihuWorkspaceSource, /const feed = useZhihuFeed\([\s\S]*feedService[\s\S]*feedEnabled[\s\S]*\)/, '信息流状态必须由 workspace 持有，回答页返回不能因 FeedRoute 重挂载而自动刷新')
assert.match(zhihuFeedHookSource, /enabled = true/, 'feed hook 必须支持按路由决定是否等待账号恢复')
assert.match(zhihuWorkspaceSource, /retainedFeedScrolls/, '推荐/热榜/关注必须分别记忆滚动位置')
assert.match(zhihuWorkspaceSource, /existingRoot = saved\.find\(\(frame\) => frame\.route\.screen === 'feed'\)/, '返回知乎首页必须复用已有根 feed frame 与滚动位置')
assert.match(zhihuWorkspaceSource, /<span>首页<\/span>/)
assert.match(zhihuWorkspaceSource, /<span>消息<\/span>/)
assert.match(zhihuWorkspaceSource, /<span>我的<\/span>/)
assert.doesNotMatch(zhihuWorkspaceSource, /ZHIHU WORKSPACE/, '生产 UI 不应暴露 workspace/debug 文案')
assert.doesNotMatch(zhihuFeedScreenSource, />\s*\{item\.ref\.kind\}\s*</, '信息流卡片不应把 answer/question 等协议类型显示给用户')
assert.doesNotMatch(zhihuFeedScreenSource, /recommendationSource/, '信息流卡片不应把 android/web 等传输来源显示给用户')

const zhihuContentSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuContentScreen.tsx', import.meta.url), 'utf8')
assert.doesNotMatch(zhihuContentSource, /NewsNook 阅读|BookOpen/, '知乎正文必须直接在站点工作区渲染，不能要求二次进入 NewsNook Reader')
assert.match(zhihuContentSource, /ZhihuAnswerNavigator/, '回答页必须通过默认排序队列解析上下回答')
assert.doesNotMatch(zhihuContentSource, /detail\.previousAnswerIds|detail\.nextAnswerIds/, '回答导航不得使用详情接口中不保证默认排序的 pagination_info')
assert.doesNotMatch(zhihuWorkspaceSource, /if \(answerRoute\) return goHome\(\)/, '回答页返回不能再强制跳知乎首页')
assert.match(zhihuWorkspaceSource, /return goBack\(\)/, '深层页面返回必须忠实回到真实来源页')
assert.match(zhihuWorkspaceSource, /onReplaceNavigate=\{replaceEntity\}/, '上下回答切换必须使用 replace 导航，避免回答栈无限增长')
assert.match(zhihuContentSource, /aria-label="上一个回答"/, '回答操作条必须保留上一个回答入口')
assert.match(zhihuContentSource, /aria-label="下一个回答"/, '回答操作条必须保留下一个回答入口')
assert.doesNotMatch(zhihuContentSource, /fixed right-3[\s\S]*aria-label="此问题的回答导航"/, '上/下回答不能再占用独立右侧悬浮层')
assert.match(zhihuContentSource, /查看问题详情/, '回答标题必须可进入所属问题详情')
assert.match(zhihuContentSource, /ZhihuAuthorAvatar author=\{detail\.author\}/, '回答/文章详情头部必须显示作者头像')
assert.match(zhihuContentSource, /onNavigate\(\{ kind: 'people', id: detail\.author!\.token \?\? detail\.author!\.id \}\)/, '详情页作者头像与姓名必须可进入用户页')
assert.match(zhihuContentSource, /ImageLightbox/, '知乎正文图片必须复用 NewsNook ImageLightbox')
assert.match(zhihuContentSource, /InlineArticleVideos/, '知乎正文原生 video 必须复用 NewsNook InkVideoPlayer 管线')
assert.match(zhihuContentSource, /InlineYoutubeEmbeds/, '知乎正文 YouTube embed 必须复用 NewsNook 媒体播放管线')
assert.match(zhihuContentSource, /InlineVideoPages/, '知乎站内/站外视频必须在回答正文原地挂载 NewsNook 播放器')
assert.doesNotMatch(zhihuContentSource, /videoPage &&|aria-label=\{`播放视频：/, '知乎视频不得再打开二级全屏视频页')

assert.match(zhihuContentSource, /export function ZhihuAnswerActionBar/, '回答页必须提供独立的底部悬浮操作条')
assert.match(zhihuContentSource, /aria-label="回答操作"/, '回答操作条必须是可识别的独立导航区')
assert.match(zhihuContentSource, /max-w-lg/, '回答操作条应使用舒展但克制的单层布局')
assert.match(zhihuContentSource, /onPreviousAnswer\?: \(\) => void/, '回答操作条必须容纳上一个回答入口')
assert.match(zhihuContentSource, /onNextAnswer\?: \(\) => void/, '回答操作条必须容纳下一个回答入口')
assert.match(zhihuContentSource, /aria-label="上一个回答"/, '上下回答必须合并进唯一的回答操作层')
assert.match(zhihuContentSource, /aria-label="下一个回答"/, '上下回答必须合并进唯一的回答操作层')
assert.doesNotMatch(zhihuContentSource, /打开知乎原页[\s\S]*aria-label="回答操作"/, '回答悬浮条不应保留访问原文入口')
assert.match(zhihuContentSource, /bottom:\s*'calc\(var\(--sab\) \+ 0\.65rem\)'/, '回答操作条应贴近安全区，不再为已删除的全局底栏预留空间')
assert.match(zhihuContentSource, /export function ZhihuAnswerCommentsDialog/, '回答评论必须以独立 Bottom Sheet 打开')
assert.match(zhihuContentSource, /items-end justify-center bg-black\/40/, '回答评论应从底部呈现，而不是整屏硬切换')
assert.match(zhihuContentSource, /rounded-t-\[1\.75rem\]/, '移动端评论层必须保留可识别的 Bottom Sheet 轮廓')
assert.match(zhihuContentSource, /onTouchMove=/, 'Bottom Sheet 必须支持下拉手势反馈')
assert.match(zhihuContentSource, /dragY > 72/, '下拉超过阈值应关闭评论层')
assert.match(zhihuContentSource, /aria-label="关闭评论"/, '独立评论层必须保留紧凑的关闭入口')

const zhihuCommentsSource = readFileSync(new URL('../src/features/zhihu/ui/ZhihuCommentsSection.tsx', import.meta.url), 'utf8')
assert.match(zhihuCommentsSource, />\s*热度\s*</, '评论排序必须使用可直接理解的文字标签')
assert.match(zhihuCommentsSource, />\s*最新\s*</, '评论排序必须使用可直接理解的文字标签')
assert.match(zhihuCommentsSource, /border-t border-haze\/50 bg-ink\/96/, 'Bottom Sheet 评论输入框必须固定在面板底部')
assert.doesNotMatch(zhihuCommentsSource, /刷新评论|RefreshCw/, '评论面板不应保留重复刷新控件')
assert.match(zhihuFeedScreenSource, /usePullToRefresh/, '知乎信息流必须直接复用新闻首页的统一下拉刷新手势')
assert.match(zhihuFeedScreenSource, /<PullIndicator/, '知乎信息流必须复用新闻首页的“下拉刷新/松开刷新”动效')
assert.match(zhihuFeedScreenSource, /hidden size-9[\s\S]*sm:flex/, '移动端已经有下拉刷新，不应再显示重复的刷新按钮')
assert.match(zhihuFeedScreenSource, /rootMargin:\s*'240px 0px'/, '知乎信息流上拉加载必须与新闻首页一样在底部预取区自动续载')
assert.match(zhihuFeedHookSource, /const secondPage = await service\.listFeed/, '横滑邻页应至少预取两屏，降低深滚动时露空白的概率')
assert.doesNotMatch(zhihuFeedScreenSource, /loadMoreArmedRef|loadMoreUserIntentAtRef/, '上拉加载不能依赖一次性 armed 标记，否则 sentinel 已相交时会永久失去触发机会')
assert.match(pullToRefreshHookSource, /PULL_THRESHOLD_PX/, '统一下拉刷新必须保留阈值判定')
assert.match(pullToRefreshHookSource, /resistedPullDistance/, '统一下拉刷新必须保留阻尼函数')
assert.match(pullToRefreshHookSource, /touchcancel', onTouchCancel/, '手势取消只能取消刷新，不能误当 touchend 触发刷新')
assert.match(zhihuFeedHookSource, /const refresh = useCallback\(async \(\) =>/, '知乎刷新必须返回可等待的 Promise，让刷新动效持续到请求真正完成')

console.log('zhihu navigation/layout contract ok')
