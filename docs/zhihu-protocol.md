# 知乎站点协议证据矩阵

更新时间：2026-09-18

本文件记录 NewsNook 知乎适配所依赖的**协议事实与证据等级**。它不是接口可用性承诺。
参考仓库为公开的 `zly2006/zhihu-plus-plus`（AGPL-3.0-only）；运行时证据统一固定到审计 commit `313541192b925028f23410d61b959e6837534c24`，不依赖 `.gitignore` 下的本地 `third-party/` 克隆，也不引用会漂移的 `master`。NewsNook 仅参考公开可观察的协议事实、交互和脱敏响应形状，自行实现，不复制其实现代码或素材。

## 证据等级

| 状态 | 含义 | 产品规则 |
|---|---|---|
| `source-only` | 在参考源码或其脱敏真实响应语料中找到过实现/字段 | 只读 GET 可作为显式受限能力尝试；不能等同“2026-09-15 实网已验证” |
| `verified` | NewsNook 使用明确授权的测试会话完成请求、结构校验及必要的读回/恢复 | 才能作为已验证能力开放；写操作仍必须 `retry=never`，除非单独证明幂等 |
| `upstream-unsupported` | 已通过可重复观察证明上游不存在/拒绝该动作 | UI 明确说明上游限制，不做替代性假操作 |
| `blocked` | 缺协议、缺权限或缺闭环证据 | 禁用入口或显示“待验证”；不能返回假成功 |

当前仓库**没有用户授权的知乎实网登录/写入会话**，因此本轮没有任何远端操作被标为 `verified`。这是一条有意的安全边界，不是遗漏。

## 操作矩阵

运行时权威定义位于 `src/features/zhihu/protocol.ts`；当前 contract 共 80 个 operation，`npm run test:zhihu-protocol` 会检查 Z01–Z18 覆盖、证据路径、fixture 元数据、verified 必须具备 live 证据，以及 blocked 操作不能穿透 API gate。`source-only` 仍不等于线上已验证；有明确 endpoint 的实现可受控尝试并以真实上游结果决定成功/失败。下表是人工审查的关键摘要，不替代运行时完整矩阵。

| 操作 | Z | 方法 | 认证 | 状态 | Endpoint / 结论 |
|---|---|---:|---|---|---|
| `session.login` | Z01 | POST | guest | source-only | 登录/挑战参数仍需授权实网核对 |
| `session.switch-account` | Z01 | LOCAL | local | source-only | 纯本地账号切换已实现，generation 栅栏有行为测试；不等同远端 live verified |
| `feed.recommended` | Z02/Z03 | GET | optional | source-only | `https://api.zhihu.com/topstory/recommend` |
| `feed.hot` | Z02 | GET | optional | source-only | `/api/v3/feed/topstory/hot-lists/total` |
| `feed.following` | Z02 | GET | required | source-only | `api.zhihu.com/moments_v3`，精确关注语义待证 |
| `feed.lastread.touch` | Z02/Z03 | POST | required | source-only | `www.zhihu.com/lastread/touch`；Smart 推荐批量回传曝光 `touch` / 打开 `read`，best-effort、`retry=never`，失败不阻断阅读 |
| `search.query` | Z04 | GET | optional | source-only | `/api/v4/search_v3` |
| `question.read` | Z05/Z06 | GET | optional | source-only | `/api/v4/questions/:id` |
| `question.answers` | Z05 | GET | optional | source-only | `/api/v4/questions/:id/feeds`，排序与翻页只跟随校验后的服务端 next URL |
| `answer.read` | Z05/Z06/Z17 | GET | optional | source-only | `/api/v4/answers/:id` |
| `article.read` | Z06/Z17 | GET | optional | source-only | `/api/v4/articles/:id` |
| `pin.read` | Z06/Z17 | GET | optional | source-only | `/api/v4/pins/:id` |
| `vote.set` | Z07 | POST | required | source-only | `/:contentType/:id/voters`；未验证写回，禁用 |
| `comment.read` | Z08 | GET | optional | source-only | `/api/v4/comment_v5/comment/:id`；用于通知 `anchor_comment_id` 精准定位根/子评论 |
| `comment.list-root` | Z08 | GET | optional | source-only | `/api/v4/comment_v5/:type/:id/root_comment` |
| `comment.list-child` | Z08 | GET | optional | source-only | `/api/v4/comment_v5/comment/:id/child_comment` |
| `comment.create` | Z08 | POST | required | source-only | 评论发送；未验证写回，禁用 |
| `comment.update` | Z08 | PATCH | required | blocked | 未定位可靠编辑协议；禁止删后重发冒充编辑 |
| `people.read` | Z09/Z15 | GET | optional | source-only | `https://api.zhihu.com/people/:token` |
| `people.content` | Z09 | GET | optional | source-only | `/api/v4/members/:token/:contentKind` |
| `people.followers` / `people.following` | Z09 | GET | optional | source-only | 粉丝、关注用户分页；next URL 必须通过知乎域白名单 |
| `people.following-questions` / `people.following-topics` | Z09 | GET | optional | source-only | 用户关注问题/话题分页 |
| `people.collections` / `people.following-collections` | Z09/Z10 | GET | optional | source-only | 用户创建/关注的公开收藏夹分页 |
| `topic.read` | Z04/Z09 | GET | optional | source-only | `/api/v5.1/topics/:id` |
| `topic.feed` | Z04/Z09 | GET | optional | source-only | `/api/v5.1/topics/:id/feeds/:mode` |
| `collection.list` | Z10/Z15 | GET | required | source-only | `/api/v4/people/:urlToken/collections`，当前账号收藏夹 |
| `collection.read` / `collection.items` | Z10 | GET | optional | source-only | `/api/v4/collections/:id` 与 `/items`；公开收藏夹可匿名尝试读取 |
| `collection.create` / `collection.delete` / `collection.membership` | Z10 | POST/DELETE/PUT | required | source-only | 有源码证据但未授权实网写回，运行时 mutation gate 关闭 |
| `draft.answer.save` | Z11/Z12 | POST | required | source-only | `/api/v4/questions/:id/draft`；没有草稿箱完整 CRUD |
| `draft.remote.list` | Z11 | GET | required | blocked | 缺可靠远端草稿箱列表/详情/删除闭环 |
| `answer.publish` | Z12 | POST | required | source-only | `/api/v4/content/publish`；超时禁止自动重试 |
| `answer.delete` | Z12 | DELETE | required | blocked | 缺删除闭环证据 |
| `pin.publish` | Z13 | POST | required | source-only | `api.zhihu.com/content/drafts`；字段/状态待验证 |
| `article.publish` | Z13 | POST | required | blocked | 缺文章创作完整协议闭环 |
| `question.publish` | Z13 | POST | required | blocked | 缺提问/问题编辑完整协议闭环 |
| `image.upload` | Z14 | POST | required | source-only | `api.zhihu.com/images`；上传域隔离待设备验证 |
| `video.upload` | Z14 | POST | required | blocked | 只找到播放取源，未找到可靠视频上传协议 |
| `profile.update` | Z15 | PATCH | required | blocked | 资料修改缺完整证据 |
| `notification.list` | Z16 | GET | required | source-only | `api.zhihu.com/notifications/v3/message/v3`，总览与分类未读数 |
| `notification.timeline` | Z16 | GET | required | source-only | `api.zhihu.com/notifications/v3/timeline/entry/:entry` |
| `notification.readall` | Z16 | POST | required | source-only | 分类全部已读；未授权验证前 UI/API 双层禁用 |
| `message.list` | Z16 | GET | required | source-only | `api.zhihu.com/messages`；账号私有 |
| `message.peer` | Z16 | GET | required | source-only | `api.zhihu.com/messages/user/:peerId`；账号私有 |
| `message.send` | Z16 | POST | required | source-only | 未授权写入/读回，禁用；生产树不携带从 AGPL 参考实现抽取的白盒私信协议表 |
| `bridge.article` | Z17 | LOCAL | local | blocked | 由 NewsNook Article/分享桥接行为测试提升 |
| `workspace.behavior` | Z18 | LOCAL | local | blocked | 由主题/返回栈/双变体集成验收提升 |

## 已纳入的脱敏结构样本

`scripts/fixtures/zhihu/` 中的 `*.source.json` 是**结构化重建 fixture**：字段来源于参考仓库的脱敏真实响应语料，但值全部重新虚构，不复制真实用户正文、昵称、头像或私有数据。它们只允许证明 decoder 对已知结构有回归保护，不能把操作升级为 `verified`。

- `answer.read.source.json`：回答 id/content/question/author 的最小结构。
- `feed.recommended.source.json`：推荐卡片 `data/target/paging` 的最小结构。
- `search.query.source.json`：搜索结果 `data/object/paging` 的最小结构。

参考证据分别来自：

- `shared/src/jvmTest/resources/real-api/answer-detail.json`
- `shared/src/jvmTest/resources/real-api/mobile-home-card.json`
- `shared/src/jvmTest/resources/search/search-general-sanitized.json`

## 实网提升规则

把远端操作从 `source-only` 提升为 `verified` 时，必须同时满足：

1. 使用明确授权的测试账号/目标，不自动发布公开内容、关注他人或发送私信。
2. 记录日期、平台、应用变体、请求方法/路径、认证方式和脱敏响应结构；不得记录 Cookie、token、验证码或私信正文。
3. 读操作至少验证响应实体类型/id；写操作必须“写入 → 读回 → 必要时恢复/删除”。HTTP 200 本身不算成功。
4. 验证 401/403/验证页/限流/错误 JSON，确保不会被 decoder 当作空列表。
5. 非幂等写默认 `retry=never`；发布、评论、私信超时不能自动重发。
6. `verified` 行必须在 `protocol.ts` 中附 `kind: 'live'` 证据，并补脱敏 fixture；`test:zhihu-protocol` 会拒绝没有 live 证据的 verified 状态。

### 2026-09-15 本轮公开读探针

开发工作区对 `hot` 与 `recommended` 两个匿名 GET 做了仅输出 HTTP/结构元数据的探针；两次都在连接层返回 `fetch failed`，没有取得 HTTP 状态码。由于这不能区分开发机出站网络限制与上游接口状态，本轮**没有**据此把任何操作升级或降级：相关操作继续保持 `source-only`，等待 Android/Web 目标运行时上的授权/可重复实网验收。

## 平台边界

- Android 才是完整认证能力目标平台；会话与凭据必须经独立原生/安全存储边界，不能进入普通 `newsnook:` localStorage、配置备份或 Cloud Sync。
- 普通 Web 不通过 NewsNook 公共云代理用户 Cookie。没有用户侧桥时只提供本地数据与可匿名尝试的公开 GET，并明确显示受限原因。
- `zhihu-daily` / `kind: 'zhihu'` 继续表示知乎日报；社区适配使用独立站点/来源标识，不复用日报解析器。
