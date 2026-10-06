import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'

const parsed = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  window: parsed.window,
  document: parsed.document,
  DOMParser: parsed.window.DOMParser,
  Node: parsed.window.Node,
  NodeFilter: parsed.window.NodeFilter,
  HTMLAnchorElement: parsed.window.HTMLAnchorElement,
})

const { detectBrowserChallenge } = await import('../src/lib/browserChallenge')
const { decodeBoost, decodeCategories, decodeCurrentUser, decodeNotifications, decodePost, decodeTagNames, decodeTopic, decodeTopics } = await import('../src/features/linuxdo/api/decode')
const { linuxDoCapabilities } = await import('../src/features/linuxdo/capabilities')
const { linuxDoEndpoints } = await import('../src/features/linuxdo/api/endpoints')
const { sanitizeLinuxDoCooked } = await import('../src/features/linuxdo/content/sanitize')
const { LinuxDoDraftService } = await import('../src/features/linuxdo/draft/service')
const { LinuxDoDiscoveryService, sortLinuxDoTags } = await import('../src/features/linuxdo/discovery/service')
const { LinuxDoFeedService } = await import('../src/features/linuxdo/feed/service')
const { LinuxDoInteractionService } = await import('../src/features/linuxdo/interaction/service')
const { LINUXDO_UPLOAD_BATCH_LIMIT, LINUXDO_UPLOAD_CONCURRENCY, LinuxDoUploadService, mapWithConcurrency } = await import('../src/features/linuxdo/upload/service')
const { LinuxDoBookmarkService } = await import('../src/features/linuxdo/bookmark/service')
const { LinuxDoPeopleService } = await import('../src/features/linuxdo/people/service')
const { LinuxDoSearchService } = await import('../src/features/linuxdo/search/service')
const { createLinuxDoSearchCache } = await import('../src/features/linuxdo/ui/searchCache')
const { LinuxDoTemplateService, collectLinuxDoTemplateTags, filterLinuxDoTemplates, resolveLinuxDoTemplate } = await import('../src/features/linuxdo/template/service')
const { LinuxDoNotificationService } = await import('../src/features/linuxdo/notification/service')
const { LinuxDoTopicService } = await import('../src/features/linuxdo/topic/service')
const { LinuxDoReadTracker } = await import('../src/features/linuxdo/topic/readTracker')
const { parseLinuxDoConnectTrustPage } = await import('../src/features/linuxdo/connect/parser')
const { applyLinuxDoReadProgress, linuxDoTopicReadState } = await import('../src/features/linuxdo/topic/readState')
const notificationModel = await import('../src/features/linuxdo/notification/model')
const feedModel = await import('../src/features/linuxdo/ui/feedModel').catch(() => null)
const discoveryScope = await import('../src/features/linuxdo/ui/discoveryScope').catch(() => null)
const threadModel = await import('../src/features/linuxdo/ui/threadModel').catch(() => null)
const loadingModel = await import('../src/features/linuxdo/ui/loadingModel').catch(() => null)
const engagementModel = await import('../src/features/linuxdo/ui/engagementModel').catch(() => null)
const composerModel = await import('../src/features/linuxdo/editor/model').catch(() => null)
const composerPreview = await import('../src/features/linuxdo/editor/preview').catch(() => null)

assert.deepEqual(decodePost({ via_ios_app: true, ios_device_name: ' iPhone 17 ' }).device, { model: 'iPhone 17', source: 'ios-app' })
assert.equal(decodePost({ via_ios_app: false, ios_device_name: 'iPhone 17' }).device, undefined, 'a model without its source flag must not imply a device origin')
assert.deepEqual(decodePost({ via_ios_app: true }).device, { model: 'iOS 客户端', source: 'ios-app' })
assert.deepEqual(decodePost({ via_ios_app: true, ios_device_name: {} }).device, { model: 'iOS 客户端', source: 'ios-app' })
assert.equal(decodePost({ via_ios_app: 'true', ios_device_name: 'iPhone 17' }).device, undefined)
assert.deepEqual(decodePost({ via_ios_app: true, ios_device_name: '\u202eiPhone 17\u0000' }).device, { model: 'iPhone 17', source: 'ios-app' })
assert.equal(decodePost({ via_ios_app: true, ios_device_name: 'unknown' }).device?.model, 'iOS 客户端')
assert.equal(decodePost({ via_ios_app: true, ios_device_name: 'A'.repeat(1000) }).device?.model.length, 80)
console.log('PASS Linux.do device metadata respects the server source flag and tolerates missing models')

assert.ok(composerModel, 'linuxdo composer text model should exist')
assert.deepEqual(
  composerModel.applyComposerCommand('发布 NewsNook', { start: 3, end: 11 }, 'bold'),
  { value: '发布 **NewsNook**', selection: { start: 5, end: 13 } },
)
assert.deepEqual(
  composerModel.applyComposerCommand('第一行\n第二行', { start: 0, end: 7 }, 'ordered-list'),
  { value: '1. 第一行\n2. 第二行', selection: { start: 3, end: 13 } },
)
assert.deepEqual(
  composerModel.applyComposerCommand('', { start: 0, end: 0 }, 'link'),
  { value: '[链接文字](https://)', selection: { start: 7, end: 15 } },
)
assert.match(
  composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'details').value,
  /^\[details="摘要"\]\n详细内容\n\[\/details\]$/,
)
assert.match(
  composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'poll').value,
  /\[poll type=regular results=always public=true chartType=bar\][\s\S]*\* 选项 2[\s\S]*\[\/poll\]/,
)
assert.match(composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'chart').value, /^\[chart type="bar"/)
assert.match(composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'graphviz').value, /^\[graphviz engine=dot\]/)
assert.equal(composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'toc').value, '<div data-theme-toc="true"></div>')
assert.deepEqual(
  composerModel.insertComposerText('前后', { start: 1, end: 1 }, '插入'),
  { value: '前插入后', selection: { start: 3, end: 3 } },
)
assert.deepEqual(
  composerModel.insertComposerBlock('前文\n后文', { start: 2, end: 2 }, '## 模板\n正文'),
  { value: '前文\n\n## 模板\n正文\n\n后文', selection: { start: 12, end: 12 } },
)
assert.match(
  composerModel.insertComposerSnippet('', { start: 0, end: 0 }, 'datetime', { now: new Date('2026-09-21T04:30:00.000Z') }).value,
  /\[date=2026-09-21 time=12:30:00 timezone="Asia\/Shanghai"\]/,
)
assert.equal(composerModel.normalizeComposerTag('  #Open AI  '), 'open-ai')
assert.equal(composerModel.normalizeComposerTag(' #Node.js / API '), 'node.js-api')
assert.deepEqual(
  composerModel.validateComposer({ mode: 'create', title: '短标题', raw: '不足二十字' }),
  { canSubmit: false, titleCount: 3, bodyCount: 5, titleRemaining: 3, bodyRemaining: 15 },
)
assert.equal(composerModel.validateComposer({ mode: 'create', title: '这是合格标题', raw: '这是一段已经达到二十个字符要求并且能够正常发布的正文内容。' }).canSubmit, true)
assert.equal(composerModel.validateComposer({ mode: 'reply', title: '', raw: '这是一段已经达到二十个字符要求并且能够正常发布的回复内容。' }).canSubmit, true)
assert.deepEqual(
  composerModel.buildComposerDraftData({
    mode: 'create',
    title: '待保存标题',
    raw: '关闭前需要立即保存的正文',
    categoryId: 4,
    tags: ['newsnook', 'android'],
  }),
  {
    reply: '关闭前需要立即保存的正文',
    action: 'createTopic',
    title: '待保存标题',
    categoryId: 4,
    tags: ['newsnook', 'android'],
    postId: undefined,
    reply_to_post_number: undefined,
  },
)
assert.deepEqual(
  composerModel.buildComposerDraftData({
    mode: 'reply',
    title: '不应写入',
    raw: '回复内容',
    categoryId: 4,
    tags: ['ignored'],
    replyToPostNumber: 3,
  }),
  {
    reply: '回复内容',
    action: 'reply',
    title: undefined,
    categoryId: undefined,
    tags: undefined,
    postId: undefined,
    reply_to_post_number: 3,
  },
)

assert.ok(composerPreview, 'linuxdo composer preview renderer should exist')
const safeComposerPreview = composerPreview.renderLinuxDoComposerPreview(`
# 标题

| 名称 | 状态 |
| --- | --- |
| NewsNook | 完成 |

[details="更多"]
隐藏内容
[/details]

[spoiler]剧透[/spoiler]

[poll type=regular]\n* 选项 A\n* 选项 B\n[/poll]

[chart type="bar" title="示例"]\n项目 | 数量\nA | 12\nB | 18\n[/chart]

[graphviz engine=dot]\ndigraph G { A -> B; }\n[/graphviz]

\`\`\`mermaid\ngraph TD; A-->B\n\`\`\`

<script>alert(1)</script>
`)
assert.match(safeComposerPreview, /data-linuxdo-role="table"/)
assert.match(safeComposerPreview, /data-linuxdo-role="details"/)
assert.match(safeComposerPreview, /data-linuxdo-role="spoiler"/)
assert.match(safeComposerPreview, /data-linuxdo-role="poll"/)
assert.match(safeComposerPreview, /data-linuxdo-preview-block="mermaid"/)
assert.match(safeComposerPreview, /data-linuxdo-preview-block="chart"/)
assert.match(safeComposerPreview, /data-linuxdo-preview-block="graphviz"/)
assert.doesNotMatch(safeComposerPreview, /<script/i)
const detailsTemplatePreview = composerPreview.renderLinuxDoComposerPreview(`[details="摘要"]
#### 本帖使用社区开源推广，符合推广要求。

我申明并遵循社区要求的以下内容：

* **我的帖子已经打上 #开源推广 标签：** 是 / 否
* **我的开源项目完整开源：** 是 / 否

*以下为项目介绍正文内容*
[/details]`)
assert.match(detailsTemplatePreview, /<details[^>]*data-linuxdo-role="details"/)
assert.match(detailsTemplatePreview, /<h4[^>]*>本帖使用社区开源推广，符合推广要求。<\/h4>/)
assert.match(detailsTemplatePreview, /<strong>我的帖子已经打上 #开源推广 标签：<\/strong>/)
assert.match(detailsTemplatePreview, /<em>以下为项目介绍正文内容<\/em>/)
assert.doesNotMatch(detailsTemplatePreview, /####|\*\*我的帖子|\*以下为项目/)
const uploadPreview = composerPreview.renderLinuxDoComposerPreview(
  '![截图](upload://abc123.png)',
  { 'upload://abc123.png': 'https://linux.do/uploads/default/original/1X/abc123.png' },
)
assert.match(uploadPreview, /src="https:\/\/linux\.do\/uploads\/default\/original\/1X\/abc123\.png"/)
assert.doesNotMatch(uploadPreview, /upload:\/\//)

assert.ok(feedModel, 'feed verification retry model should exist')
const verificationEvents: string[] = []
assert.equal(await feedModel.retryAfterVerification(
  async () => { verificationEvents.push('verify'); return true },
  async () => { verificationEvents.push('reload') },
), true)
assert.deepEqual(verificationEvents, ['verify', 'reload'])
assert.equal(await feedModel.retryAfterVerification(async () => false, async () => {
  throw new Error('reload must not run after a cancelled verification')
}), false)

assert.ok(discoveryScope, 'discovery scope model should exist')
const scopeCalls: unknown[] = []
const scopeApi = {
  category: async (...args: unknown[]) => { scopeCalls.push(['category', ...args]); return { items: ['category-result'], hasMore: true } },
  tag: async (...args: unknown[]) => { scopeCalls.push(['tag', ...args]); return { items: ['tag-result'], hasMore: false } },
}
assert.equal(discoveryScope.discoveryScopeKey({ kind: 'category', category: { id: 4, name: '开发调优', slug: 'develop' } }), 'category:4')
assert.deepEqual(await discoveryScope.loadDiscoveryScope(scopeApi, { kind: 'category', category: { id: 4, name: '开发调优', slug: 'develop' } }), { items: ['category-result'], hasMore: true })
assert.deepEqual(await discoveryScope.loadDiscoveryScope(scopeApi, { kind: 'tag', name: '人工智能' }, 2, 'views'), { items: ['tag-result'], hasMore: false })
assert.deepEqual(scopeCalls, [
  ['category', 'develop', 4, 0, 'activity'],
  ['tag', '人工智能', 2, 'views'],
])
assert.deepEqual(
  discoveryScope.mergeDiscoveryTopics([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]).map((topic: { id: number }) => topic.id),
  [1, 2, 3],
  'discovery pagination should deduplicate topics across pages',
)

assert.ok(threadModel, 'thread reply target model should exist')
assert.equal(threadModel.resolveReplyTarget(
  { replyToPostNumber: 1, replyToUser: { username: 'bob', name: 'Bob' } },
  [{ postNumber: 1, username: 'alice', name: 'Alice', avatarTemplate: 'https://linux.do/alice.png' }],
)?.username, 'bob')
assert.equal(threadModel.resolveReplyTarget(
  { replyToPostNumber: 1 },
  [{ postNumber: 1, username: 'alice', name: 'Alice', avatarTemplate: 'https://linux.do/alice.png' }],
)?.username, 'alice')

assert.ok(loadingModel, 'linuxdo loading model should exist')
assert.deepEqual(
  (['initial', 'refreshing', 'more', 'idle'] as const).map((state) => loadingModel.linuxDoLoadingLabel(state)),
  ['正在加载主题', '正在刷新最新主题', '正在加载更多内容', ''],
)

assert.ok(engagementModel, 'linuxdo post engagement model should exist')
assert.deepEqual(
  ['heart', '+1', 'clap', 'laughing', 'open_mouth', 'tieba_087'].map(engagementModel.reactionGlyph),
  ['❤️', '👍', '👏', '😆', '😮', '✨'],
)
assert.equal(engagementModel.reactionTotal([
  { id: 'heart', type: 'emoji', count: 41 },
  { id: '+1', type: 'emoji', count: 3 },
  { id: 'clap', type: 'emoji', count: 2 },
]), 46)
assert.equal(engagementModel.boostText('<p>挺牛逼的反正，重不重要不知道</p>'), '挺牛逼的反正，重不重要不知道')

assert.equal(
  detectBrowserChallenge({
    status: 403,
    headers: { server: 'cloudflare', 'cf-ray': 'abc-SJC' },
    body: '<html><head><title>Just a moment...</title></head><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>',
  }),
  'cloudflare',
)
assert.equal(
  detectBrowserChallenge({
    status: 429,
    headers: { server: 'cloudflare', 'cf-mitigated': 'challenge' },
    body: 'challenge response intentionally has no HTML markers',
  }),
  'cloudflare',
  'Cloudflare managed challenges can use 429 and must not be misclassified as ordinary rate limits',
)
assert.equal(
  detectBrowserChallenge({
    status: 429,
    headers: { server: 'cloudflare', 'retry-after': '30' },
    body: 'rate limited',
  }),
  null,
  'ordinary 429 responses must remain rate limits when Cloudflare does not mark them as a challenge',
)
assert.equal(
  detectBrowserChallenge({
    status: 403,
    headers: { server: 'nginx' },
    body: '{"errors":["You are not permitted to view this resource."]}',
  }),
  null,
)

const user = decodeCurrentUser({
  current_user: {
    id: 42,
    username: 'frank',
    name: 'Frank',
    avatar_template: '/user_avatar/linux.do/frank/{size}/1_2.png',
    trust_level: 3,
    unread_notifications: 7,
    all_unread_notifications_count: 9,
    can_use_templates: true,
  },
})
assert.equal(user?.username, 'frank')
assert.equal(user?.trustLevel, 3)
assert.equal(user?.unreadNotifications, 7)
assert.equal(user?.allUnreadNotificationsCount, 9)
assert.equal(user?.canUseTemplates, true)
assert.match(user?.avatarTemplate ?? '', /96/)

const trustFixture = parseLinuxDoConnectTrustPage(`
  <html><body><div class="card">
    <div class="card-header"><h2 class="card-title">信任级别 3 的要求</h2><span class="badge badge-success">已达到</span></div>
    <p class="card-subtitle">@aozix · 过去 100 天内的数据</p>
    <div class="tl3-ring"><div class="tl3-ring-circle met" style="--val:95;--max:50"><span class="tl3-ring-current">95</span><span class="tl3-ring-target">/ 50</span></div><div class="tl3-ring-label">访问天数</div></div>
    <div class="tl3-ring"><div class="tl3-ring-circle met" style="--val:1813;--max:500"><span class="tl3-ring-current">1813</span><span class="tl3-ring-target">/ 500</span></div><div class="tl3-ring-label">浏览话题</div></div>
    <div class="tl3-ring"><div class="tl3-ring-circle met" style="--val:29745;--max:20000"><span class="tl3-ring-current">29745</span><span class="tl3-ring-target">/ 20000</span></div><div class="tl3-ring-label">浏览帖子</div></div>
    <div class="tl3-bar-item met"><span class="tl3-bar-label">回复话题</span><span class="tl3-bar-nums met">18/10</span></div>
    <div class="tl3-bar-item met"><span class="tl3-bar-label">点赞</span><span class="tl3-bar-nums met">40/30</span></div>
    <div class="tl3-bar-item met"><span class="tl3-bar-label">获赞</span><span class="tl3-bar-nums met">490/20</span></div>
    <div class="tl3-bar-item met"><span class="tl3-bar-label">获赞天数</span><span class="tl3-bar-nums met">70/7</span></div>
    <div class="tl3-bar-item met"><span class="tl3-bar-label">获赞用户</span><span class="tl3-bar-nums met">436/5</span></div>
    <div class="tl3-quota-card met"><span class="tl3-quota-label">被举报帖子</span><span class="tl3-quota-nums">0 / 5</span></div>
    <div class="tl3-quota-card met"><span class="tl3-quota-label">举报用户</span><span class="tl3-quota-nums">0 / 5</span></div>
    <div class="tl3-veto-item met"><div class="tl3-veto-front"><span class="tl3-veto-label">被禁言</span><span class="tl3-veto-desc">过去 6 个月</span><span class="tl3-veto-value">0</span></div><div class="tl3-veto-back"><span class="tl3-veto-value">9</span></div></div>
    <div class="tl3-veto-item"><div class="tl3-veto-front"><span class="tl3-veto-label">被封禁</span><span class="tl3-veto-desc">过去 6 个月</span><span class="tl3-veto-value">0</span></div><div class="tl3-veto-back"><span class="tl3-veto-label">被封禁</span><span class="tl3-veto-desc">过去 6 个月</span><span class="tl3-veto-value">1</span></div></div>
    <p>以上“话题”指主帖，“帖子”即传统意义的回复。</p>
    <div class="status-met">已达到信任级别 3 要求，请保持。</div>
  </div></body></html>
`, 123456)
assert.equal(trustFixture.title, '信任级别 3 的要求')
assert.equal(trustFixture.username, 'aozix')
assert.equal(trustFixture.periodLabel, '过去 100 天内的数据')
assert.equal(trustFixture.achieved, true)
assert.equal(trustFixture.activity.length, 3)
assert.deepEqual(trustFixture.activity.map((item) => [item.label, item.current, item.target]), [
  ['访问天数', 95, 50],
  ['浏览话题', 1813, 500],
  ['浏览帖子', 29745, 20000],
])
assert.equal(trustFixture.participation.length, 5)
assert.equal(trustFixture.compliance.length, 2)
assert.equal(trustFixture.vetoes[0]?.value, 0, 'met veto must parse the visible front face')
assert.equal(trustFixture.vetoes[1]?.value, 1, 'unmet veto must parse the visible back face')
assert.equal(trustFixture.vetoes[1]?.description, '过去 6 个月')
assert.match(trustFixture.footnote ?? '', /话题.*帖子.*回复/)
assert.equal(trustFixture.resultText, '已达到信任级别 3 要求，请保持。')
assert.equal(trustFixture.fetchedAt, 123456)
assert.throws(
  () => parseLinuxDoConnectTrustPage('<html><body><form action="/login">登录</form></body></html>'),
  (error: any) => error?.kind === 'auth-required',
)

const feed = decodeTopics({
  users: [
    { id: 1, username: 'alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' },
    { id: 2, username: 'bob', avatar_template: '/user_avatar/linux.do/bob/{size}/2.png' },
  ],
  topic_list: {
    topics: [{
      id: 100,
      slug: 'hello',
      title: 'Hello Linux.do',
      posts_count: 4,
      reply_count: 3,
      views: 1234,
      like_count: 18,
      created_at: '2026-09-20T00:00:00Z',
      last_posted_at: '2026-09-20T01:00:00Z',
      category_id: 9,
      unseen: false,
      unread_posts: 3,
      new_posts: 3,
      last_read_post_number: 1,
      highest_post_number: 4,
      notification_level: 2,
      is_seen: true,
      tags: ['linux', { id: 'newsnook', name: 'newsnook' }, { text: 'android' }],
      posters: [{ user_id: 1, description: 'Original Poster' }, { user_id: 2, description: 'Most Recent Poster' }],
    }],
  },
})
assert.equal(feed.length, 1)
assert.equal(feed[0]?.replyCount, 3)
assert.equal(feed[0]?.posters[1]?.username, 'bob')
assert.equal(feed[0]?.unread, 3, 'Discourse unread_posts must drive the unread counter')
assert.equal(feed[0]?.lastReadPostNumber, 1)
assert.equal(feed[0]?.highestPostNumber, 4)
assert.equal(feed[0]?.notificationLevel, 2)
assert.equal(feed[0]?.isSeen, true)
assert.equal(linuxDoTopicReadState(feed[0]!), 'unread')
const partiallyReadFeedTopic = applyLinuxDoReadProgress(feed[0]!, 3)
assert.equal(partiallyReadFeedTopic.unread, 1)
assert.equal(linuxDoTopicReadState(partiallyReadFeedTopic), 'unread')
const fullyReadFeedTopic = applyLinuxDoReadProgress(partiallyReadFeedTopic, 4)
assert.equal(fullyReadFeedTopic.unread, 0)
assert.equal(linuxDoTopicReadState(fullyReadFeedTopic), 'read')
const freshRegularTopic = {
  ...feed[0]!,
  unseen: true,
  unread: 0,
  newPosts: 1,
  lastReadPostNumber: null,
  highestPostNumber: 4,
  notificationLevel: undefined,
  isSeen: false,
}
assert.equal(linuxDoTopicReadState(freshRegularTopic), 'new')
assert.equal(linuxDoTopicReadState(applyLinuxDoReadProgress(freshRegularTopic, 1)), 'read', 'a regular new topic stops being NEW after its first accepted read timing')
assert.equal(linuxDoTopicReadState({ ...freshRegularTopic, notificationLevel: 0 }), 'read', 'muted topics must not receive a new/unread indicator')
assert.deepEqual(feed[0]?.tags, ['linux', 'newsnook', 'android'])
assert.deepEqual(decodeTagNames([{ id: 'ai', text: 'AI' }, { name: 'dev' }, 'news']), ['AI', 'dev', 'news'])
assert.equal(decodeTagNames([{ foo: 'bar' }]).includes('[object Object]'), false)
assert.deepEqual(decodeTagNames(['[object Object]', 'valid']), ['valid'])

const topic = decodeTopic({
  id: 100,
  slug: 'hello',
  title: 'Hello Linux.do',
  posts_count: 2,
  views: 99,
  like_count: 5,
  created_at: '2026-09-20T00:00:00Z',
  last_posted_at: '2026-09-20T01:00:00Z',
  last_read_post_number: 1,
  highest_post_number: 2,
  last_poster_username: 'bob',
  tags: [{ id: 'linux', name: 'linux' }, { text: 'guide' }],
  details: {
    can_create_post: true,
    notification_level: 2,
    created_by: { username: 'alice', name: 'Alice' },
  },
  post_stream: {
    stream: [501, 502],
    posts: [{
      id: 501,
      post_number: 1,
      username: 'alice',
      cooked: '<p>Hello <img src=x onerror="alert(1)"></p><script>alert(1)</script>',
      created_at: '2026-09-20T00:00:00Z',
      read: false,
      reply_to_post_number: 1,
      reply_to_user: {
        id: 2,
        username: 'bob',
        name: 'Bob',
        avatar_template: '/user_avatar/linux.do/bob/{size}/2.png',
      },
      actions_summary: [{ id: 2, count: 4, acted: true, can_act: true }],
      reactions: [
        { id: 'heart', type: 'emoji', count: 41 },
        { id: '+1', type: 'emoji', count: 3 },
        { id: 'clap', type: 'emoji', count: 2 },
      ],
      current_user_reaction: { id: '+1', type: 'emoji', count: 3 },
      reaction_users_count: 46,
      boosts: [{
        id: 700,
        cooked: '<p>肯定重要</p>',
        can_delete: false,
        can_flag: true,
        user: {
          id: 2,
          username: 'bob',
          name: 'Bob',
          avatar_template: '/user_avatar/linux.do/bob/{size}/2.png',
        },
      }],
      can_boost: true,
      bookmarked: true,
      bookmark_id: 77,
      bookmark_name: 'later',
    }],
  },
})
assert.equal(topic.postStream.stream.length, 2)
assert.equal(topic.lastPosterUsername, 'bob')
assert.equal(topic.lastReadPostNumber, 1)
assert.equal(topic.highestPostNumber, 2)
assert.equal(topic.details?.createdBy?.username, 'alice')
assert.equal(topic.details?.createdBy?.name, 'Alice')
assert.equal(topic.postStream.posts[0]?.actions[0]?.acted, true)
assert.equal(topic.postStream.posts[0]?.read, false)
assert.equal(topic.postStream.posts[0]?.bookmarked, true)
assert.equal(topic.postStream.posts[0]?.bookmarkId, 77)
assert.equal(topic.postStream.posts[0]?.replyToPostNumber, 1)
assert.equal(topic.postStream.posts[0]?.replyToUser?.username, 'bob')
assert.equal(topic.postStream.posts[0]?.replyToUser?.name, 'Bob')
assert.match(topic.postStream.posts[0]?.replyToUser?.avatarTemplate ?? '', /bob\/96\/2\.png$/)
assert.deepEqual(topic.postStream.posts[0]?.reactions?.map((reaction) => reaction.id), ['heart', '+1', 'clap'])
assert.equal(topic.postStream.posts[0]?.currentUserReaction?.id, '+1')
assert.equal(topic.postStream.posts[0]?.reactionUsersCount, 46)
assert.equal(topic.postStream.posts[0]?.boosts?.[0]?.user.username, 'bob')
assert.match(topic.postStream.posts[0]?.boosts?.[0]?.user.avatarTemplate ?? '', /bob\/96\/2\.png$/)
assert.equal(topic.postStream.posts[0]?.canBoost, true)
const decodedBoost = decodeBoost({
  id: 701,
  cooked: '<p>我也支持</p>',
  can_delete: true,
  can_flag: false,
  user: { id: 9, username: 'frank', name: 'Frank', avatar_template: '/user_avatar/linux.do/frank/{size}/9.png' },
})
assert.equal(decodedBoost?.id, 701)
assert.equal(decodedBoost?.canDelete, true)
assert.equal(decodedBoost?.canFlag, false)
assert.equal(decodedBoost?.user.username, 'frank')
assert.equal(decodedBoost?.user.name, 'Frank')
assert.equal(decodedBoost?.user.avatarTemplate, 'https://linux.do/user_avatar/linux.do/frank/96/9.png')
assert.match(decodedBoost?.cooked ?? '', /我也支持/)
assert.equal(decodeBoost({ id: 0, cooked: '<p>invalid</p>', user: { username: 'frank' } }), undefined)
assert.deepEqual(topic.tags, ['linux', 'guide'])
assert.doesNotMatch(topic.postStream.posts[0]?.cooked ?? '', /<script/i)
assert.doesNotMatch(topic.postStream.posts[0]?.cooked ?? '', /onerror/i)

const categories = decodeCategories({
  category_list: {
    categories: [{ id: 9, name: '开发调优', slug: 'dev', topic_count: 123, description_text: '技术讨论', parent_category_id: 4 }],
  },
})
assert.equal(categories[0]?.slug, 'dev')
assert.equal(categories[0]?.parentId, 4)

const notifications = decodeNotifications({
  notifications: [
    { id: 8, notification_type: 5, read: false, created_at: '2026-09-20T00:00:00Z', topic_id: 100, fancy_title: 'Hello' },
    { id: '9', notification_type: 12, read: false, created_at: '2026-09-20T00:02:00Z', data: '{"badge_id":77,"badge_name":"热心用户","badge_slug":"enthusiast"}' },
  ],
})
assert.equal(notifications[0]?.read, false)
assert.equal(notifications[0]?.topicId, 100)
assert.equal(notifications[1]?.id, 9)
assert.equal(notifications[1]?.data.badge_id, 77)
assert.equal(notifications[1]?.data.badge_name, '热心用户')

const reactionNotification = {
  id: 25,
  notificationType: 25,
  read: false,
  createdAt: '2026-09-21T00:00:00Z',
  topicId: 345,
  postNumber: 6,
  slug: 'reaction-topic',
  fancyTitle: 'Reaction target',
  data: { display_username: 'alice' },
}
assert.deepEqual(
  notificationModel.resolveLinuxDoNotificationTarget(reactionNotification, 'frank'),
  { kind: 'topic', topicId: 345, slug: 'reaction-topic', postNumber: 6 },
  'Reaction notifications must navigate by topic_id/post_number, never by notification.id',
)
const badgeNotification = {
  id: 12,
  notificationType: 12,
  read: false,
  createdAt: '2026-09-21T00:00:00Z',
  topicId: 999,
  data: { badge_id: 77, badge_name: '热心用户', badge_slug: 'enthusiast' },
}
assert.deepEqual(
  notificationModel.resolveLinuxDoNotificationTarget(badgeNotification, 'frank'),
  { kind: 'user', username: 'frank', tab: 'badges', badgeId: 77 },
)
assert.equal(notificationModel.linuxDoNotificationTitle(badgeNotification), '获得徽章 · 热心用户')
assert.deepEqual(
  notificationModel.resolveLinuxDoNotificationTarget({
    id: 38,
    notificationType: 38,
    read: false,
    createdAt: '2026-09-21T00:00:00Z',
    data: {},
  }),
  { kind: 'detail' },
  'system notifications without a page must still have an explicit detail target',
)
const locallyReadReaction = notificationModel.markLinuxDoNotificationRead([reactionNotification], reactionNotification.id)
assert.equal(locallyReadReaction[0]?.read, true)
const staleRefresh = notificationModel.mergeLinuxDoNotifications(locallyReadReaction, [{ ...reactionNotification, read: false }])
assert.equal(staleRefresh[0]?.read, true, 'a stale refresh must not resurrect an unread Reaction after mark-read')
const pagedNotifications = notificationModel.mergeLinuxDoNotifications([
  { ...reactionNotification, id: 300, createdAt: '2026-09-22T03:00:00Z' },
  { ...reactionNotification, id: 299, createdAt: '2026-09-22T02:00:00Z', read: true },
], [
  { ...reactionNotification, id: 298, createdAt: '2026-09-21T23:00:00Z' },
  { ...reactionNotification, id: 299, createdAt: '2026-09-22T02:00:00Z', read: false },
  { ...reactionNotification, id: 297, createdAt: '2026-09-21T23:00:00Z' },
])
assert.deepEqual(pagedNotifications.map((item: { id: number }) => item.id), [300, 299, 298, 297], 'older notification pages must append chronologically instead of jumping above newer notifications')
assert.equal(pagedNotifications.find((item: { id: number }) => item.id === 299)?.read, true, 'dedupe must preserve local read=true during pagination races')
const deletedTargetNotification = { ...reactionNotification, id: 26, topicId: 99999999 }
assert.equal(notificationModel.markLinuxDoNotificationRead([deletedTargetNotification], 26)[0]?.read, true, 'read state is independent from whether the target topic still exists')
assert.equal(notificationModel.markAllLinuxDoNotificationsRead([reactionNotification, badgeNotification]).every((item: { read: boolean }) => item.read), true)

const dirty = '<p onclick="evil()">safe</p><iframe src="javascript:alert(1)"></iframe>'
const clean = sanitizeLinuxDoCooked(dirty)
assert.doesNotMatch(clean, /onclick/i)
assert.doesNotMatch(clean, /javascript:/i)

// Linux.do's web theme enhances GitHub-style Markdown alerts after cooking.
// NewsNook must preserve the same semantics without depending on Discourse JS/CSS.
const warningCallout = sanitizeLinuxDoCooked(
  '<blockquote><p>[!warning] 提醒老用户：<strong>2.x 与 1.x 数据不兼容</strong>，请<a href="https://linux.do/t/topic/2843455">独立部署</a>。</p></blockquote>',
)
assert.match(warningCallout, /data-linuxdo-role="callout"/)
assert.match(warningCallout, /data-linuxdo-callout="warning"/)
assert.doesNotMatch(warningCallout, /\[!warning\]/i)
assert.match(warningCallout, /<strong>2\.x 与 1\.x 数据不兼容<\/strong>/)
assert.match(warningCallout, /<a href="https:\/\/linux\.do\/t\/topic\/2843455">独立部署<\/a>/)

const successCallout = sanitizeLinuxDoCooked(
  '<blockquote><p>[!Success]</p><p>遇到问题欢迎提 Issue，觉得有用也欢迎点个 <code>Star</code>。</p></blockquote>',
)
assert.match(successCallout, /data-linuxdo-callout="success"/)
assert.doesNotMatch(successCallout, /\[!Success\]/)
assert.doesNotMatch(successCallout, /<p><\/p>/)
assert.match(successCallout, /<code>Star<\/code>/)

for (const [marker, expected] of [
  ['NOTE', 'note'],
  ['info', 'note'],
  ['TIP', 'tip'],
  ['hint', 'tip'],
  ['IMPORTANT', 'important'],
  ['WARN', 'warning'],
  ['CAUTION', 'caution'],
  ['danger', 'caution'],
  ['error', 'caution'],
  ['check', 'success'],
] as const) {
  const callout = sanitizeLinuxDoCooked(`<blockquote><p>[!${marker}] body</p></blockquote>`)
  assert.match(callout, new RegExp(`data-linuxdo-callout="${expected}"`))
  assert.doesNotMatch(callout, /\[![a-z]+\]/i)
}

const ordinaryQuote = sanitizeLinuxDoCooked('<blockquote><p>普通引用</p><p>[!warning] 这里只是正文字符串</p></blockquote>')
assert.doesNotMatch(ordinaryQuote, /data-linuxdo-role="callout"/)
assert.match(ordinaryQuote, /\[!warning\]/i)

const quotedCalloutMarker = sanitizeLinuxDoCooked('<aside class="quote" data-username="alice"><div class="title">alice:</div><blockquote><p>[!warning] 被引用的原文</p></blockquote></aside>')
assert.match(quotedCalloutMarker, /data-linuxdo-role="quote"/)
assert.doesNotMatch(quotedCalloutMarker, /data-linuxdo-role="callout"/)

const discourseMedia = sanitizeLinuxDoCooked(`
  <p>before <img src="/images/emoji/twitter/smiley.png" class="emoji" alt="smiley" width="20" height="20"> after</p>
  <div class="lightbox-wrapper">
    <a class="lightbox" href="/uploads/default/original/1X/photo.png">
      <img src="/uploads/default/optimized/1X/photo_2_690x74.png" width="690" height="74">
      <div class="meta"><span class="filename">image</span><span class="informations">2134×230 22.6 KB</span></div>
    </a>
  </div>
`)
assert.match(discourseMedia, /data-linuxdo-role="emoji"/)
assert.match(discourseMedia, /data-linuxdo-role="content-image"/)
assert.match(discourseMedia, /data-linuxdo-role="image-block"/)
assert.match(discourseMedia, /data-linuxdo-original-src="https:\/\/linux\.do\/uploads\/default\/original/)
assert.doesNotMatch(discourseMedia, /<a[^>]+data-linuxdo-role="image-link"[^>]+href=/)
assert.match(discourseMedia, /https:\/\/linux\.do\/uploads\/default\/optimized/)
assert.doesNotMatch(discourseMedia, /2134×230/)
assert.doesNotMatch(discourseMedia, />image</)

const discourseSemantics = sanitizeLinuxDoCooked(`
  <aside class="quote" data-topic="321" data-post="7" data-username="alice">
    <div class="title"><img class="avatar" src="/user_avatar/linux.do/alice/48/1.png">alice:</div>
    <div class="quote-controls">↗</div>
    <blockquote><p>quoted <span class="spoiler">secret</span></p></blockquote>
  </aside>
  <aside class="onebox discourse-topic">
    <header class="source">linux.do</header>
    <article class="onebox-body">
      <a href="/t/hello/654/3"><img src="/user_avatar/linux.do/bob/96/2.png"><h3>Topic preview</h3></a>
      <p>Compact description</p>
    </article>
  </aside>
  <p>Hello <a class="mention" href="/u/bob">@bob</a></p>
`)
assert.match(discourseSemantics, /data-linuxdo-role="quote"/)
assert.match(discourseSemantics, /data-linuxdo-topic-id="321"/)
assert.match(discourseSemantics, /data-linuxdo-post-number="7"/)
assert.match(discourseSemantics, /data-linuxdo-username="alice"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-header"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-avatar"/)
assert.match(discourseSemantics, /data-linuxdo-role="quote-body"/)
assert.match(discourseSemantics, /data-linuxdo-role="spoiler"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-topic"/)
assert.match(discourseSemantics, /data-linuxdo-href="https:\/\/linux\.do\/t\/hello\/654\/3"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-image"/)
assert.match(discourseSemantics, /data-linuxdo-role="onebox-title"/)
assert.match(discourseSemantics, /data-linuxdo-role="mention"/)
assert.doesNotMatch(discourseSemantics, /data-linuxdo-role="content-image"[^>]*user_avatar\/linux\.do\/alice/)

const discourseStructures = sanitizeLinuxDoCooked(`
  <details><summary>展开说明</summary><p>详细内容</p></details>
  <div class="poll"><div class="poll-info">投票结果</div><ul><li>选项 A</li></ul></div>
  <table><thead><tr><th>名称</th></tr></thead><tbody><tr><td>NewsNook</td></tr></tbody></table>
  <pre><code class="lang-ts">const safe = true</code></pre>
  <p><a class="attachment" href="/uploads/default/original/1X/archive.zip">archive.zip</a></p>
`)
assert.match(discourseStructures, /data-linuxdo-role="details"/)
assert.match(discourseStructures, /data-linuxdo-role="poll"/)
assert.match(discourseStructures, /data-linuxdo-role="table"/)
assert.match(discourseStructures, /data-linuxdo-role="code-block"/)
assert.match(discourseStructures, /data-linuxdo-role="attachment"/)
assert.doesNotMatch(discourseStructures, /class=/)

assert.equal(linuxDoEndpoints.latest(2).endsWith('/latest.json?page=2'), true)
assert.equal(linuxDoEndpoints.category('dev', 9, 3).endsWith('/c/dev/9.json?page=3'), true)
assert.equal(linuxDoEndpoints.category('dev', 9, 3, 'views'), 'https://linux.do/c/dev/9.json?page=3&order=views')
assert.equal(linuxDoEndpoints.tag('人工智能', 2, 'likes'), 'https://linux.do/tag/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD.json?page=2&order=likes')
assert.equal(linuxDoEndpoints.search('hello world').includes('q=hello%20world'), true)
assert.equal(
  linuxDoEndpoints.tagSearch('开源', {
    limit: 20,
    categoryId: 4,
    selectedTagIds: [10, '11'],
    selectedTags: ['人工智能'],
    forInput: true,
    prioritizeRecentTags: false,
  }),
  'https://linux.do/tags/filter/search.json?q=%E5%BC%80%E6%BA%90&limit=20&categoryId=4&filterForInput=true&prioritizeRecentTags=false&selected_tag_ids%5B%5D=10&selected_tag_ids%5B%5D=11&selected_tags%5B%5D=%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD',
)

const capabilities = linuxDoCapabilities()
assert.equal(capabilities.bookmarks, true)
assert.equal(capabilities.drafts, true)
assert.equal(capabilities.uploads, true)
assert.equal(capabilities.boost.available, true)
assert.equal(linuxDoEndpoints.boostCreate(501).endsWith('/discourse-boosts/posts/501/boosts.json'), true)
assert.equal(linuxDoEndpoints.drafts.endsWith('/drafts.json'), true)
assert.equal(linuxDoEndpoints.draft('topic_100').endsWith('/drafts/topic_100.json'), true)
assert.equal(linuxDoEndpoints.templates, 'https://linux.do/discourse_templates')
assert.equal(linuxDoEndpoints.templateUse(123), 'https://linux.do/discourse_templates/123/use')
assert.equal(linuxDoEndpoints.userBookmarks('frank').endsWith('/u/frank/bookmarks.json'), true)
assert.equal(linuxDoEndpoints.userSummary('frank'), 'https://linux.do/u/frank/summary.json')
assert.equal(linuxDoEndpoints.userBadges('frank'), 'https://linux.do/user-badges/frank.json')
assert.equal(linuxDoEndpoints.userActivity('frank', 30, 5), 'https://linux.do/user_actions.json?username=frank&offset=30&filter=5')
assert.equal(linuxDoEndpoints.userActivity('frank', 0, 4).endsWith('filter=4'), true)
assert.equal(linuxDoEndpoints.userActivity('frank', 0, 1).endsWith('filter=1'), true)
assert.equal(linuxDoEndpoints.userActivity('frank', 0, 6).endsWith('filter=6'), true)
assert.equal(linuxDoEndpoints.userActivity('frank', 0).includes('filter='), false)
assert.equal(linuxDoEndpoints.notifications(60, 30).endsWith('/notifications.json?offset=60&limit=30'), true)
assert.equal(linuxDoEndpoints.notifications().endsWith('/notifications.json?offset=0&limit=60'), true)
assert.equal(linuxDoEndpoints.notifications(0, 1, 'unread').endsWith('/notifications.json?offset=0&limit=1&filter=unread'), true)
assert.equal(linuxDoEndpoints.privateMessages('frank', 0), 'https://linux.do/topics/private-messages/frank.json')
assert.equal(linuxDoEndpoints.privateMessages('frank', 2), 'https://linux.do/topics/private-messages/frank.json?page=2')
assert.equal(linuxDoEndpoints.markNotificationsRead, 'https://linux.do/notifications/mark-read')
assert.equal(linuxDoEndpoints.topicTimings, 'https://linux.do/topics/timings')
assert.equal(linuxDoEndpoints.topic('hello', 100, 42).endsWith('/t/hello/100/42.json'), true)
assert.equal(linuxDoEndpoints.postRaw(501).endsWith('/posts/501/raw'), true)
assert.equal(linuxDoEndpoints.hot(2), 'https://linux.do/hot.json?page=2')
assert.equal(linuxDoEndpoints.top(3), 'https://linux.do/top.json?page=3')
assert.equal(linuxDoEndpoints.top(3, 'monthly'), 'https://linux.do/top.json?page=3&period=monthly')
assert.equal(linuxDoEndpoints.posted(1), 'https://linux.do/posted.json?page=1')
assert.equal(linuxDoEndpoints.read(4), 'https://linux.do/read.json?page=4')
assert.equal(linuxDoEndpoints.bookmarkedTopics(2), 'https://linux.do/bookmarks.json?page=2')

// Discourse TopicQuery#list_new returns new + unread without subset=topics
// when unified_new_enabled? is true. Own unread topics lead that combined list.
for (const unifiedNewEnabled of [true, false]) {
  const unreadTopics = [
    { id: 910, title: 'Own old topic with unread replies', posters: [{ user_id: 1 }], last_read_post_number: 1, highest_post_number: 3 },
    { id: 911, title: 'Other tracked topic with unread replies', posters: [{ user_id: 2 }], last_read_post_number: 2, highest_post_number: 4 },
  ]
  const newPages = [
    [{ id: 920, title: 'Unopened new topic', posters: [{ user_id: 2 }], last_read_post_number: null }],
    [{ id: 921, title: 'Next unopened new topic', posters: [{ user_id: 2 }], last_read_post_number: null }],
  ]
  const personalizedFeed = new LinuxDoFeedService({
    getJson: async (url: string, options?: { auth?: string }) => {
      assert.equal(options?.auth, 'required')
      const request = new URL(url)
      const page = Number(request.searchParams.get('page'))
      const topics = request.pathname === '/unread.json'
        ? unreadTopics
        : unifiedNewEnabled && request.searchParams.get('subset') !== 'topics'
          ? [...unreadTopics, ...newPages[page]!]
          : newPages[page]!
      return {
        users: [{ id: 1, username: 'self' }, { id: 2, username: 'other' }],
        topic_list: { topics, more_topics_url: page === 0 ? '/new.json?page=1' : null },
      }
    },
  } as any)
  const newPage0 = await personalizedFeed.list('new')
  assert.deepEqual(newPage0.items.map((topic) => topic.id), [920],
    `new must exclude previously read topics even with unified new ${unifiedNewEnabled}`)
  assert.equal(newPage0.hasMore, true)
  assert.deepEqual((await personalizedFeed.list('new', 1)).items.map((topic) => topic.id), [921],
    'pagination must retain the new-only subset')
  const unreadPage = await personalizedFeed.list('unread')
  assert.deepEqual(unreadPage.items.map((topic) => topic.id), [910, 911],
    'unread must preserve upstream own-topic priority and include other tracked topics')
  assert.deepEqual(unreadPage.items.map((topic) => topic.posters[0]?.username), ['self', 'other'])
}

const feedCalls: Array<{ url: string; auth?: string }> = []
const feedService = new LinuxDoFeedService({
  getJson: async (url: string, options?: { auth?: string }) => {
    feedCalls.push({ url, auth: options?.auth })
    return {
      users: [],
      topic_list: {
        more_topics_url: url.includes('page=0') ? '/next' : null,
        topics: [{
          id: feedCalls.length,
          slug: 'feed-topic',
          title: 'Feed Topic',
          posts_count: 2,
          reply_count: 1,
          views: 10,
          like_count: 2,
          created_at: '2026-09-21T00:00:00Z',
          last_posted_at: '2026-09-21T01:00:00Z',
          tags: [],
          posters: [],
        }],
      },
    }
  },
} as any)
assert.equal((await feedService.list('hot', 0)).hasMore, true)
assert.equal((await feedService.list('top', 0)).hasMore, true)
assert.equal((await feedService.list('new', 1)).hasMore, false)
assert.equal((await feedService.list('unread', 1)).hasMore, false)
assert.equal((await feedService.list('posted', 1)).hasMore, false)
assert.equal((await feedService.list('read', 1)).hasMore, false)
assert.equal((await feedService.list('bookmarks', 1)).hasMore, false)
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/hot.json?page=0' && call.auth === 'optional'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/top.json?page=0' && call.auth === 'optional'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/new.json?page=1&subset=topics' && call.auth === 'required'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/unread.json?page=1' && call.auth === 'required'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/posted.json?page=1' && call.auth === 'required'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/read.json?page=1' && call.auth === 'required'))
assert.ok(feedCalls.some((call) => call.url === 'https://linux.do/bookmarks.json?page=1' && call.auth === 'required'))

const timingCalls: Array<{ url: string; form: Record<string, unknown>; auth?: string; headers?: Record<string, string>; browserOnly?: boolean }> = []
const topicService = new LinuxDoTopicService({
  postFormVoid: async (url: string, form: Record<string, unknown>, options?: { auth?: string; headers?: Record<string, string>; browserOnly?: boolean }) => {
    timingCalls.push({ url, form, auth: options?.auth, headers: options?.headers, browserOnly: options?.browserOnly })
  },
} as any)
await topicService.reportTimings(100, 2450.9, { 1: 1000.4, 2: 1450.8, 0: 999 })
assert.deepEqual(timingCalls, [{
  url: 'https://linux.do/topics/timings',
  form: {
    topic_id: 100,
    topic_time: 2450,
    'timings[1]': 1000,
    'timings[2]': 1450,
  },
  auth: 'required',
  headers: {
    'X-SILENCE-LOGGER': 'true',
    'Discourse-Background': 'true',
  },
  browserOnly: undefined,
}], 'topic reading must use the same authenticated request transport as other Linux.do writes; forcing a hidden WebView bypasses the app session and can trigger Cloudflare verification')

let trackerNow = 0
const trackerBatches: Array<{ topicId: number; topicTime: number; timings: Record<number, number> }> = []
const trackerSent: Array<{ topicId: number; highestSeen: number; posts: number[] }> = []
const readTracker = new LinuxDoReadTracker({
  now: () => trackerNow,
  send: async (batch) => { trackerBatches.push({ topicId: batch.topicId, topicTime: batch.topicTime, timings: { ...batch.timings } }) },
  onSent: (topicId, highestSeen, posts) => trackerSent.push({ topicId, highestSeen, posts }),
})
readTracker.start(2942004)
readTracker.setVisiblePosts([13, 14, 15, 16])
readTracker.scrolled()
trackerNow = 1000
;(readTracker as any).tick()
assert.equal(trackerBatches.length, 0, 'the first one-second tick samples the viewport before a rush is possible')
trackerNow = 2000
;(readTracker as any).tick()
await Promise.resolve()
await Promise.resolve()
assert.deepEqual(trackerBatches[0], {
  topicId: 2942004,
  topicTime: 1000,
  timings: { 13: 1000, 14: 1000, 15: 1000, 16: 1000 },
}, 'new unread posts sampled onscreen must rush a one-second timings batch without waiting for scrolling to stop')
assert.deepEqual(trackerSent[0], {
  topicId: 2942004,
  highestSeen: 16,
  posts: [13, 14, 15, 16],
}, 'read state may advance only after the timings request resolves successfully')
readTracker.stop(false)

trackerNow = 0
const scrollingBatches: Array<{ topicId: number; topicTime: number; timings: Record<number, number> }> = []
const scrollingTracker = new LinuxDoReadTracker({
  now: () => trackerNow,
  send: async (batch) => { scrollingBatches.push({ topicId: batch.topicId, topicTime: batch.topicTime, timings: { ...batch.timings } }) },
})
scrollingTracker.start(2942004)
scrollingTracker.setVisiblePosts([20, 21])
scrollingTracker.scrolled()
trackerNow = 1000
;(scrollingTracker as any).tick()
scrollingTracker.setVisiblePosts([21, 22, 23])
scrollingTracker.scrolled()
trackerNow = 2000
;(scrollingTracker as any).tick()
await Promise.resolve()
await Promise.resolve()
assert.deepEqual(scrollingBatches[0]?.timings, { 20: 1000, 21: 1000 }, 'continuous scrolling must preserve the previous visibility sample instead of clearing it')
scrollingTracker.stop(false)

trackerNow = 0
const quickExitBatches: Array<Record<number, number>> = []
const quickExitTracker = new LinuxDoReadTracker({
  now: () => trackerNow,
  send: async (batch) => { quickExitBatches.push({ ...batch.timings }) },
})
quickExitTracker.start(2942004)
quickExitTracker.setVisiblePosts([8, 9])
quickExitTracker.scrolled()
trackerNow = 1000
;(quickExitTracker as any).tick()
quickExitTracker.stop(true)
await Promise.resolve()
assert.deepEqual(quickExitBatches[0], { 8: 1000, 9: 1000 }, 'leaving a topic flushes already sampled reading time like Discourse screen-track')

const boostCalls: Array<{ url: string; form: Record<string, unknown>; auth?: string }> = []
const interactionService = new LinuxDoInteractionService({
  postForm: async (url: string, form: Record<string, unknown>, options?: { auth?: string }) => {
    boostCalls.push({ url, form, auth: options?.auth })
    return {
      id: 880,
      cooked: '<p>支持一下</p>',
      can_delete: true,
      can_flag: false,
      user: {
        id: 9,
        username: 'frank',
        name: 'Frank',
        avatar_template: '/user_avatar/linux.do/frank/{size}/9.png',
      },
    }
  },
} as any)
const createdBoost = await interactionService.boost(501, ' 支持一下 ')
assert.equal(createdBoost.id, 880)
assert.equal(createdBoost.user.username, 'frank')
assert.equal(createdBoost.canDelete, true)
assert.deepEqual(boostCalls[0], {
  url: 'https://linux.do/discourse-boosts/posts/501/boosts.json',
  form: { raw: '支持一下' },
  auth: 'required',
})

const tagSearchCalls: Array<{ url: string; auth?: string }> = []
const discoveryService = new LinuxDoDiscoveryService({
  getJson: async (url: string, options?: { auth?: string }) => {
    tagSearchCalls.push({ url, auth: options?.auth })
    if (url.endsWith('/tags.json')) {
      return {
        tags: [{ id: 1711, name: '开源', count: '215' }],
        extras: {
          tag_groups: [{ tags: [{ id: 2234, name: '开源推广', count: 3658 }, { id: 1936, name: '开源项目', count: 367 }] }],
          categories: [{ tags: [{ id: 1936, name: '开源项目', count: 360 }, { id: 1750, name: '开源宇宙', count: 5 }] }],
        },
      }
    }
    return {
      results: [
        { id: 1711, text: '开源' },
        { id: 2234, name: '开源推广', count: 3658 },
        { id: 1936, text: '开源项目' },
        { id: 1750, text: '开源宇宙', count: 0, disabled: true, title: '当前分类不可用' },
      ],
    }
  },
} as any)
const catalogTags = await discoveryService.tags()
assert.deepEqual(catalogTags.map((tag) => [tag.name, tag.topicCount]), [
  ['开源推广', 3658],
  ['开源项目', 367],
  ['开源', 215],
  ['开源宇宙', 5],
])
assert.deepEqual(
  await discoveryService.searchTags('开源', {
    categoryId: 4,
    selectedTagIds: [99],
    selectedTags: ['人工智能'],
    forInput: true,
  }),
  [
    { id: 2234, name: '开源推广', topicCount: 3658, disabled: false, disabledReason: undefined },
    { id: 1936, name: '开源项目', topicCount: 367, disabled: false, disabledReason: undefined },
    { id: 1711, name: '开源', topicCount: 215, disabled: false, disabledReason: undefined },
    { id: 1750, name: '开源宇宙', topicCount: 0, disabled: true, disabledReason: '当前分类不可用' },
  ],
)
assert.deepEqual(sortLinuxDoTags([
  { name: '少', topicCount: 5 },
  { name: '多', topicCount: 367 },
  { name: '禁用', topicCount: 9999, disabled: true },
]).map((tag) => tag.name), ['多', '少', '禁用'])
assert.deepEqual(sortLinuxDoTags([
  { name: '开源', topicCount: 215 },
  { name: '开源宇宙', topicCount: 5 },
  { name: '开源项目', topicCount: 367 },
]).map((tag) => tag.name), ['开源项目', '开源', '开源宇宙'])
const searchCall = tagSearchCalls.find((call) => call.url.includes('/tags/filter/search.json'))
assert.ok(searchCall)
assert.match(searchCall.url, /q=%E5%BC%80%E6%BA%90/)
assert.match(searchCall.url, /selected_tag_ids%5B%5D=99/)
assert.equal(searchCall.auth, 'optional')

const recentOrderService = new LinuxDoDiscoveryService({
  getJson: async () => ({
    results: [
      { id: 1, name: '最近使用', count: 2 },
      { id: 2, name: '更热门', count: 9000 },
    ],
  }),
} as any)
assert.deepEqual(
  (await recentOrderService.searchTags('', { prioritizeRecentTags: true, forInput: true })).map((tag) => tag.name),
  ['最近使用', '更热门'],
  'empty composer search should preserve Discourse recent-tag priority order',
)

const discoveryPageCalls: string[] = []
const discoveryPageService = new LinuxDoDiscoveryService({
  getJson: async (url: string) => {
    discoveryPageCalls.push(url)
    const firstPage = url.includes('page=0')
    return {
      users: [],
      topic_list: {
        more_topics_url: firstPage ? '/next-page' : null,
        topics: [{
          id: firstPage ? 9001 : 9002,
          slug: 'paged-topic',
          title: firstPage ? '第一页主题' : '第二页主题',
          posts_count: 2,
          reply_count: 1,
          views: 42,
          like_count: 3,
          created_at: '2026-09-21T00:00:00Z',
          last_posted_at: '2026-09-21T01:00:00Z',
          tags: ['人工智能'],
          posters: [],
        }],
      },
    }
  },
} as any)
const discoveryFirstPage = await discoveryPageService.tag('人工智能', 0, 'views')
assert.equal(discoveryFirstPage.hasMore, true)
assert.equal(discoveryFirstPage.items[0]?.id, 9001)
const discoverySecondPage = await discoveryPageService.category('develop', 4, 1, 'likes')
assert.equal(discoverySecondPage.hasMore, false)
assert.equal(discoverySecondPage.items[0]?.id, 9002)
assert.ok(discoveryPageCalls.some((url) => url.includes('/tag/') && url.includes('page=0') && url.includes('order=views')))
assert.ok(discoveryPageCalls.some((url) => url.includes('/c/develop/4.json') && url.includes('page=1') && url.includes('order=likes')))

const templateCalls: Array<{ method: 'GET' | 'POST'; url: string; auth?: string }> = []
const templateService = new LinuxDoTemplateService({
  getJson: async (url: string, options?: { auth?: string }) => {
    templateCalls.push({ method: 'GET', url, auth: options?.auth })
    return {
      templates: [
        { id: 101, title: '开源推广发帖模板', slug: 'open-source-template', content: '你好 @%{my_username}\n项目：%{topic_title,fallback:新项目}', tags: ['开源推广', '软件开发'], usages: 20 },
        { id: 102, title: '公益推广发帖模板', slug: 'charity-template', content: '公益内容', tags: ['公益推广'], usages: 5 },
        { id: 103, title: 'LINUX DO 抽奖模板', slug: 'lottery-template', content: '发起人：%{my_name,fallback:活动发起人}', tags: [], usages: 50 },
      ],
    }
  },
  postForm: async (url: string, _form: unknown, options?: { auth?: string }) => {
    templateCalls.push({ method: 'POST', url, auth: options?.auth })
    return { usage_count: 21 }
  },
} as any)
const templates = await templateService.list()
assert.equal(templates.length, 3)
assert.equal(templates[0]?.title, '开源推广发帖模板')
assert.deepEqual(templates[0]?.tags, ['开源推广', '软件开发'])
assert.equal(templates[0]?.usages, 20)
assert.deepEqual(
  filterLinuxDoTemplates(templates, '', '*').map((template) => template.id),
  [103, 101, 102],
  'template list should match Discourse ordering by relevance, usage, then title',
)
assert.deepEqual(
  filterLinuxDoTemplates(templates, '开源', '*').map((template) => template.id),
  [101],
)
assert.deepEqual(
  filterLinuxDoTemplates(templates, '', '公益推广').map((template) => template.id),
  [102],
)
assert.deepEqual(
  filterLinuxDoTemplates(templates, '', '__none__').map((template) => template.id),
  [103],
)
assert.deepEqual(collectLinuxDoTemplateTags(templates), [
  { name: '公益推广', count: 1 },
  { name: '开源推广', count: 1 },
  { name: '软件开发', count: 1 },
])
assert.deepEqual(
  resolveLinuxDoTemplate(templates[0], {
    my_username: 'frank',
    my_name: 'Frank',
  }),
  {
    title: '开源推广发帖模板',
    content: '你好 @frank\n项目：新项目',
  },
)
assert.deepEqual(
  resolveLinuxDoTemplate(templates[2], {}),
  {
    title: 'LINUX DO 抽奖模板',
    content: '发起人：活动发起人',
  },
)
assert.deepEqual(
  resolveLinuxDoTemplate({ title: '聊天 %{chat_channel_name}', content: '频道=%{chat_channel_name,fallback:无} / %{chat_thread_url}' }, {}),
  { title: '聊天 ', content: '频道=无 / ' },
  'composer must strip or apply fallbacks for official chat-only variables just like Discourse',
)
await templateService.recordUse(101)
assert.ok(templateCalls.some((call) => call.method === 'GET' && call.url.endsWith('/discourse_templates') && call.auth === 'required'))
assert.ok(templateCalls.some((call) => call.method === 'POST' && call.url.endsWith('/discourse_templates/101/use') && call.auth === 'required'))

const draftService = new LinuxDoDraftService({} as any)
assert.equal(draftService.keyFor({ action: 'createTopic' }), 'new_topic')
assert.equal(draftService.keyFor({ action: 'reply', topicId: 100 }), 'topic_100')
assert.equal(draftService.keyFor({ action: 'edit', postId: 501 }), 'post_501')

const uploadService = new LinuxDoUploadService()
assert.equal(uploadService.markdown({ url: 'https://linux.do/u.png', originalFilename: 'u.png' }, new File(['x'], 'u.png', { type: 'image/png' })), '![u.png](https://linux.do/u.png)')
assert.equal(uploadService.markdown({ url: 'https://linux.do/uploads/default/original/1X/u.png', shortUrl: 'upload://abc123', originalFilename: 'u.png' }, new File(['x'], 'u.png', { type: 'image/png' })), '![u.png](upload://abc123)', 'composer markdown should preserve Discourse short URLs; only local preview resolves them')
assert.deepEqual(uploadService.shortUrls('a upload://abc.png b upload://abc.png c upload://xyz.webp'), ['upload://abc.png', 'upload://xyz.webp'])
assert.equal(uploadService.markdown({ url: 'https://linux.do/a.zip', originalFilename: 'a.zip' }, new File(['x'], 'a.zip', { type: 'application/zip' })), '[a.zip](https://linux.do/a.zip)')
assert.equal(LINUXDO_UPLOAD_BATCH_LIMIT, 15)
assert.equal(LINUXDO_UPLOAD_CONCURRENCY, 3)
let activePoolWorkers = 0
let maxPoolWorkers = 0
const poolResult = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
  activePoolWorkers += 1
  maxPoolWorkers = Math.max(maxPoolWorkers, activePoolWorkers)
  await new Promise((resolve) => setTimeout(resolve, (6 - value) * 2))
  activePoolWorkers -= 1
  return value * 10
})
assert.deepEqual(poolResult, [10, 20, 30, 40, 50], 'bounded upload pool must preserve the selected file order')
assert.equal(maxPoolWorkers, 2, 'bounded upload pool must not exceed configured concurrency')
await assert.rejects(
  () => uploadService.uploadMany(Array.from({ length: LINUXDO_UPLOAD_BATCH_LIMIT + 1 }, (_, index) => new File(['x'], `f-${index}.png`, { type: 'image/png' }))),
  /一次最多选择 15 个文件/,
)
const uploadLookupCalls: Array<{ url: string; form: Record<string, unknown>; auth?: string }> = []
const uploadLookupService = new LinuxDoUploadService({
  postForm: async (url: string, form: Record<string, unknown>, options?: { auth?: string }) => {
    uploadLookupCalls.push({ url, form, auth: options?.auth })
    return [{ short_url: 'upload://abc.png', url: '/uploads/default/original/1X/abc.png' }]
  },
} as any)
assert.deepEqual(await uploadLookupService.lookupPreviewUrls(['upload://abc.png']), {
  'upload://abc.png': 'https://linux.do/uploads/default/original/1X/abc.png',
})
assert.equal(uploadLookupCalls[0]?.url, 'https://linux.do/uploads/lookup-urls.json')
assert.deepEqual(uploadLookupCalls[0]?.form, { 'short_urls[]': ['upload://abc.png'] })
assert.equal(uploadLookupCalls[0]?.auth, 'required')

const peopleCalls: Array<{ url: string; options?: { auth?: string } }> = []
const fakeApi = {
  getJson: async (url: string, options?: { auth?: string }) => {
    peopleCalls.push({ url, options })
    if (url.includes('/bookmarks.json')) return { bookmarks: [{ id: 7, post_id: 501, post_number: 3, topic_id: 100, title: 'Saved topic', slug: 'saved-topic' }] }
    if (url.includes('/user-badges/frank.json')) return {
      user_badges: [
        { id: 70, granted_at: '2026-09-01T00:00:00Z', is_favorite: true, badge: { id: 7, name: '自传作者', description: '填写个人资料信息', icon: 'user-pen', slug: 'autobiographer' } },
        { id: 71, granted_at: '2026-09-02T00:00:00Z', badge: { id: 8, name: '编辑者', description: '首次编辑帖子', icon: 'pen', slug: 'editor' } },
      ],
    }
    if (url.includes('/summary.json')) return {
      user_summary: {
        likes_given: 21,
        likes_received: 88,
        topics_entered: 1200,
        posts_read_count: 4300,
        days_visited: 320,
        topic_count: 12,
        post_count: 98,
        time_read: 7200,
        recent_time_read: 600,
        can_see_summary_stats: true,
        can_see_user_actions: true,
        topics: [{ id: 100, slug: 'top-topic', title: 'Top Topic', category_id: 9, like_count: 15, created_at: '2026-09-20T00:00:00Z' }],
        replies: [{ post_number: 7, like_count: 3, created_at: '2026-09-20T01:00:00Z', topic: { id: 101, slug: 'reply-topic', title: 'Reply Topic', category_id: 9 } }],
        links: [{ url: 'https://example.com/docs', title: 'Docs', clicks: 9, post_number: 7, topic: { id: 101, slug: 'reply-topic', title: 'Reply Topic' } }],
        most_replied_to_users: [{ id: 2, username: 'alice', count: 6, avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }],
        most_liked_users: [{ id: 3, username: 'bob', count: 5, avatar_template: '/user_avatar/linux.do/bob/{size}/2.png' }],
        most_liked_by_users: [{ id: 4, username: 'carol', count: 4, avatar_template: '/user_avatar/linux.do/carol/{size}/3.png' }],
        top_categories: [{ id: 9, name: '开发调优', slug: 'dev', topic_count: 5, post_count: 40, color: '3AB54A' }],
        badges: [{ id: 70, granted_at: '2026-09-01T00:00:00Z', count: 1, badge: { id: 7, name: '自传作者', description: '填写个人资料信息', icon: 'user-pen', slug: 'autobiographer' } }],
      },
    }
    if (url.includes('/user_actions.json')) return {
      user_actions: [{
        action_type: 5,
        created_at: '2026-09-20T02:00:00Z',
        username: 'frank',
        avatar_template: '/user_avatar/linux.do/frank/{size}/1.png',
        topic_id: 101,
        post_id: 501,
        post_number: 7,
        reply_to_post_number: 1,
        category_id: 9,
        slug: 'reply-topic',
        title: 'Reply Topic',
        excerpt: '<p>hello <strong>world</strong><script>bad()</script></p>',
      }],
      topics: [],
      users: [],
    }
    return { user: { id: 42, username: 'frank', name: 'Frank', trust_level: 3, bio_cooked: '<p>Bio</p>', featured_user_badge_ids: [7] } }
  },
} as any
const bookmarkService = new LinuxDoBookmarkService(fakeApi)
const bookmarkResult = await bookmarkService.list('frank')
assert.equal(bookmarkResult.items[0]?.topicId, 100)
assert.equal(bookmarkResult.items[0]?.postNumber, 3)
const peopleService = new LinuxDoPeopleService(fakeApi)
const profile = await peopleService.profile('frank')
assert.equal(profile.trustLevel, 3)
assert.deepEqual(profile.featuredUserBadgeIds, [7])
assert.equal('postCount' in profile, false, 'profile endpoint must not invent summary statistics')
const publicSummary = await peopleService.summary('frank')
assert.equal(publicSummary.topicCount, 12)
assert.equal(publicSummary.postCount, 98)
assert.equal(publicSummary.likesReceived, 88)
assert.equal(publicSummary.likesGiven, 21)
assert.equal(publicSummary.topics[0]?.title, 'Top Topic')
assert.equal(publicSummary.replies[0]?.postNumber, 7)
assert.equal(publicSummary.topCategories[0]?.name, '开发调优')
assert.equal(publicSummary.mostRepliedToUsers[0]?.username, 'alice')
assert.equal(publicSummary.badges[0]?.name, '自传作者')
assert.equal(publicSummary.badges[0]?.badgeId, 7)
const publicBadges = await peopleService.badges('frank')
assert.equal(publicBadges.length, 2)
assert.equal(publicBadges[0]?.name, '自传作者')
assert.equal(publicBadges[0]?.favorite, true)
const publicReplies = await peopleService.activity('frank', { filter: 'replies' })
assert.equal(publicReplies.actions[0]?.actionType, 5)
assert.equal(publicReplies.actions[0]?.title, 'Reply Topic')
assert.match(publicReplies.actions[0]?.excerpt ?? '', /<strong>world<\/strong>/)
assert.doesNotMatch(publicReplies.actions[0]?.excerpt ?? '', /<script/i)
assert.ok(peopleCalls.some((call) => call.url.endsWith('/u/frank/summary.json') && call.options?.auth === 'optional'))
assert.ok(peopleCalls.some((call) => call.url.endsWith('/user-badges/frank.json') && call.options?.auth === 'optional'))
assert.ok(peopleCalls.some((call) => call.url.includes('/user_actions.json?username=frank&offset=0&filter=5') && call.options?.auth === 'optional'))
const rootlessSummaryService = new LinuxDoPeopleService({ getJson: async () => ({ topic_count: 3, post_count: 0, topics: [], replies: [], badges: [] }) } as any)
const rootlessSummary = await rootlessSummaryService.summary('rootless')
assert.equal(rootlessSummary.topicCount, 3)
assert.equal(rootlessSummary.postCount, 0, 'an explicit zero from Discourse must remain zero')
const missingSummaryService = new LinuxDoPeopleService({ getJson: async () => ({ topics: [], replies: [], badges: [] }) } as any)
const missingSummary = await missingSummaryService.summary('private-stats')
assert.equal(missingSummary.topicCount, undefined, 'missing/hidden stats must not be presented as zero')
assert.equal(missingSummary.likesReceived, undefined)

const searchService = new LinuxDoSearchService({
  getJson: async () => ({
    topics: [],
    users: [{ id: 5, username: 'alice', avatar_template: '/user_avatar/linux.do/alice/{size}/1.png' }],
    posts: [{ id: 91, post_number: 6, username: 'alice', blurb: '<b>matched</b>', created_at: '2026-09-20T00:00:00Z', topic: { id: 44, slug: 'search-hit', title: 'Search Hit' } }],
  }),
} as any)
const search = await searchService.search('matched')
assert.equal(search.posts[0]?.topicId, 44)
assert.equal(search.posts[0]?.topicSlug, 'search-hit')
assert.match(search.posts[0]?.cooked ?? '', /matched/)
const searchCache = createLinuxDoSearchCache()
assert.deepEqual({ query: searchCache.query, activeTab: searchCache.activeTab, page: searchCache.page, hasMore: searchCache.hasMore, scrollTop: searchCache.scrollTop }, { query: '', activeTab: 'topics', page: 1, hasMore: false, scrollTop: 0 })

const notificationWrites: Array<{ url: string; form: Record<string, unknown> }> = []
const serverUnreadNotificationIds = new Set([12, 13, 14, 15, 16, 17, 18])
const notificationService = new LinuxDoNotificationService({
  putForm: async (url: string, form: Record<string, unknown>) => {
    notificationWrites.push({ url, form })
    const id = Number(form.id)
    if (Number.isInteger(id) && id > 0) serverUnreadNotificationIds.delete(id)
    else serverUnreadNotificationIds.clear()
  },
  getJson: async (url: string) => {
    if (url === linuxDoEndpoints.sessionCurrent) {
      return {
        current_user: {
          id: 42,
          username: 'frank',
          unread_notifications: Math.min(2, serverUnreadNotificationIds.size),
          all_unread_notifications_count: serverUnreadNotificationIds.size,
        },
      }
    }
    return url.includes('filter=unread')
      ? {
        total_rows_notifications: 700,
        notifications: serverUnreadNotificationIds.size
          ? [{ id: [...serverUnreadNotificationIds][0], notification_type: 25, read: false, created_at: '2026-09-21T01:00:00Z', topic_id: 100 }]
          : [],
      }
      : { notifications: [] }
  },
} as any)
assert.equal(await notificationService.unreadCount(), 7, 'badge count must use Discourse all_unread_notifications_count, not notification-list pagination totals')
await notificationService.markRead(12)
assert.equal(await notificationService.unreadCount(), 6, 'single mark-read must persist on the next unread-count refresh')
await notificationService.markAllRead()
assert.deepEqual(notificationWrites, [
  { url: linuxDoEndpoints.markNotificationsRead, form: { id: 12 } },
  { url: linuxDoEndpoints.markNotificationsRead, form: {} },
])
assert.equal('notification_id' in notificationWrites[0]!.form, false)
assert.equal(await notificationService.unreadCount(), 0, 'mark-all-read must persist after a server refresh')
const fallbackNotificationService = new LinuxDoNotificationService({
  getJson: async (url: string) => {
    if (url === linuxDoEndpoints.sessionCurrent) throw new Error('session/current unavailable')
    return {
      total_rows_notifications: 88,
      notifications: [
        { id: 301, notification_type: 25, read: false, created_at: '2026-09-21T02:00:00Z', topic_id: 100 },
        { id: 302, notification_type: 2, read: false, created_at: '2026-09-21T02:01:00Z', topic_id: 101 },
      ],
    }
  },
} as any)
assert.equal(await fallbackNotificationService.unreadCount(), 2, 'unread fallback must count returned unread rows and ignore total_rows_notifications')

const privateMessageCalls: string[] = []
const privateMessageService = new LinuxDoNotificationService({
  getJson: async (url: string) => {
    privateMessageCalls.push(url)
    const page = url.includes('page=3') ? 3 : 0
    return {
      users: [{ id: 7, username: page ? 'bob' : 'alice', avatar_template: '/user_avatar/linux.do/user/{size}/1.png' }],
      topic_list: {
        more_topics_url: page === 0 ? '/topics/private-messages/frank.json?page=3' : null,
        topics: [{
          id: page === 0 ? 701 : 700,
          slug: page === 0 ? 'new-pm' : 'older-pm',
          title: page === 0 ? '最新私信' : '更早私信',
          posts_count: 3,
          reply_count: 2,
          views: 0,
          like_count: 0,
          created_at: '2026-09-20T00:00:00Z',
          last_posted_at: page === 0 ? '2026-09-22T04:00:00Z' : '2026-09-21T04:00:00Z',
          posters: [{ user_id: 7, description: 'Original Poster' }],
          unseen: page === 0,
          unread: page === 0 ? 2 : 0,
        }],
      },
    }
  },
} as any)
const privatePage0 = await privateMessageService.privateMessages('frank')
assert.equal(privatePage0.items[0]?.id, 701)
assert.equal(privatePage0.items[0]?.unread, 2)
assert.equal(privatePage0.nextPage, 3, 'PM inbox must follow the exact page from topic_list.more_topics_url')
const privatePage1 = await privateMessageService.privateMessages('frank', privatePage0.nextPage)
assert.equal(privatePage1.items[0]?.id, 700)
assert.equal(privatePage1.nextPage, undefined)
assert.deepEqual(privateMessageCalls, [linuxDoEndpoints.privateMessages('frank', 0), linuxDoEndpoints.privateMessages('frank', 3)])

const javaSource = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoSessionPlugin.java', 'utf8')
const authJavaSource = readFileSync('android/app/src/main/java/com/aizeek/newsnook/LinuxDoUserApiAuth.java', 'utf8')
const manifestSource = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')
const clientSource = readFileSync('src/features/linuxdo/api/client.ts', 'utf8')
const threadViewSource = readFileSync('src/features/linuxdo/ui/ThreadViews.tsx', 'utf8')
const composerEditorSource = readFileSync('src/features/linuxdo/editor/ComposerEditor.tsx', 'utf8')
const workspaceSource = readFileSync('src/features/linuxdo/ui/LinuxDoWorkspace.tsx', 'utf8')
const communityViewsSource = readFileSync('src/features/linuxdo/ui/CommunityViews.tsx', 'utf8')
const userProfileSource = readFileSync('src/features/linuxdo/ui/UserProfileView.tsx', 'utf8')
const discoverViewSource = readFileSync('src/features/linuxdo/ui/DiscoverView.tsx', 'utf8')
const discoveryServiceSource = readFileSync('src/features/linuxdo/discovery/service.ts', 'utf8')
const feedServiceSource = readFileSync('src/features/linuxdo/feed/service.ts', 'utf8')
const passwordLoginSource = readFileSync('src/features/linuxdo/session/password.ts', 'utf8')
const accountViewSource = readFileSync('src/features/linuxdo/ui/AccountView.tsx', 'utf8')
assert.equal(javaSource.includes('result.put("cookie"'), false)
assert.equal(javaSource.includes('result.put("key"'), false)
assert.match(javaSource, /followRedirects\(false\)/)
assert.match(javaSource, /"Set-Cookie"\.equalsIgnoreCase/)
assert.match(javaSource, /isApiAllowedUrl/)
assert.match(javaSource, /CONNECT_ORIGIN = "https:\/\/connect\.linux\.do"/)
assert.match(javaSource, /fetchConnectTrustPage/)
assert.match(javaSource, /CONNECT_MAX_REDIRECTS/)
assert.match(javaSource, /isConnectTrustAllowedUrl/)
assert.match(javaSource, /manager\.getCookie\(url\)/)
assert.match(javaSource, /cookieUrl = response\.request\(\)\.url\(\)\.toString\(\)/)
assert.match(javaSource, /can_use_templates/)
assert.match(javaSource, /all_unread_notifications_count/)
assert.match(javaSource, /allUnreadNotificationsCount/)
assert.match(javaSource, /canUseTemplates/)
assert.match(javaSource, /UploadProgressRequestBody/)
assert.match(javaSource, /linuxDoUploadProgress/)
assert.match(javaSource, /SESSION_CACHE_PREFS/)
assert.match(javaSource, /cachedSessionUser\(\)/)
assert.match(javaSource, /response\.code\(\) == 401/)
assert.match(javaSource, /definitiveLogout/)
assert.match(javaSource, /syncResponseCookies\(response\)/)
assert.match(javaSource, /cf-mitigated/)
assert.match(javaSource, /preferBrowserTransport/)
assert.match(javaSource, /boolean browserOnly = Boolean\.TRUE\.equals\(call\.getBoolean\("browserOnly", false\)\)/)
assert.match(javaSource, /if \(browserOnly\) \{/)
assert.match(javaSource, /LINUXDO_BROWSER_REQUEST/)
assert.match(javaSource, /performBrowserRequest/)
assert.match(javaSource, /BROWSER_BRIDGE_NAME/)
assert.match(javaSource, /credentials:'include'/)
assert.match(javaSource, /loadDataWithBaseURL/)
assert.match(javaSource, /isForbiddenBrowserHeader/)
assert.match(javaSource, /destroyBrowserTransport/)
assert.match(javaSource, /User-Api-Key/)
assert.match(javaSource, /User-Api-Client-Id/)
assert.match(authJavaSource, /AndroidKeyStore/)
assert.match(authJavaSource, /AES\/GCM\/NoPadding/)
assert.match(authJavaSource, /cipher\.init\(Cipher\.ENCRYPT_MODE, key\)/)
assert.match(authJavaSource, /byte\[\] iv = cipher\.getIV\(\)/)
assert.doesNotMatch(authJavaSource, /Cipher\.ENCRYPT_MODE, key, new GCMParameterSpec/)
assert.match(authJavaSource, /RSA\/ECB\/PKCS1Padding/)
assert.match(authJavaSource, /Intent\.ACTION_VIEW/)
assert.match(authJavaSource, /Intent\.CATEGORY_BROWSABLE/)
assert.doesNotMatch(authJavaSource, /resolveActivity\(activity\.getPackageManager\(\)\)/)
assert.match(authJavaSource, /CustomTabsIntent/)
assert.match(authJavaSource, /setColorScheme\(CustomTabsIntent\.COLOR_SCHEME_SYSTEM\)/)
assert.match(authJavaSource, /setShareState\(CustomTabsIntent\.SHARE_STATE_ON\)/)
assert.match(authJavaSource, /customTabs\.launchUrl\(activity, uri\)/)
assert.match(authJavaSource, /\/user-api-key\/new/)
assert.doesNotMatch(authJavaSource, /\/user-api-key\/device\.json/)
assert.doesNotMatch(authJavaSource, /\/user-api-key\/device\/poll\.json/)
assert.match(authJavaSource, /AUTH_REDIRECT = "discourse:\/\/auth_redirect"/)
assert.doesNotMatch(authJavaSource, /appendQueryParameter\("padding", "oaep"\)/)
assert.match(authJavaSource, /appendQueryParameter\("auth_redirect", AUTH_REDIRECT\)/)
assert.match(authJavaSource, /PREF_PENDING_NONCE/)
assert.match(authJavaSource, /PREF_PENDING_STARTED_AT/)
assert.match(authJavaSource, /handleRedirect\(Uri uri\)/)
assert.match(authJavaSource, /constantTimeEquals\(expectedNonce, nonce\)/)
assert.match(authJavaSource, /SCOPES = "one_time_password"/)
assert.match(authJavaSource, /oneTimePassword/)
assert.match(javaSource, /OTP_CSRF_URL = ORIGIN \+ "\/session\/csrf\.json\?newsnook_otp_csrf=1"/)
assert.match(javaSource, /OTP_EXCHANGE_TIMEOUT_MILLIS/)
assert.match(javaSource, /\/session\/otp\//)
assert.match(javaSource, /application\/json, text\/javascript, \*\/\*; q=0\.01/)
assert.match(javaSource, /LINUXDO_USER_API_OTP_TIMEOUT/)
assert.match(javaSource, /burnUserApiCredential/)
assert.match(authJavaSource, /CLIENT_ID_PREFIX = "newsnook-android-v3-"/)
assert.match(authJavaSource, /RSA_ALIAS = "newsnook_linuxdo_user_api_rsa_v2"/)
assert.match(authJavaSource, /PREF_CLIENT_ID/)
assert.doesNotMatch(authJavaSource, /java\.time\.Instant/)
assert.match(clientSource, /authMode !== 'user-api-key'/)
assert.match(clientSource, /error\.status === 403/)
assert.match(clientSource, /this\.csrfToken = ''/)
assert.match(clientSource, /Discourse-Logged-In/)
assert.match(clientSource, /Discourse-Present/)
assert.match(clientSource, /Origin: linuxDoEndpoints\.origin/)
assert.match(clientSource, /browserOnly: options\.browserOnly/)
assert.match(clientSource, /this\.csrf\(options\.browserOnly === true\)/)
assert.match(javaSource, /call\.reject\(message, code\)/)
assert.doesNotMatch(javaSource, /call\.reject\(code, message\)/)
assert.match(javaSource, /handleOnNewIntent\(Intent intent\)/)
assert.match(javaSource, /userApiAuth\.handleRedirect\(intent\.getData\(\)\)/)
assert.match(manifestSource, /android:scheme="discourse" android:host="auth_redirect"/)
assert.match(threadViewSource, /event\.preventDefault\(\)\s*\n\s*event\.stopPropagation\(\)/)
assert.match(threadViewSource, /querySelectorAll<HTMLImageElement>\('img\[data-linuxdo-role="content-image"\]'\)/)
assert.match(threadViewSource, /onPrevious=/)
assert.match(threadViewSource, /onNext=/)
assert.match(threadViewSource, /\[data-linuxdo-role="quote"\]/)
assert.match(threadViewSource, /\[data-linuxdo-role="onebox"\]/)
assert.match(threadViewSource, /\[data-linuxdo-role="spoiler"\]/)
assert.match(threadViewSource, /type="file" multiple/)
assert.match(threadViewSource, /uploadMany\(files/)
assert.match(threadViewSource, /重试失败项/)
assert.doesNotMatch(threadViewSource, /uploadLabel/)
assert.match(composerEditorSource, /whitespace-nowrap rounded-full/)
assert.match(composerEditorSource, /正在上传 \{uploadItems\.length\} 个文件/)
assert.match(composerEditorSource, /已完成 \{uploadCompleted\}\/\{uploadItems\.length\}/)
assert.match(workspaceSource, /onScopeChange=\{replaceDiscoverScope\}/)
assert.match(workspaceSource, /cacheRef=\{discoverCacheRef\}/)
assert.match(workspaceSource, /searchCacheRef = useRef\(createLinuxDoSearchCache\(\)\)/)
assert.match(workspaceSource, /<SearchView cacheRef=\{searchCacheRef\}/)
assert.match(readFileSync('src/features/linuxdo/ui/SearchView.tsx', 'utf8'), /cacheRef\.current\.scrollTop = event\.currentTarget\.scrollTop/)
assert.match(readFileSync('src/features/linuxdo/ui/SearchView.tsx', 'utf8'), /autoFocus=\{!lastQuery\}/)
assert.match(workspaceSource, /navigate\(\{ kind: 'topic', topic \}\)/)
assert.match(workspaceSource, /onCreated=\{\(post, boost\) =>/)
assert.match(workspaceSource, /boosts: \[\.\.\.\(post\.boosts \?\? \[\]\), boost\]/)
assert.match(workspaceSource, /canBoost: false/)
assert.match(workspaceSource, /Boost 已发送，并已显示在当前帖子中/)
assert.match(workspaceSource, /\{ id: 'hot', label: '热门' \}/)
assert.match(workspaceSource, /\{ id: 'top', label: '排行榜'/)
assert.match(workspaceSource, /\{ id: 'posted', label: '我的帖子'/)
assert.match(workspaceSource, /\{ id: 'read', label: '已读'/)
assert.match(workspaceSource, /\{ id: 'bookmarks', label: '书签'/)
assert.match(workspaceSource, /Math\.abs\(dx\) <= Math\.abs\(dy\) \* 1\.35/)
assert.match(workspaceSource, /requestIdRef\.current \+= 1/)
assert.match(workspaceSource, /currentModeRef\.current = nextMode/)
assert.match(workspaceSource, /requestMode !== currentModeRef\.current/)
assert.match(workspaceSource, /hasMoreRef\.current && !busyRef\.current/)
assert.match(workspaceSource, /!error && hasMoreRef\.current/)
assert.match(workspaceSource, /route\.kind === 'notifications' \? 'is-active'/)
assert.match(workspaceSource, /onUnreadChange=\{applyNotificationUnread\}/)
assert.match(workspaceSource, /notificationsApi\.unreadCount\(\)/)
assert.match(communityViewsSource, /notificationsApi\.markAllRead\(\)/)
assert.match(communityViewsSource, /notificationsApi\.markRead\(item\.id\)/)
assert.match(communityViewsSource, /resolveLinuxDoNotificationTarget\(item, session\.currentUser\?\.username\)/)
assert.match(communityViewsSource, /mutationGeneration === mutationGenerationRef\.current/)
assert.match(communityViewsSource, /document\.addEventListener\('visibilitychange'/)
assert.match(communityViewsSource, /onOpenUser\(target\.username, target\.tab, target\.badgeId\)/)
assert.match(userProfileSource, /initialBadgeId/)
assert.match(userProfileSource, /本次获得/)
assert.match(feedServiceSource, /linuxDoEndpoints\.hot\(page\)/)
assert.match(feedServiceSource, /linuxDoEndpoints\.top\(page\)/)
assert.match(feedServiceSource, /linuxDoEndpoints\.bookmarkedTopics\(page\)/)
assert.match(feedServiceSource, /more_topics_url/)
assert.doesNotMatch(feedServiceSource, /'weekly'/)
assert.doesNotMatch(workspaceSource, /onFailed=/)
assert.match(threadViewSource, /Boost 发送失败：/)
assert.doesNotMatch(threadViewSource, /onFailed\?\./)
assert.match(threadViewSource, /closeConfirmMode === 'save-failed'/)
assert.match(threadViewSource, /confirmLabel=\{closeConfirmMode === 'save-failed' \|\| !session\.authenticated \? '直接关闭' : '保存并关闭'\}/)
assert.match(threadViewSource, /setCloseConfirmMode\('save-failed'\)/)
assert.match(threadViewSource, /本次未保存的修改会丢失/)
assert.match(threadViewSource, /发送中…/)
assert.match(discoverViewSource, /DISCOVERY_ORDERS/)
assert.match(discoverViewSource, /loadMoreActiveScope/)
assert.match(discoveryServiceSource, /more_topics_url/)
assert.match(passwordLoginSource, /verifyLinuxDoBrowserSession\('https:\/\/linux\.do\/login'\)/)
assert.doesNotMatch(passwordLoginSource, /requestLinuxDoNative/)
assert.doesNotMatch(passwordLoginSource, /localStorage|sessionStorage|console\.(?:log|debug|info|warn|error)/)
assert.match(accountViewSource, /账号密码登录（Linux\.do 官方页面）/)
assert.match(accountViewSource, /GitHub \/ Google 等第三方登录/)
assert.match(accountViewSource, /await authenticateLinuxDo\(\)/)
assert.match(accountViewSource, /await cancelLinuxDoAuthentication\(\)/)
assert.match(accountViewSource, /信任等级/)
assert.match(accountViewSource, /onTrustLevel/)
assert.match(workspaceSource, /kind: 'trust'/)
assert.match(workspaceSource, /<TrustLevelView session=\{session\}/)
assert.doesNotMatch(accountViewSource, /Browser\.open\(\{ url: 'https:\/\/linux\.do\/login'/)
const cssSource = readFileSync('src/index.css', 'utf8')
const paragraphCssFixture = parseHTML(
  '<html><body><div class="reader-prose"><p>啊哈哈，这个就好呀！<br>一个L站顶几十个的rss</p></div></body></html>',
).document.querySelector('p')
assert.ok(paragraphCssFixture)
const hiddenReaderParagraphSelectors = Array.from(
  cssSource.matchAll(/([^{}]+)\{[^{}]*\bdisplay:\s*none\s*;/g),
).flatMap((match) => match[1]!.split(',').map((selector) => selector.trim()))
  .filter((selector) => selector.includes('.reader-prose') && /\bp\b/.test(selector))
assert.equal(
  hiddenReaderParagraphSelectors.some((selector) => paragraphCssFixture.matches(selector)),
  false,
  'a text paragraph with one line break must remain visible',
)
assert.match(cssSource, /\.reader-prose\.linuxdo-post-prose p\s*\{\s*text-indent:\s*0\s*!important;/)
assert.match(cssSource, /font-size:\s*15\.5px/)
assert.match(cssSource, /data-linuxdo-role='quote'/)
assert.match(cssSource, /data-linuxdo-role='onebox-topic'/)
assert.match(cssSource, /data-linuxdo-role='mention'/)
assert.match(cssSource, /data-linuxdo-role='spoiler'/)
assert.match(cssSource, /data-linuxdo-role='callout'/)
assert.match(cssSource, /data-linuxdo-callout='warning'/)
assert.match(cssSource, /data-linuxdo-callout='success'/)
assert.match(cssSource, /--linuxdo-callout-warning-bg/)
assert.match(cssSource, /\.linuxdo-workspace \.linuxdo-icon-button\.is-active\s*\{[^}]*background:\s*var\(--color-cinnabar\);[^}]*color:\s*white;/s)
const lightboxSource = readFileSync('src/components/ImageLightbox.tsx', 'utf8')
assert.match(lightboxSource, /左右滑动切换/)
assert.match(lightboxSource, /aria-label="上一张"/)
assert.match(lightboxSource, /aria-label="下一张"/)

// Quote sanitization tests (topic quote and user quote)
const cookedTopicQuote = `
<aside class="quote quote-modified" data-post="1" data-topic="2840224">
  <div class="title">
    <div class="quote-controls"></div>
    <img alt="" width="24" height="24" src="https://cdn.ldstatic.com/letter_avatar\\/czm/48/6_22734026db12803ebb3e059622ac3534.png" class="avatar">
    <div class="quote-title__text-content">
      <a href="https://linux.do/t/topic/2840224">装了飞书、钉钉、企微皮肤的建议更新新版哈，有一个重要的更新</a> <a class="badge-category__wrapper " href="/c/gossip/11"><span data-category-id="11" style="--category-badge-color: #3AB54A; --category-badge-text-color: #000000;" data-drop-close="true" class="badge-category --style-icon "><svg class="fa d-icon svg-icon svg-node" aria-hidden="true"><svg id="droplet" viewBox="0 0 384 512"><path d="M192 512C86 512 0 426 0 320C0 228.8 130.2 57.7 166.6 11.7C172.6 4.2 181.5 0 191.1 0l1.8 0c9.6 0 18.5 4.2 24.5 11.7C253.8 57.7 384 228.8 384 320c0 106-86 192-192 192zM96 336c0-8.8-7.2-16-16-16s-16 7.2-16 16c0 61.9 50.1 112 112 112c8.8 0 16-7.2 16-16s-7.2-16-16-16c-44.2 0-80-35.8-80-80z"></path></svg></svg><span class="badge-category__name">搞七捻三</span></span></a>
    </div>
  </div>
  <blockquote>
    前情提要： 
<a href="https://linux.do/t/topic/2813964" class="inline-onebox">【建议佬友们更新最新版】摸鱼神器 2.0 —— 飞书 App 风格 LinuxDo</a>
  </blockquote>
</aside>
`
const sanitizedTopicQuote = sanitizeLinuxDoCooked(cookedTopicQuote)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-topic-id="2840224"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-post-number="1"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-header"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-avatar"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-title-link"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-category"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-category-color="#3AB54A"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-category-dot"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-category-name"/)
assert.match(sanitizedTopicQuote, /搞七捻三/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-controls"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-chevron"/)
assert.match(sanitizedTopicQuote, /data-linuxdo-role="quote-body"/)
assert.doesNotMatch(sanitizedTopicQuote, /<svg[^>]*droplet/i)
assert.doesNotMatch(sanitizedTopicQuote, /data-linuxdo-role="badge-image"[^>]*letter_avatar\/czm/)

const cookedUserQuote = `
<aside class="quote no-group" data-username="czm" data-post="1" data-topic="2817831">
  <div class="title">
    <div class="quote-controls"></div>
    <img alt="" width="24" height="24" src="https://cdn.ldstatic.com/letter_avatar\/czm/48/5_5575768a8748004e209b776fc1b2916d.png" class="avatar"> czm:
  </div>
  <blockquote>
    <p>于是也手搓了一个</p>
  </blockquote>
</aside>
`
const sanitizedUserQuote = sanitizeLinuxDoCooked(cookedUserQuote)
assert.match(sanitizedUserQuote, /data-linuxdo-role="quote-username"/)
assert.match(sanitizedUserQuote, /czm:/)
assert.match(sanitizedUserQuote, /data-linuxdo-role="quote-avatar"/)

// CSS rules for quote rendering and links
assert.match(cssSource, /\.reader-prose\.linuxdo-post-prose blockquote\s*\{\s*font-style:\s*normal\s*!important;/)
assert.match(cssSource, /\.reader-prose\.linuxdo-post-prose a\s*\{[^}]*border-bottom:\s*none\s*!important;/)
assert.match(cssSource, /data-linuxdo-role='quote-title-link'/)
assert.match(cssSource, /data-linuxdo-role='quote-category-dot'/)
assert.match(cssSource, /data-linuxdo-role='quote-chevron'/)

// CSS rules for mobile card width optimization and readable desktop measure
assert.match(cssSource, /\.linuxdo-workspace \.page-x\s*\{\s*padding-inline:\s*0\.5rem;/)
assert.match(cssSource, /max-width:\s*860px;/)

const threadViewsSource = readFileSync(new URL('../src/features/linuxdo/ui/ThreadViews.tsx', import.meta.url), 'utf8')
assert.match(threadViewsSource, /rounded-xl sm:rounded-2xl border border-haze\/45 bg-ink-raised\/85 p-3 sm:p-4/)
assert.match(threadViewsSource, /setPosts\(\(current\) => current\.map\(\(post\) => acknowledged\.has\(post\.postNumber\) \? \{ \.\.\.post, read: true \} : post\)\)/)
assert.match(threadViewsSource, /LinuxDO timings acknowledged/)
assert.match(threadViewsSource, /transport: 'session-chain'/)
assert.match(threadViewsSource, /setReadSyncFailure\(\{ error: nextError, batch, retrying \}\)/)
const readSyncStatusSource = readFileSync('src/features/linuxdo/ui/ReadSyncStatus.tsx', 'utf8')
assert.match(readSyncStatusSource, /data-linuxdo-read-sync/)
assert.match(readSyncStatusSource, /阅读记录尚未同步/)
assert.match(readSyncStatusSource, /复制诊断/)

const userWithCdnAvatar = decodeCurrentUser({
  current_user: {
    id: 43,
    username: 'cdn_user',
    avatar_template: 'https://cdn.linux.do/user_avatar/cdn_user/{size}/1.png',
  },
})
assert.equal(userWithCdnAvatar?.avatarTemplate, 'https://cdn.linux.do/user_avatar/cdn_user/96/1.png')

const userWithProtoAvatar = decodeCurrentUser({
  current_user: {
    id: 44,
    username: 'proto_user',
    avatar_template: '//cdn.linux.do/user_avatar/proto_user/{size}/1.png',
  },
})
assert.equal(userWithProtoAvatar?.avatarTemplate, 'https://cdn.linux.do/user_avatar/proto_user/96/1.png')

const utilsSource = readFileSync(new URL('../src/features/linuxdo/ui/utils.tsx', import.meta.url), 'utf8')
assert.match(utilsSource, /flex h-full w-full items-center justify-center overflow-hidden rounded-full select-none/)
assert.match(accountViewSource, /UserRound size=\{26\}/)
assert.match(accountViewSource, /flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full/)
const sharedViewsSource = readFileSync(new URL('../src/features/linuxdo/ui/shared.tsx', import.meta.url), 'utf8')
assert.match(sharedViewsSource, /rounded-xl sm:rounded-2xl border border-haze\/50 bg-ink-raised\/85 p-3 sm:p-4/)
assert.match(sharedViewsSource, /flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full/)
assert.match(cssSource, /\.linuxdo-workspace input\[class\*="outline-none"\]\s*,\s*\.linuxdo-workspace textarea\[class\*="outline-none"\]\s*\{\s*outline:\s*none\s*!important;/)

console.log('linuxdo: ok')
