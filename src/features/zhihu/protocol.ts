/**
 * 知乎私有协议能力矩阵。
 *
 * 这里是运行时 UI 与 service 的唯一能力闸门。第三方源码只能证明“曾有实现入口”，
 * 不能证明今天的线上协议仍可用，因此默认状态是 source-only。只有带实网验证记录的
 * 操作才能提升为 verified；未知写操作必须保持 blocked，禁止 UI 假成功。
 */

export type ZhihuProtocolStatus =
  | 'source-only'
  | 'verified'
  | 'upstream-unsupported'
  | 'blocked'

export type ZhihuAuthMode = 'guest' | 'optional' | 'required' | 'local-only'
export type ZhihuRetryPolicy = 'safe-read' | 'never'

export interface ZhihuProtocolEvidence {
  /** 仓库相对路径或固定 commit 的外部源码 URL，便于可复现审计；不得放 Cookie/token/私信正文。 */
  path: string
  /** source = 源码事实，corpus = 脱敏真实响应语料，live = 本项目授权实网记录，local-test = 本地行为测试。 */
  kind: 'source' | 'corpus' | 'live' | 'local-test'
  note: string
}

export interface ZhihuOperationContract {
  operation: string
  zIds: readonly string[]
  status: ZhihuProtocolStatus
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'LOCAL'
  auth: ZhihuAuthMode
  retry: ZhihuRetryPolicy
  /** 固定协议路径；动态实体以 :name 表示。未知协议必须为 null。 */
  endpoint: string | null
  /** 可安全提交仓库的脱敏 fixture。没有真实响应语料时不得补“看起来像真的”假 fixture。 */
  fixture?: string
  evidence: readonly ZhihuProtocolEvidence[]
  note: string
}

// third-party/ 在 NewsNook 中明确被 gitignore；协议证据不能依赖某台开发机上的可选克隆。
// 外部源码统一固定到审计时使用的上游 commit，避免 master 漂移后“同一路径、不同事实”。
const REF = 'https://github.com/zly2006/zhihu-plus-plus/blob/313541192b925028f23410d61b959e6837534c24/'

export const ZHIHU_OPERATIONS = [
  {
    operation: 'session.login', zIds: ['Z01'], status: 'source-only', method: 'POST', auth: 'guest', retry: 'never', endpoint: null,
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/account/ZhihuAccountClient.kt`, note: '参考项目存在认证客户端；本项目未获授权账号完成实网登录闭环。' }],
    note: 'Android 使用受控第一方 WebView 完成登录/注册/验证码，再以 /api/v4/me 判定成功；协议状态仍等待授权实网验收。',
  },
  {
    operation: 'session.validate', zIds: ['Z01'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/me',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ZhihuDataTypes.kt`, note: '参考实现定义 ZHIHU_ME_URL=https://www.zhihu.com/api/v4/me。' }],
    note: '恢复/切换账号后使用当前 Cookie 验证身份；不会把失败会话当成已登录。',
  },
  {
    operation: 'session.switch-account', zIds: ['Z01'], status: 'source-only', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [{ kind: 'local-test', path: 'scripts/zhihu-session.test.ts', note: 'generation 栅栏保证账号切换后旧请求结果被丢弃。' }], note: '纯本地账号作用域切换已经实现并测试，但不伪装成 live verified 远端协议。',
  },
  {
    operation: 'feed.recommended', zIds: ['Z02', 'Z03'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://api.zhihu.com/topstory/recommend',
    fixture: 'scripts/fixtures/zhihu/feed.recommended.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HomeFeedViewModel.kt`, note: '参考实现标记 allowGuestAccess。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/real-api/mobile-home-card.json`, note: '参考仓库保存的脱敏真实响应语料。' },
    ], note: 'Android/mobile 推荐候选；实际 Android 头部配置来自参考实现，挑战页/非 JSON 必须作为错误呈现。',
  },
  {
    operation: 'feed.recommended-web', zIds: ['Z02', 'Z03'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v3/feed/topstory/recommend',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/local/LocalRecommendationEngine.kt`, note: '参考本地推荐候选抓取使用 desktop=true 的 Web topstory 推荐。' },
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HomeFeedViewModel.kt`, note: '参考 Web feed 实现保留该网页推荐路径。' },
    ], note: 'Web 推荐与 Android 推荐独立保留游标；混合模式只做客户端合并，不篡改各自上游顺序。',
  },
  {
    operation: 'feed.hot', zIds: ['Z02'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HotListViewModel.kt`, note: '参考实现入口。' }],
    note: '尚无本项目实网响应 fixture。',
  },
  {
    operation: 'feed.following', zIds: ['Z02'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/moments_v3',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/local/LocalRecommendationEngine.kt`, note: '参考代码存在 moments_v3 feed_type=recommend 路径；关注流精确语义仍需验证。' }],
    note: '未完成登录时禁用。',
  },
  {
    operation: 'feed.lastread.touch', zIds: ['Z02', 'Z03'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/lastread/touch',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/HomeFeedViewModel.kt`, note: '参考实现对已曝光内容批量提交 touch，对真正打开内容提交 read。' }],
    note: '推荐反馈是 best-effort：只在已登录会话尝试，失败不能阻断阅读，也不伪装成 verified。',
  },
  {
    operation: 'search.query', zIds: ['Z04'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/search_v3',
    fixture: 'scripts/fixtures/zhihu/search.query.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/SearchViewModel.kt`, note: '参考项目搜索实现。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/search/search-general-sanitized.json`, note: '参考仓库脱敏搜索语料。' },
    ], note: '分类筛选参数仍按 source-only 处理。',
  },
  {
    operation: 'question.read', zIds: ['Z05', 'Z06'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/questions/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '问题详情 URL 与 include 字段。' }],
    note: '公开只读候选。',
  },
  {
    operation: 'question.answers', zIds: ['Z05'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/feeds',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/QuestionFeedViewModel.kt`, note: '参考项目回答分页实现。' }],
    note: '排序、limit 与 include 仍按源实现解析，不视作实网已验证。',
  },
  {
    operation: 'answer.read', zIds: ['Z05', 'Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/answers/:id',
    fixture: 'scripts/fixtures/zhihu/answer.read.source.json',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '回答详情 URL 与 include 字段。' },
      { kind: 'corpus', path: `${REF}shared/src/jvmTest/resources/real-api/answer-detail.json`, note: '参考仓库脱敏真实响应语料。' },
    ], note: 'fixture 只保留结构，不复制第三方正文。',
  },
  {
    operation: 'article.read', zIds: ['Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/articles/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '文章详情 URL。' }], note: '公开只读候选。',
  },
  {
    operation: 'pin.read', zIds: ['Z06', 'Z17'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/pins/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ContentDetailCache.kt`, note: '想法详情 URL。' }], note: '公开只读候选。',
  },
  {
    operation: 'video.play-info', zIds: ['Z06', 'Z17'], status: 'source-only', method: 'POST', auth: 'optional', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/video/play_info',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/data/ZhihuDataTypes.kt`, note: '参考实现 POST /api/v4/video/play_info?r=:videoId，并从 video_play.playlist.mp4 选择最高 bitrate URL。' }],
    note: '只用于读取视频播放信息；若匿名/签名请求被上游拒绝，正文播放器回退到通用媒体嗅探，不伪造播放成功。',
  },
  {
    operation: 'vote.set', zIds: ['Z07'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/:contentType/:id/voters',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/ArticleViewModel.kt`, note: '参考实现存在回答/文章赞同写操作。' }], note: '非幂等写；未经授权实网读回验证，UI 不启用。',
  },
  {
    operation: 'follow.person.set', zIds: ['Z09', 'Z15'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/members/:token/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: '用户关注 POST endpoint。' }], note: '目标态写入；仅服务端成功后更新 UI。',
  },
  {
    operation: 'follow.person.clear', zIds: ['Z09', 'Z15'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/members/:token/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: '用户取消关注 DELETE endpoint。' }], note: '断线不重试。',
  },
  {
    operation: 'block.person.set', zIds: ['Z07', 'Z09'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/members/:token/actions/block',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PersonViewModel.toggleBlock 使用 POST actions/block。' }], note: '屏蔽是明确目标态写入，网络结果未知时不自动重试。',
  },
  {
    operation: 'block.person.clear', zIds: ['Z07', 'Z09'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/members/:token/actions/block',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PersonViewModel.toggleBlock 使用 DELETE actions/block 取消屏蔽。' }], note: '断线不重试。',
  },
  {
    operation: 'follow.question.set', zIds: ['Z05', 'Z07'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/QuestionFeedViewModel.kt`, note: '问题关注 POST endpoint。' }], note: '目标态写入。',
  },
  {
    operation: 'follow.question.clear', zIds: ['Z05', 'Z07'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/feed/QuestionFeedViewModel.kt`, note: '问题取消关注 DELETE endpoint。' }], note: '断线不重试。',
  },
  {
    operation: 'follow.topic.set', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/topics/:id/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '话题关注 POST endpoint。' }], note: '目标态写入。',
  },
  {
    operation: 'follow.topic.clear', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/topics/:id/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '话题取消关注 DELETE endpoint。' }], note: '断线不重试。',
  },
  {
    operation: 'comment.read', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/comment/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: '通知 deep link 的 anchor_comment_id 需要先读评论详情，并在必要时继续读取 reply_root_comment_id 对应根评论。' }], note: '只读；用于评论通知精准定位，不把自定义 zhihu:// scheme 交给外部 Browser。',
  },
  {
    operation: 'comment.list-root', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/root_comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: '根评论分页入口。' }], note: '只读候选。',
  },
  {
    operation: 'comment.list-child', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/comment/:id/child_comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/ChildCommentViewModel.kt`, note: '子评论分页入口。' }], note: '只读候选。',
  },
  {
    operation: 'comment.create', zIds: ['Z08'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: '评论 body 为 content HTML + optional reply_comment_id。' }], note: '非幂等写；仅在真实账号会话中执行一次，并以响应实体确认成功。',
  },
  {
    operation: 'segment.comment.list-root', zIds: ['Z08'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/segment/root_comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: 'SegmentCommentHolder.rootCommentUrl 使用 segment_id + limit=20 + offset 分页。' }], note: '段评根评论只读分页；segment_id 来自详情 segment_infos。',
  },
  {
    operation: 'segment.comment.create', zIds: ['Z08'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/segment/comment',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/RootCommentViewModel.kt`, note: 'SegmentCommentHolder.buildSubmitCommentBody 包含 segment.content 与 start/end paragraph_id/offset。' }], note: '非幂等段评写入；服务端返回评论实体后才更新 UI。',
  },
  {
    operation: 'segment.like.set', zIds: ['Z08'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/reaction/:type/:id/segment_reaction',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/components/SegmentHighlight.kt`, note: 'toggleSegmentLike POST signed；body 为 optional seg_id + content + position。' }], note: '服务端可能 204，或返回 payload.segId 更新段落 reaction ids。',
  },
  {
    operation: 'segment.like.clear', zIds: ['Z08'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/reaction/:type/:id/segment_reaction',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/components/SegmentHighlight.kt`, note: '取消段落点赞 DELETE signed；body 为 seg_ids。' }], note: '目标态写；断线不重试。',
  },
  {
    operation: 'comment.like.set', zIds: ['Z08'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comments/:id/like',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/BaseCommentViewModel.kt`, note: 'POST 点赞评论。' }], note: '只在服务端成功后更新本地状态。',
  },
  {
    operation: 'comment.like.clear', zIds: ['Z08'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comments/:id/like',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/BaseCommentViewModel.kt`, note: 'DELETE 取消评论点赞。' }], note: '目标状态操作；断线不重试。',
  },
  {
    operation: 'comment.delete', zIds: ['Z08'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/comment_v5/comment/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/comment/BaseCommentViewModel.kt`, note: '仅 can_delete 评论显示删除。' }], note: '服务端成功后才从列表移除。',
  },
  {
    operation: 'comment.update', zIds: ['Z08'], status: 'blocked', method: 'PATCH', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未定位到可靠编辑协议；不能用删后重发冒充编辑。',
  },
  {
    operation: 'people.read', zIds: ['Z09', 'Z15'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://api.zhihu.com/people/:token',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PersonViewModel.load 使用 api.zhihu.com/people/:token，并读取 follower/following/is_following/is_blocking 等资料。' }], note: '公开资料只读候选；登录会话存在时可同时获得当前账号关系状态。',
  },
  {
    operation: 'people.content', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/:contentKind',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: '回答/文章/问题/想法等用户内容分页入口。' }], note: '仅开放公开内容分类；收藏/关注关系另走私有能力。',
  },
  {
    operation: 'people.activities', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v3/moments/:token/activities',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleActivitiesViewModel 初始 URL。' }], note: '公开动态候选；未知卡片按现有异构 feed 解码规则跳过。',
  },
  {
    operation: 'people.followers', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://api.zhihu.com/people/:id/followers',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowersViewModel 使用 people/:id/followers。' }], note: '用户粉丝分页。',
  },
  {
    operation: 'people.following', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/followees',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowingViewModel 使用 members/:token/followees。' }], note: '用户关注的人分页。',
  },
  {
    operation: 'people.following-questions', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/following-questions',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowingQuestionsViewModel。' }], note: '关注的问题分页。',
  },
  {
    operation: 'people.following-topics', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/following-topic-contributions',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowingTopicsViewModel。' }], note: '关注的话题分页。',
  },
  {
    operation: 'people.columns', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/column-contributions',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleColumnContributionsViewModel 使用 members/:token/column-contributions，include=data[*].articles_count,followers,author。' }], note: '用户专栏贡献分页；参考客户端点击专栏时打开一方 Zhihu Web URL。',
  },
  {
    operation: 'people.following-columns', zIds: ['Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/following-columns',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowingColumnsViewModel 使用 members/:token/following-columns，include=data[*].articles_count,followers,author。' }], note: '用户关注的专栏分页；保持参考实现的 Web 打开语义。',
  },
  {
    operation: 'people.collections', zIds: ['Z09', 'Z10'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/favlists',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleCollectionsViewModel 使用 members/:token/favlists，并在列表项进入 CollectionContent。' }], note: '公开用户收藏夹分页；私密条目仍由上游权限决定。',
  },
  {
    operation: 'people.following-collections', zIds: ['Z09', 'Z10'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/members/:token/following-favlists',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PeopleScreen.kt`, note: 'PeopleFollowingCollectionsViewModel 使用 members/:token/following-favlists。' }], note: '用户关注的公开收藏夹分页。',
  },
  {
    operation: 'topic.read', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v5.1/topics/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '话题详情参考实现。' }], note: '公开话题资料只读候选。',
  },
  {
    operation: 'topic.feed', zIds: ['Z04', 'Z09'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v5.1/topics/:id/feeds/:mode',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/TopicScreen.kt`, note: '精华/热门/时间线/想法/待回答分页入口。' }], note: '默认只读热门讨论；其他筛选按源码证据逐步开放。',
  },
  {
    operation: 'collection.list', zIds: ['Z10', 'Z15'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/people/:urlToken/collections',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionsViewModel.kt`, note: '当前账号/用户收藏夹分页入口。' }], note: '私有数据，登录前不请求。',
  },
  {
    operation: 'collection.content-list', zIds: ['Z10'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/collections/contents/:contentType/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/ArticleViewModel.kt`, note: '列出内容可加入的收藏夹及 is_favorited 状态。' }], note: '仅当前账号作用域。',
  },
  {
    operation: 'collection.read', zIds: ['Z10'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/collections/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionContentViewModel.kt`, note: 'fetchCollection() 从 collection 字段读取收藏夹元数据。' }], note: '公开收藏夹允许匿名读取；私密收藏夹由知乎权限返回决定。',
  },
  {
    operation: 'collection.items', zIds: ['Z10'], status: 'source-only', method: 'GET', auth: 'optional', retry: 'safe-read', endpoint: 'https://www.zhihu.com/api/v4/collections/:id/items',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionContentViewModel.kt`, note: 'CollectionContentViewModel 使用 /items 与 paging.next 分页。' }], note: '收藏内容按上游 paging.next 翻页。',
  },
  {
    operation: 'collection.create', zIds: ['Z10'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/collections',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionsViewModel.kt`, note: '创建收藏夹 JSON body 与 status/collection.id 成功条件。' }], note: '非幂等；断线不自动重试。',
  },
  {
    operation: 'collection.delete', zIds: ['Z10'], status: 'source-only', method: 'DELETE', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/collections/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/CollectionsViewModel.kt`, note: '删除非默认收藏夹，响应 success=true。' }], note: '服务端确认后移除。',
  },
  {
    operation: 'collection.membership', zIds: ['Z10'], status: 'source-only', method: 'PUT', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/collections/contents/:contentType/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/ArticleViewModel.kt`, note: 'account HttpClient 直接 PUT application/x-www-form-urlencoded add_collections/remove_collections，不走 postSigned。' }], note: '目标态写入；显式使用已登录 Cookie，但不附加 Web ZSE96。',
  },
  {
    operation: 'draft.answer.save', zIds: ['Z11', 'Z12'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/questions/:id/draft',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuAnswerPublisher.kt`, note: '参考回答草稿写入。' }], note: '没有远端列表/详情/删除闭环，禁止假造草稿箱。',
  },
  {
    operation: 'answer.relationship', zIds: ['Z12'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/questions/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/WriteAnswerScreen.kt`, note: '发布前读取 relationship.my_answer，避免误建重复回答。' }], note: '只读取本人已有回答关系。',
  },
  {
    operation: 'draft.remote.list', zIds: ['Z11'], status: 'blocked', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: null,
    evidence: [], note: '参考代码未形成可靠远端草稿箱列表协议证据。',
  },
  {
    operation: 'answer.publish', zIds: ['Z12'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/content/publish',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuAnswerPublisher.kt`, note: '参考发布入口。' }], note: '发布超时也不能自动重试；未授权验证前 UI 禁用。',
  },
  {
    operation: 'answer.delete', zIds: ['Z12'], status: 'blocked', method: 'DELETE', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '没有完整删除闭环证据。',
  },
  {
    operation: 'draft.pin.save', zIds: ['Z11', 'Z13'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/content/drafts',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/WritePinScreen.kt`, note: '想法草稿保存使用 action=pin。' }], note: '非幂等；本地先保存后再尝试远端。',
  },
  {
    operation: 'pin.topic.recommend', zIds: ['Z13'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/content/publish/topics/recommend',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/WritePinScreen.kt`, note: '输入话题关键字时 postSigned 到 topics/recommend，body 为 title + content。' },
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuPinPublisher.kt`, note: 'PinTopicSuggestionResponse 与发布 topic.topics 结构。' },
    ], note: '只读语义的推荐请求，但协议方法为 POST；不自动重发，由编辑器防抖触发。',
  },
  {
    operation: 'pin.publish', zIds: ['Z13'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://www.zhihu.com/api/v4/content/publish',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/WritePinScreen.kt`, note: '想法发布使用 content/publish + action=pin。' }], note: '发布超时进入 unknown，不自动重试。',
  },
  {
    operation: 'article.publish', zIds: ['Z13'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未形成文章创作完整协议闭环。',
  },
  {
    operation: 'question.publish', zIds: ['Z13'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '未形成提问/问题编辑完整协议闭环。',
  },
  {
    operation: 'image.upload', zIds: ['Z14'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/images',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuImageUpload.kt`, note: '申请 image_id + 临时 OSS upload token。' }], note: '请求只含 image_hash/source；临时 OSS 凭据不持久化。',
  },
  {
    operation: 'image.oss.put', zIds: ['Z14'], status: 'source-only', method: 'PUT', auth: 'required', retry: 'never', endpoint: 'https://zhihu-pics-upload.zhimg.com/v2-:md5',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuImageUpload.kt`, note: '非 GIF 使用 OSS 临时 token + HMAC-SHA1 单 PUT；GIF 使用 multipart。' }], note: '二进制传输由原生 HTTP base64 channel 解码成原始字节，不携带知乎 Cookie。',
  },
  {
    operation: 'image.status.set', zIds: ['Z14'], status: 'source-only', method: 'PUT', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/images/:id/uploading_status',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuImageUpload.kt`, note: 'OSS 完成后提交 upload_result=success。' }], note: '只在 OSS 2xx 后调用。',
  },
  {
    operation: 'image.status.get', zIds: ['Z14'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/images/:id',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/editor/ZhihuImageUpload.kt`, note: '轮询直到 status=success，读取 src/original_src/watermark_src。' }], note: '只读轮询允许安全重试。',
  },
  {
    operation: 'video.upload', zIds: ['Z14'], status: 'blocked', method: 'POST', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '仅找到播放取源，没有可靠视频上传协议。',
  },
  {
    operation: 'profile.update', zIds: ['Z15'], status: 'blocked', method: 'PATCH', auth: 'required', retry: 'never', endpoint: null,
    evidence: [], note: '资料修改缺少完整证据。',
  },
  {
    operation: 'notification.list', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/notifications/v3/message/v3',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: 'NotificationViewModel overview 使用 message/v3，返回 head/column_head/unread/data/paging。' }], note: '通知总览、邀请回答入口及消息会话；unread.message.count 是消息页总未读，不等同于私信未读。账号私有，不进入公共缓存。',
  },
  {
    operation: 'notification.timeline', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/notifications/v3/timeline/entry/:entry',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: 'NotificationTimelineViewModel 按 comment/like/favlist_me/follow/invite entry 分页；invite 首屏增加 invite_with_time_slice=1。' }], note: '分类通知与邀请回答时间线；paging.next 必须经过知乎域白名单。',
  },
  {
    operation: 'notification.readall', zIds: ['Z16'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/notifications/v3/timeline/entry/:entry/actions/readall',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: 'comment/like/favlist_me/follow 分类 readall。' }], note: '显式用户操作；成功后才清本地未读。',
  },
  {
    operation: 'message.list', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/messages',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/ui/PrivateMessageScreen.kt`, note: '私信列表/会话参考实现。' }], note: '账号私有，不进入 Cloud Sync。',
  },
  {
    operation: 'message.peer', zIds: ['Z16'], status: 'source-only', method: 'GET', auth: 'required', retry: 'safe-read', endpoint: 'https://api.zhihu.com/messages/user/:peerId',
    evidence: [{ kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: '会话页并行读取 peer 资料。' }], note: '账号私有，不缓存到公共域。',
  },
  {
    operation: 'message.send', zIds: ['Z16'], status: 'source-only', method: 'POST', auth: 'required', retry: 'never', endpoint: 'https://api.zhihu.com/messages',
    evidence: [
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/viewmodel/NotificationViewModel.kt`, note: 'PrivateMessageViewModel 使用 api.zhihu.com/messages、101_1_1.0、form-url-encoded 明文和本地消息体加密。' },
      { kind: 'source', path: `${REF}shared/src/commonMain/kotlin/com/github/zly2006/zhihu/util/ZhihuMessageBodyEncryptor.kt`, note: '消息体加密协议与官方 Android 11.3.0 请求向量一致。' },
      { kind: 'local-test', path: 'scripts/zhihu-message.test.ts', note: 'NewsNook 固定加密向量与单次 POST 行为测试；结果未知时绝不自动重发。' },
    ], note: 'Android 消息协议；非幂等发送只调用一次，只有服务端返回可解码消息实体才视为成功。',
  },
  {
    operation: 'bridge.article', zIds: ['Z17'], status: 'blocked', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [], note: '由 NewsNook 本地 Article/分享桥接测试提升，不依赖远端写协议。',
  },
  {
    operation: 'workspace.behavior', zIds: ['Z18'], status: 'blocked', method: 'LOCAL', auth: 'local-only', retry: 'never', endpoint: null,
    evidence: [], note: '由导航/主题/返回栈/双变体测试逐项证明。',
  },
] as const satisfies readonly ZhihuOperationContract[]

const ZHIHU_OPERATION_BY_NAME = new Map<string, ZhihuOperationContract>(
  ZHIHU_OPERATIONS.map((item) => [item.operation, item]),
)

export function zhihuOperation(operation: string): ZhihuOperationContract | undefined {
  return ZHIHU_OPERATION_BY_NAME.get(operation)
}

/** 证据层：只有带 live 证据的能力才叫 verified；用于协议审计与发布清单。 */
export function isZhihuOperationEnabled(operation: string): boolean {
  const contract = zhihuOperation(operation)
  return contract?.status === 'verified'
}

/**
 * 执行层：Android 允许尝试已经有明确 endpoint 与完整本地实现的 source-only 操作。
 * 这不会把它们伪装成 verified；真实上游拒绝/变更必须原样作为失败返回。blocked、
 * upstream-unsupported 以及只有“存在某功能”但没有 endpoint 的操作仍不可执行。
 */
export function canExecuteZhihuOperation(operation: string): boolean {
  const contract = zhihuOperation(operation)
  if (!contract || !contract.endpoint) return false
  return contract.status === 'verified' || contract.status === 'source-only'
}

/** source-only GET 可以作为显式只读尝试。 */
export function canAttemptZhihuRead(operation: string): boolean {
  const contract = zhihuOperation(operation)
  if (!contract || contract.method !== 'GET') return false
  return contract.status === 'verified' || contract.status === 'source-only'
}
