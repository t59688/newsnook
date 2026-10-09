# 知乎站点适配实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本任务没有授权自动启动子代理；默认在当前任务逐项执行。

**Goal:** 在 NewsNook 内交付覆盖信息流、推荐、阅读、评论、个人、草稿、编辑和内容管理的完整 Android 知乎站点适配。

**Architecture:** 在“切换布局 → 第三方站点”增加知乎选项，选中直接挂载知乎专属完整布局；业务通过账号作用域服务访问原生 transport。复用主题、媒体、公共阅读基础设施，知乎凭据和私有数据保持独立。

**Tech Stack:** React 19、TypeScript、Tailwind v4、Capacitor 8、原生 HTTP/现有代理、IndexedDB；编辑器候选 Tiptap/ProseMirror，实际引入前完成兼容与依赖核对。

**Spec:** [设计与源码证据](../specs/2026-09-15-zhihu-site-integration-design.md)。实施前读取该文档，尤其 Z01–Z18 与平台边界。

## Global Constraints

- 完整原生能力的验收平台是 Android `cloud` 与 `local` 两个变体。
- 用户明确的主入口是“切换布局 → 第三方站点 → 知乎”；进入完整知乎自定义 UI，不进入首页信源、分类或通用新闻列表，不经过通用站点目录页。
- 知乎布局拥有自己的顶栏和主导航；新闻预设与站点布局分别保存，选择知乎不调用 `presets.applyPreset`。
- 不改变 `kind: 'zhihu'` / `zhihu-daily` 的日报含义，不改变现有存储数据形状。
- 推荐只在知乎工作区内启用，不改变速闻排序与 NewsNook 全局画像。
- UI 不拼上游 URL；静态站点描述从 `src/sources/registry.ts` 聚合导出。
- 知乎 Cookie/token 不进入自建源配置、普通 localStorage、配置备份或 Cloud Sync。
- 本地草稿不进入正文 LRU，清缓存不能删草稿；写操作未确认不能显示成功。
- 新生产依赖必须说明原因；不引入路由库或全局状态库。
- 普通 Web 的完整认证能力不是已解决事项；要求同等完整时执行任务 10 的用户侧桥接工作包。
- 本轮只是设计；下面的文件、接口、测试与命令标为“新增”的均尚未实现。

## 执行策略

先做协议可行性，再做垂直功能闭环。未知协议不能在计划中凭空填参数；任务 1 的输出是后续 service 实现的输入契约。任务 6–8 在协议矩阵未确认时，不具备声称完整的条件。

每个任务流程：写行为测试 → 运行并确认预期失败 → 实现 → 同一测试通过 → 必要既有回归 → 审查 diff。提交按用户当前 Git 工作方式进行；此计划不自动授权推送或发布。

下文测试片段是关键行为的具体示例，其余同任务验收场景必须落实成测试/设备记录。不是可整文件复制的完整实现；不把未知线上行为伪装成确定代码。

## 任务 1：建立操作证据与脱敏样本（P0，覆盖 Z01–Z18）

**Files:**

- 新增 `docs/zhihu-protocol.md`：逐操作方法、路径、认证模式、请求字段、成功/错误响应、分页、权限、日期与证据。
- 新增 `scripts/fixtures/zhihu/`：按操作命名的匿名/已登录成功与失败样本，不含真实 Cookie、token、私信或草稿正文。
- 新增 `scripts/zhihu-protocol.test.ts`，修改 `package.json` 增加 `test:zhihu-protocol`。

**输入/输出：** 输入参考代码及用户授权测试会话；输出经确认的 operation contract 与 fixtures。每个操作以 `entity.action` 稳定命名，例如 `answer.read`、`answer.publish`、`draft.list`。

- [ ] 把设计 Z01–Z18 拆为逐动作行，每行区分 `source-only / verified / upstream-unsupported / blocked`，附证据路径。没有验证结果时保留 source-only，不能删除该动作。
- [ ] 先核对 `ZhihuAccountClient`、`WriteAnswerScreen`、`RootCommentViewModel`、`ZhihuImageUpload` 的真实调用字段；通过只读请求验证本人资料和公开正文。
- [ ] 为远端草稿箱列表/详情/删除、文章编辑发布、问题编辑、资料修改、内容删除、视频上传补充上游实际操作证据。官方没有某动作时记录可重复观察结果。
- [ ] 在明确授权的测试目标上验证“写入 → 读回 → 恢复”；本轮分析权限不当作可以发布公开内容的授权。
- [ ] 将 endpoint 输入/输出字段转为本地 fixture 验证；成功响应不能只校验 HTTP 200，需校验 id/状态和内容类型。

示例 fixtures 的最低契约测试：

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const body = JSON.parse(readFileSync(
  'scripts/fixtures/zhihu/answer.read.success.json', 'utf8',
)) as { id?: unknown; content?: unknown }
assert.equal(typeof body.id, 'string') // 脱敏夹具标准化 ID，保留原字段类型证据在协议文档
assert.equal(typeof body.content, 'string')
assert.ok(body.content.length > 0)
```

**验收：** 能列出每项真实可用性、上游权限和平台差异。缺 fixture 时测试必须失败；不能补假 JSON 就标 verified。许可证核对形成记录；默认自行实现，不拷贝第三方代码。

## 任务 2：宿主、模型、返回栈与来源注册（P1，Z05/Z17/Z18）

**Files:**

- 新增 `src/sources/registry/sites.ts`、`src/features/sites/types.ts`。
- 新增 `src/features/zhihu/types.ts`、`navigation.ts`、`ui/ZhihuWorkspace.tsx`。
- 修改 `src/sources/registry.ts`、`registry/model.ts`、`registry/builtinSources.ts`（后两者位于 `src/sources/` 下）、`src/components/PresetSwitcher.tsx`、`src/App.tsx`；按宿主分支实际需要调整 `src/components/AppShell.tsx` 和 `src/screens/SiteScreen.tsx`。
- 新增 `scripts/zhihu-navigation.test.ts` 与对应 npm 脚本。

**接口：** 静态站点描述包含 id、name、origin、adapterId；工作区宿主接受返回回调和既有主题/阅读依赖。导航保持 feature 内状态。

`PresetSwitcher` 增加类型化站点选项列表与 `onSelectSite(siteId)`，不把知乎伪装为普通 `PresetSwitcherItem` 后调用 `onSelect`。知乎工作区顶栏也能打开同一布局选择器；当前激活状态在新闻场景和站点选项之间保持互斥。

```ts
export type ZhihuEntityKind =
  | 'question' | 'answer' | 'article' | 'pin' | 'people' | 'collection' | 'comment'
export interface ZhihuEntityRef { kind: ZhihuEntityKind; id: string }
export interface Page<T> { items: T[]; nextCursor?: string; hasMore: boolean }
export type ZhihuRoute =
  | { screen: 'feed'; mode: 'following' | 'recommended' | 'hot' }
  | { screen: 'entity'; ref: ZhihuEntityRef }
  | { screen: 'editor'; localDraftId: string }
  | { screen: 'notifications' }
  | { screen: 'conversation'; peerId: string }
export interface RouteFrame { route: ZhihuRoute; anchor?: string; scrollTop: number }
export type RouteAction = { type: 'push'; frame: RouteFrame } | { type: 'back' }
// navigation.ts 输出 reduceRoutes(frames: RouteFrame[], action: RouteAction): RouteFrame[]
```

- [ ] 写“评论进入用户页再返回，原锚点/scrollTop 不变”的 reducer 测试，覆盖空栈与重复目标语义。
- [ ] 在 PresetSwitcher 的“第三方站点”分组加入“知乎”，选中后直接挂载 ZhihuWorkspace。检查 App 两处站点配置，即使 CMS 数量为零也展示知乎选项，不通过 `onSites → SiteScreen` 中转知乎入口。
- [ ] 定义与新闻预设独立的布局状态；选择知乎不调用 presets.applyPreset、不修改启用信源与分类、不进入 FeedScreen。普通 CMS 站点继续走既有布局分支。
- [ ] 知乎工作区挂载自己的顶栏/导航与业务页面，继承全局主题；普通新闻布局的底栏/分类条不叠加显示。知乎顶栏保留切换布局入口，名称和选中态显示“知乎”。
- [ ] 编写布局切换行为测试：零 CMS 时选项可见；点击一次直达知乎；原预设和信源完全不变；离开前保存草稿；切回普通布局恢复原位置；再次进入知乎恢复其内部上下文。
- [ ] 注册独立 `zhihu-community` 公开阅读来源，默认不进入综合刷新；保留日报 kind。实现来源查找与站点宿主的关系，公共分享接收端可通过 sourceId 找到适配器。
- [ ] 工作区 lazy load；把系统返回入口接到 App 既有机制，先处理顶层 overlay，再弹 route；知乎根页返回恢复之前的布局，不跳到未访问的通用站点目录页。
- [ ] 确保日报仍按旧 sourceId/kind 浏览，`SiteScreen` 原 CMS 入口不退化。

```ts
const before: RouteFrame[] = [{ route: { screen: 'entity', ref: { kind: 'answer', id: '1' } }, anchor: 'comment-9', scrollTop: 860 }]
const next = reduceRoutes(before, { type: 'push', frame: { route: { screen: 'entity', ref: { kind: 'people', id: 'u' } }, scrollTop: 0 } })
assert.deepEqual(reduceRoutes(next, { type: 'back' }), before)
```

**验证：** 新增 navigation 行为测试、`npm run test:edge-swipe`、`npm run test:json-feed`、`npm run lint`；设备返回手势检查。

## 任务 3：账号隔离与认证网络（P1，Z01）

**Files:**

- 新增 `src/features/zhihu/session/{types,store,service}.ts`、`transport/{types,android,web}.ts`、`api/{client,endpoints,decode}.ts`、`runtime.ts`。
- 新增 `android/app/src/main/java/com/aizeek/newsnook/ZhihuSessionPlugin.java` 并在 `MainActivity.java` 注册；如现有桥足够，优先组合而不重复实现 HTTP。
- 按实测缺口修改 `ProxiedHttpPlugin.java`；不得扩张公共代理权限。
- 新增 `scripts/zhihu-session.test.ts`、`scripts/zhihu-transport.test.ts` 与脚本。

**接口：** `createZhihuRuntime({ transport, secureStore, database })` 返回账号作用域服务；transport 请求只能在 api 层产生。

```ts
export interface ZhihuRequest {
  operation: string
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: string
  accountId?: string
  generation: number
  retry: 'safe-read' | 'never'
}
export interface ZhihuResponse { status: number; headers: Record<string, string>; body: string }
export interface ZhihuTransport {
  request(input: ZhihuRequest, signal?: AbortSignal): Promise<ZhihuResponse>
}
```

- [ ] 使用 delayed fake transport 编写切换账号后旧响应不能更新状态的测试；记录实际调用次数验证发布超时不重试。
- [ ] 完成受控登录/验证码返回、Cookie 与 HTTP jar 同步、本人资料校验、原生安全存储和退出。
- [ ] 加认证域与重定向校验；读请求刷新 single-flight；写请求按协议证据决定重试，默认 never。
- [ ] 对齐源 JSON 序列化和签名 bytes；用脱敏固定向量验证，不输出密钥与完整请求头。
- [ ] Web adapter 返回结构化能力限制，UI 能读本地草稿，不把功能失败伪装空列表。

**验收：** 两个账号切换/重启/退出无 Cookie 与缓存串号；离线可进入原有 NewsNook；日志、配置备份及同步投影无知乎凭据。

**验证：** 新增 session/transport 测试，`npm run test:proxy`、`npm run test:account-auth`、`npm run test:secure-secret-hydration`，两变体设备登录。不要用 mock 登录替代后者。

## 任务 4：读取、分页和搜索（P2，Z02/Z04/Z05/Z09）

**Files:**

- 新增 `src/features/zhihu/feed/{service,useZhihuFeed}.ts`、`content/service.ts`、`people/service.ts`。
- 新增 `ui/{ZhihuFeedScreen,ZhihuQuestionScreen,ZhihuSearchScreen,ZhihuPeopleScreen,ZhihuTopicScreen}.tsx`。
- 新增 `scripts/zhihu-feed.test.ts`。

**接口：** 各服务以实体 ID 与查询对象为输入、规范实体与 `Page<T>` 为输出；`listFeed(query, cursor, signal)`、`search(query, cursor, signal)` 不暴露原始响应给 UI。原始 endpoint 从任务 1 的操作矩阵实现。

- [ ] 用不同顺序完成的两个查询响应写测试，确认旧查询不会覆盖新查询；分页覆盖重复游标、重叠内容、空页仍有 next、单页错误可重试。
- [ ] 实现推荐/关注/热榜的独立查询键、游标和刷新 generation；按上游顺序显示，不按 Article.publishedAt 重排。
- [ ] 实现问题排序与回答列表；搜索分类/筛选；用户资料及内容分类；话题/专栏站内路由。
- [ ] 首次加载、加载更多、离线缓存、登录要求、解析失败独立呈现；未知卡片记录脱敏类型统计并降级，不让一张卡片破坏整页。

**验收：** 从列表进入问题/作者/话题再返回，原筛选和位置仍在；私有列表按账号隔离；500/验证页不能当 JSON 空列表。

## 任务 5：正文、媒体与本地阅读桥接（P2，Z06/Z17/Z18）

**Files:**

- 新增 `src/features/zhihu/content/{normalize,links}.ts`、`bridge.ts`、`ui/ZhihuContentScreen.tsx`。
- 新增实际共用的 `src/components/ArticleBodyView.tsx`，从 `src/screens/ReaderScreen.tsx` 提取正文/媒体挂载组合。
- 按实际需求修改 `src/lib/resolveBody.ts`、`src/lib/parseFeed.ts`、`src/hooks/useFeeds.ts`、`src/lib/shareLink.ts`、`src/features/comments/service.ts`；公共阅读桥接路径先写测试再改。`src/lib/articleId.ts` 的 `feedArticleId` 直接复用。
- 新增 `scripts/zhihu-content.test.ts`。

**接口：** `toNewsArticle(content)` 仅接公共 answer/article/pin；`parseZhihuLink(url)` 返回实体引用或外链；`resolveVideo(ref, videoId)` 返回现有 `MediaResourceDescriptor`。

- [ ] 正文夹具涵盖懒加载图片、GIF、表格、公式、视频、卡片与内部链接；断言展示 sanitize 不改动供编辑使用的原始正文。
- [ ] 提取媒体组合并保持普通新闻行为；复用 ImageLightbox 单图契约和 InkVideoPlayer 的 requestHeaders/resources/onRefreshSource/fullscreenHandleRef。
- [ ] 实现视频取源与过期刷新；单媒体错误不清空全文；核对跨域 headers 不携带全站 Cookie。
- [ ] 公开正文接入稍后读、阅读位置、缓存与站内分享深链；分享接收端先路由知乎实体，再补正文标题。
- [ ] 领域 id 与 NewsNook Article.id 分开：后者调用 `feedArticleId('zhihu-community', canonicalUrl)`；发出/接收分享必须生成同一 id。新 kind 由明确适配分支处理，不落通用 feed parser，也不把账号推荐流加入全局新闻刷新。
- [ ] 同一公共正文的多个入口使用相同实体 id；私有内容不写入公共缓存和分享卡片。

**验证：** 新增 content 测试；`npm run test:reader-images`、`npm run test:inline-video`、`npm run test:resolve-body`、`npm run test:share-link`、`npm run test:native-fullscreen`；设备验证缩放、全屏返回、媒体刷新与墨水屏。

## 任务 6：评论、关系与收藏闭环（P3，Z07/Z08/Z10）

**Files:**

- 新增 `comments/{types,service,useComments}.ts`、`collections/service.ts`、`storage/operations.ts`（均在 `src/features/zhihu/`）。
- 新增 `ui/{ZhihuCommentsSheet,ZhihuCommentThread,ZhihuCollectionScreen}.tsx`。
- 新增 `scripts/zhihu-comments.test.ts`、`scripts/zhihu-mutations.test.ts`。

**接口：** 评论 service 输出树节点和规范分页；关系操作 `setVote(ref, desired)`、`setFollowing(ref, desired)` 接目标状态。操作结果区分 confirmed/failed/unknown，不把本机 UUID 当服务器幂等键。

- [ ] 编写“发布评论超时仅调用一次、保留输入”的 service 行为测试；删除根/子评论要更新正确的父节点与计数。
- [ ] 实现根/子评论翻页、回复、段落锚点、投票、作者跳转与返回恢复；输入草稿提到抽屉外。
- [ ] 按服务端权限开放删除；评论编辑只在任务 1 有证据时实现，否则记录上游不支持，不以删后重发替代。
- [ ] 收藏夹完整创建/编辑/隐私/删除及内容添加/移除；知乎收藏与本机稍后读独立。
- [ ] 同实体关系缓存跨列表/正文/作者页一致；快速连点按目标状态串行收敛，失败回滚不会覆盖更新的成功状态。

**验证：** 新增评论/mutations 测试，`npm run test:comments`；设备走“评论 → 作者 → 返回原评论”和输入法场景；授权测试数据做 CRUD 并读回。

## 任务 7：本机草稿、远端草稿与完整编辑（P4，Z11/Z12/Z13/Z14）

**Files:**

- 新增 `storage/database.ts`、`editor/{schema,codec,draftStore,upload,service}.ts`。
- 新增 `ui/{ZhihuDraftsScreen,ZhihuEditorScreen}.tsx`。
- 新增 `scripts/zhihu-editor.test.ts`、`scripts/zhihu-drafts.test.ts`，对应脚本。
- 修改 `package.json`/lockfile 引入经验证的编辑器最小包；必要的原生文件上传能力放 `android/.../ZhihuUploadPlugin.java`，注册至 MainActivity。

**接口：** `draftStore.save(snapshot)` 返回已提交 localRevision；`editorService.publish(localDraftId)` 使用固定文档快照及账号；`upload.attach(localDraftId, file)` 维护本地资源引用与远端资源状态。

```ts
export interface DraftSnapshot {
  id: string
  accountId: string
  kind: 'answer' | 'article' | 'pin' | 'question'
  targetId?: string
  remoteDraftId?: string
  localRevision: number
  baseHash?: string
  document: unknown // 持久化边界必须由 editor/schema.ts 的版本化 validator 校验
  updatedAt: number
}
export type PublishResult =
  | { status: 'confirmed'; ref: ZhihuEntityRef }
  | { status: 'failed'; message: string }
  | { status: 'unknown'; operationId: string }
```

- [ ] 先写复杂 editable HTML 往返测试：段落、图片、表格、公式、视频、卡片、未知块；断言未知块仍在，已编辑文字生效。
- [ ] 先做小范围编辑器兼容验证：React 19、Android 中文输入、长文选择/撤销/键盘布局与 bundle 体积，再锁定版本；说明新增生产依赖原因。
- [ ] 实现 IndexedDB 版本化 schema/事务和 draft/blob stores；检查 quota 错误真实传到 UI，不错误显示“已保存”。
- [ ] 实现草稿本机保存/恢复/复制/删除与远端列表/恢复/保存/删除；远端缺数据不删除本机，冲突保留副本。
- [ ] 实现图片上传申请/传输/处理确认；视频上传依任务 1 的协议契约完成，未完成资源阻止发布并可重试/移除。
- [ ] 先保存本机，再写远端草稿，最后显式发布；回答检测本人已有回答防误创建，文章/想法/问题各自 payload codec。
- [ ] 以 fixed snapshot 发布并读回；提交期间继续编辑的新 revision 不被旧成功响应删除。超时记录 unknown，重新查询确认，禁止自动重发。
- [ ] 已发布内容编辑与本人内容删除接入实际权限；恢复、回收站等仅按真实上游能力提供，不虚构可撤销承诺。

关键测试示例（在注入超时 transport 的实际 publisher 上断言）：

```ts
const result = await publisher.publish(draft.id)
assert.equal(result.status, 'unknown')
assert.equal(requests.filter(x => x.operation === 'answer.publish').length, 1)
assert.ok(await draftStore.get(draft.id))
```

其中 publisher/draftStore/requests 由测试夹具构造，夹具须调用实际 editorService，不能仅测试手写 mock publisher。

**验收：** 飞行模式写入→后台→杀进程→恢复；切换账号；远端冲突；上传中断；发布超时；内容复杂格式读回；清正文缓存不影响草稿。数据库恢复必须在真实 WebView 验证，Node 测试不代替它。

## 任务 8：个人管理、通知与私信（P3/P4，Z15/Z16）

**Files:**

- 扩展 `people/service.ts`、新增 `notifications/service.ts`。
- 新增 `ui/{ZhihuMeScreen,ZhihuProfileEditor,ZhihuNotificationsScreen,ZhihuConversationScreen}.tsx`。
- 新增 `scripts/zhihu-account-content.test.ts`。

**接口：** 按账号作用域返回作品/本人资料；通知目标规范化为实体或评论锚点；私信发送使用任务 6 的非幂等结果模型。

- [ ] 测试账号切换后未读数/会话/草稿输入隔离；通知重复页去重和标记已读失败不错误清零。
- [ ] 实现本人资料可编辑字段及校验、作品管理、收藏和草稿跳转；按任务 1 确认的权限显示资料修改。
- [ ] 实现通知分类、未读/全部已读、站内定位、私信会话/历史/发送；未知发送结果不自动补发。
- [ ] 退出后清除私有运行时视图，不把私信缓存投影成 Article，不把正文写到日志/锁屏通知。

**验证：** service 测试和授权测试会话互发/读回；拒绝、验证要求、超时、离线、删除会话等以协议支持范围验收。

## 任务 9：推荐模式对齐与全局设计收口（P5，Z03/Z18）

**Files:**

- 新增/完善 `feed/rank.ts`、`storage/cache.ts`、推荐模式 UI。
- 修改 `src/index.css` 中知乎局部必要样式，扩展现有设计 token 的使用而非重建主题。
- 新增 `scripts/zhihu-recommend.test.ts`，完善 `docs/user-guide.md`、`docs/architecture.md`、`AGENTS.md` 的实现入口。

**接口：** 本地排序输入为显式启用模式下的知乎候选及本站点反馈，输出稳定有序引用与理由；混合模式保存两套独立 cursor，合并顺序确定。

- [ ] 测试相同输入输出稳定、账号画像隔离、清空数据、关闭后不采样/不调度；测试混合源一侧失败仍保留另一侧可用结果。
- [ ] 实现上游 Web/移动模式、确定性混合与本地候选排序；从简单可解释特征开始，不引入模型/JNI 必经依赖，两变体能力一致。
- [ ] 本地模式采集范围、前台/后台网络预算由用户可见配置控制；不因参考 TaskScheduler 存在就默默后台抓取。
- [ ] 全量检查 `ink/paper/cinnabar/haze` 的使用、明暗/自定义 scheme、字号、eink、触控、键盘和屏幕阅读标签。
- [ ] 按 Z01–Z18 回填验收结果；差异有具体操作与证据，未解决 C 项仍标阻塞，不算完整。

**验证：** 推荐纯行为测试；`npm run test:theme`、`npm run test:eink`、`npm run test:recommend`、`npm run test:config-backup`、`npm run test:sync-projection`；全功能 `npm run lint`、`npm run build`。最后按 `docs/android-build.md` 构建并验证两变体。

## 任务 10：完整 Web 的独立工作包（只有同等 Web 能力被纳入交付时启动）

**前提：** 用户接受安装用户侧扩展/companion；普通 Web 的限制不能以增加公共 Cloud 依赖默认解决。此工作包未被 Android 完整范围自动包含。

**Files:** 新增独立 `tools/zhihu-web-bridge/` 工程和 `docs/zhihu-web-bridge.md`；实现 `src/features/zhihu/transport/web.ts` 适配协议，不更改公共 `functions/` 为 Cookie 中转。

- [ ] 先验证一种目标浏览器的实际可行性：受限 request headers、Cookie 权限、认证/挑战、视频分片、上传与退出，不假设扩展天然拥有全部能力。
- [ ] 定义配对与 operation 白名单，限定来源、目标域和短期 token，禁止任意跨域请求；业务 payload 和验证沿用任务 1 的版本化契约。
- [ ] 写未配对、错误 origin、过期 token、任意 URL、断连和旧响应的拒绝测试。
- [ ] 接入 transport 并运行任务 3–9 对应浏览器回归；登录/验证码不能由后台静默绕过。
- [ ] 发布说明明确支持的浏览器、安装路径、断开/取消配对和删除本机数据；没有这一执行面时保持 Web 的受限状态提示。

## 最终交付检查

- [ ] Z01–Z18 适用操作有源码/fixture/实网与 UI 验收映射；没有以“入口已做”代替闭环。
- [ ] “切换布局 → 第三方站点 → 知乎”直达完整专属布局；进入/退出不会更改新闻预设、信源和分类，知乎布局没有叠加普通新闻导航。
- [ ] 未登录/Cloud 故障/断网下原新闻阅读回归通过。
- [ ] 日报、CMS 站点、现有评论源、原媒体控件没有语义回归。
- [ ] 草稿、凭据、媒体、已读和稍后读各自存储/同步边界清晰。
- [ ] 全部新代码自行实现或授权记录明确；文档注明真实平台限制。
- [ ] 最终总结分别报告已实现、已测试、未验证事项，不能把计划命令写成测试结果。
