# NewsNook 账户与云同步设计

> 日期：2026-08-27
> 状态：已实现（V1）；实现期的取舍见 §29「实现审查结论」
> 范围：可选账户体系 + 配置/订阅多设备同步

## 1. 背景与产品边界

NewsNook 当前是本地优先、无需账号即可使用的 Android/Web 新闻阅读客户端。现有仓库规范明确把 Backendless、无账号、无云同步列为硬约束。本设计是一次经明确批准的产品边界变更：**新增可选的账户和云同步能力，但不改变本地优先、不登录可用、正文与离线缓存留在本地的产品基础。**

实现本设计时必须同步更新 `AGENTS.md` 与 `docs/architecture.md`，把原先“禁止账号/云同步”的绝对约束改为“云能力可选、核心阅读路径不得依赖云端”。

### 1.1 V1 同步范围

同步：

- 订阅源
- 分类
- 分类与订阅排序
- 启用/禁用状态
- 适合跨设备的应用设置
- 用户 Secret，例如第三方 AI API Key、代理凭据等

V1 不同步：

- 文章正文
- 离线缓存
- 已读/未读状态
- 收藏
- 阅读进度
- 阅读历史

这些非目标未来可以基于同一同步协议扩展，但不应提前为它们增加复杂度。

## 2. 核心产品原则

1. **Local-first**：不登录也能完整使用 NewsNook；所有用户操作先落本地。
2. **云同步是增强能力**：服务端不可成为正常阅读、订阅浏览、正文解析的必经路径。
3. **登录可选**：首次引导介绍跨设备同步并提供登录入口，同时允许跳过；设置页长期保留入口。
4. **首次登录由用户选择数据策略**：使用本机、使用云端、合并，不静默决定。
5. **日常同步自动化**：自动同步 + “立即同步”手动入口，并有明确状态提示。
6. **普通冲突自动解决，高风险冲突才打扰用户**。
7. **设计保持轻量**：V1 不引入 Redis、MQ、Kafka、Kubernetes、Event Sourcing、CRDT 或分布式锁。

## 3. 技术选型

### 3.1 服务端

- TypeScript
- Node.js
- Fastify
- PostgreSQL
- Better Auth

选择 Fastify + PostgreSQL 的原因：与现有 TypeScript 前端技术栈接近，便于共享 DTO/schema，同时配置同步属于轻量 I/O 型服务，不需要为 V1 引入更重的后端框架。

### 3.2 认证

NewsNook 只作为 OAuth/OIDC Client，不作为 OAuth/OIDC Identity Provider。

V1 支持：

- 邮箱 + 密码
- Google 登录
- GitHub 登录

认证协议与 Session 生命周期交给 Better Auth，不自行实现密码认证、OAuth callback、账户映射等安全敏感逻辑。

同邮箱的本地密码账号与第三方身份**不静默合并**；必须经过已登录/已验证账户的显式绑定流程。

## 4. 总体架构

```text
NewsNook Web / Android
  |
  |-- existing local data
  |-- account/
  |-- sync/
  |    |-- SyncEngine
  |    |-- Outbox
  |    |-- Cursor
  |    |-- Merge
  |    |-- ConflictResolver
  |    `-- SyncNotifier
  |
 HTTPS
  |
NewsNook Cloud / Fastify
  |
  |-- auth/        Better Auth
  |-- users/       user/device management
  |-- sync/        push/pull/conflict/revision
  |-- categories/
  |-- subscriptions/
  |-- settings/
  `-- secrets/
       |
    PostgreSQL
```

客户端现有业务模块不得直接依赖云 API。业务修改先写本地，再由 Sync Engine 通过 Outbox 异步上传。

因此断网、服务端故障、未登录都不能阻止本地正常使用。

## 5. 客户端模块边界

新增模块建议：

```text
src/features/account/
  login/session/device identity/platform auth adapter

src/features/sync/
  SyncEngine
  Outbox
  Cursor
  Merge
  ConflictResolver
  SyncNotifier
```

具体目录应在实现阶段结合现有 `features/`、`lib/storage.ts` 与设置页结构确定，不为目录形式本身重构无关代码。

同步写入应通过已有领域存储入口，例如订阅、分类、设置 repository/adapter，而不是在 UI 内直接写 Outbox。

## 6. 首次引导、登录与首次同步

### 6.1 首次引导

新增一个可跳过的同步介绍步骤：

```text
跨设备同步你的 NewsNook

登录后可以同步：
- 订阅源
- 分类与排序
- 应用配置

[登录并开启同步]
[稍后再说]
```

登录不是启动应用的前置条件。

### 6.2 登录方式

登录页提供：

- 邮箱密码
- Google
- GitHub
- 注册
- 忘记密码

### 6.3 第一次登录后的数据决策

认证完成后，客户端先获取本地/云端摘要，不直接自动覆盖。

用户必须选择：

1. **使用本机数据**：先创建本地恢复快照，再把本机同步域作为新的云端基线。
2. **使用云端数据**：先创建本地恢复快照，再以云端状态替换同步范围内的本地数据。
3. **合并数据**：双方保留，订阅去重，普通冲突自动处理，高风险冲突进入 Conflict Queue。

覆盖行为只影响同步域，不影响正文、离线缓存等设备本地内容。

## 7. 日常同步体验

同步触发：

- 用户修改订阅/分类/同步设置后 debounce 触发
- App 启动
- App 恢复到前台
- 网络恢复
- 登录成功
- 用户点击“立即同步”

V1 不使用 WebSocket，也不做固定高频轮询。

状态统一抽象：

```text
idle
syncing
success
offline
error
conflict
authRequired
```

表现：

- Web：Toast + 设置页持久状态
- Android 前台：优先应用内提示
- Android 后台：仅首次同步完成、连续失败、需要处理冲突等重要事件使用系统通知栏
- 普通后台同步成功不发送系统通知

## 8. 同步协议

采用：**结构化记录 + 全局 Revision + Delta Pull + Outbox + Tombstone**。

不采用整份 JSON 覆盖，不采用 Event Sourcing，不采用 CRDT。

### 8.1 可同步实体

核心实体：

```text
categories
subscriptions
user_settings
user_secrets
```

每条记录具有稳定 UUID，UUID 可由客户端离线生成。

同步字段至少包含：

```text
id
user_id
revision
updated_at
deleted_at
```

排序字段使用可插入的 `sort_rank`，避免在中间插入时批量重写大量相邻记录。V1 只需要简单封装 rank 生成与必要时归一化，不引入重型排序系统。

### 8.2 Server Revision

每个用户拥有独立、单调递增的 revision 空间。

客户端时间不能作为同步顺序真相；`updated_at` 主要用于展示和辅助信息。

```text
user A: 1, 2, 3, ...
user B: 1, 2, 3, ...
```

### 8.3 Pull

客户端维护 `cursor`：最近完整应用成功的 server revision。

```text
GET /api/v1/sync/pull?since=<cursor>
```

服务端直接查询 `revision > cursor` 的**当前最终状态**。V1 不保存完整历史 change log。

如果某实体在客户端离线期间被连续修改多次，离线设备只需要最终状态。

### 8.4 Outbox

每个本地 mutation 包含：

```text
mutationId
entityType
entityId
operation
baseRevision
payload
```

所有用户操作先写本地，再进入 Outbox。远端 pull 下来的变更不得重新进入 Outbox，避免 sync echo。

### 8.5 Idempotency

`mutationId` 是幂等键。

服务端记录已经处理的 mutation；如果数据库已经 commit 但 HTTP 响应丢失，客户端重发相同 mutation 时返回原结果，不重复执行、不重复增加 revision。

### 8.6 Tombstone

删除不立即物理删除，而是：

```text
deleted_at != null
revision = new revision
```

V1 不自动清理 Tombstone。订阅量级很小，保留 Tombstone 比增加 retention/full-resync/rebase 逻辑更可靠、更简单。

## 9. 冲突规则

采用分类型策略。

自动处理：

- 主题、字体、布局等普通设置
- 普通订阅字段更新
- 重复 URL 的新增订阅去重
- Secret：最后成功提交的 mutation 生效

高风险冲突：

- 删除 vs 修改同一订阅
- 删除分类 vs 另一设备向该分类新增订阅
- 同一实体发生会导致内容消失或归属明显变化的结构修改
- 大范围分类结构冲突

高风险冲突进入 `sync_conflicts`，不阻塞同一 batch 中其他无冲突 mutation，也不阻塞账户其他实体继续同步。

## 10. API 边界

建议路由：

```text
/api/auth/*                 Better Auth
/api/v1/me
/api/v1/devices
/api/v1/sync/bootstrap
/api/v1/sync/push
/api/v1/sync/pull
/api/v1/sync/conflicts
```

业务请求链：

```text
request
 -> auth middleware
 -> Better Auth session
 -> trusted userId
 -> device ownership check
 -> domain/sync service
 -> PostgreSQL
```

客户端不得在 payload 中声明可信 `userId`。服务端必须从 Session 推导 userId，并对所有 entity/device/conflict ID 再做 ownership 校验。

V1 不需要 RBAC/ACL/角色系统。

## 11. Web 与 Android Session

### 11.1 Web

使用 HttpOnly + Secure Session Cookie；生产环境 HTTPS；CORS/Trusted Origins 使用明确白名单。

### 11.2 Android

Android 不依赖普通 WebView `localStorage` 保存长期凭证。

抽象 `NativeAuthAdapter`：

```text
SecureSessionStore
OAuthLauncher
DeepLinkHandler
AuthHeaderProvider
```

OAuth 使用系统浏览器/Custom Tab，登录成功后通过 App Deep Link 返回 NewsNook。

Android Session/Token 保存到 native secure storage。若 Capacitor 下 Cookie Session 桥接不可靠，可将 Better Auth 的 Bearer 能力仅作为 Android transport adapter，不自行设计第二套 JWT 认证体系。

## 12. Secret 同步

Secret 属于同步范围，但 V1 不做 E2EE/零知识加密。

服务端可以解密 Secret，这是本设计接受的安全边界。

建议表：

```text
user_secrets
  id
  user_id
  key
  ciphertext
  nonce
  key_version
  revision
  updated_at
  deleted_at
```

服务端使用独立数据加密主密钥进行 authenticated encryption，例如 AES-256-GCM。

要求：

- PostgreSQL 不保存明文 Secret
- HTTPS 传输
- Android 保存到 native secure storage
- 日志、错误上报、审计记录不得打印明文 Secret
- 数据加密密钥与数据库备份分离保存
- `key_version` 为未来轻量密钥轮换留接口

V1 不引入 KMS/Vault/Envelope Encryption。

## 13. 数据库结构

Better Auth 自己维护认证相关表。

NewsNook Cloud 维护：

```text
devices
sync_heads
sync_mutations
categories
subscriptions
user_settings
user_secrets
sync_conflicts
```

### 13.1 `devices`

```text
id
user_id
name
platform
app_version
created_at
last_seen_at
revoked_at
```

设备是访问/同步主体，不是数据所有者。移除设备只撤销该设备后续访问，不删除它曾上传的数据。

### 13.2 `sync_heads`

每个 user 一行：

```text
user_id PK
current_revision BIGINT
updated_at
```

### 13.3 `sync_mutations`

用于幂等恢复：

```text
user_id
mutation_id
device_id
result
created_at
UNIQUE(user_id, mutation_id)
```

### 13.4 `sync_conflicts`

```text
id
user_id
entity_type
entity_id
server_revision
base_revision
local_change JSONB
server_state JSONB
created_at
resolved_at
```

Secret 的值不得进入冲突 JSON 快照。

## 14. PostgreSQL 事务与并发一致性

### 14.1 同一用户的 push 串行

每个 push transaction 对该用户的 `sync_heads` 行执行：

```sql
SELECT current_revision
FROM sync_heads
WHERE user_id = $1
FOR UPDATE;
```

效果：

- 同一用户多设备写入顺序确定
- 不同用户仍然可以并行
- 不需要分布式锁

### 14.2 Revision 分配

一个 batch 中每个被接受的实体变更分配新的 revision；实体变更、幂等记录、conflict 创建和 `sync_heads.current_revision` 更新在同一个 PostgreSQL transaction 中完成。

### 14.3 Batch 部分接受

业务上允许部分 mutation 成功：

```text
A accepted
B accepted
C conflict
D accepted
```

数据库事务仍保证该次服务端决定原子提交。

返回 accepted/conflicts/new revision。

### 14.4 Pull 的本地原子性

客户端必须遵循：

```text
apply remote changes
 -> persist locally
 -> update cursor
```

应用远端数据和更新 cursor 视为同一个逻辑原子动作。

禁止先推进 cursor 再写数据，因为崩溃后会永久漏同步。

重复应用远端最终状态必须幂等。

## 15. 首次同步的特殊事务

“使用云端数据”只拉取服务器状态，不修改云端。

“合并数据”走普通 mutation + conflict 流程。

“使用本机数据”是显式建立新云端基线的特殊 bootstrap：

- 锁定该用户 sync head
- 将云端旧同步实体生成 tombstone/新 revision
- 写入本地现有 categories/subscriptions/settings/secrets
- 更新 sync head
- 单 transaction commit

禁止简单 `DELETE everything + INSERT everything`，否则其他离线设备无法知道旧对象被删除。

## 16. 失败恢复

目标：任何网络断开、App 被杀、API 重启或数据库事务失败，都不能导致本地订阅丢失。

处理规则：

| 情况 | 行为 |
| --- | --- |
| 无网络 | 保留 Outbox，等待恢复 |
| Timeout | 同 mutationId 自动重试 |
| HTTP 5xx | 指数退避 + jitter |
| HTTP 429 | 遵守 Retry-After |
| Session 过期 | 暂停同步，提示重新登录 |
| Device revoked | 停止同步，本地数据保留 |
| Validation/schema 错误 | 不无限重试，提示升级或异常 |
| 高风险 conflict | 进入 Conflict Queue |
| PostgreSQL 不可用 | API 返回 503，本地继续使用 |
| App 被杀 | 下次启动继续处理 Outbox |
| commit 成功但响应丢失 | mutation idempotency 返回已有结果 |

用户点击“立即同步”时允许立刻触发，不必继续等待当前 backoff。

## 17. 日志与可观测性

Fastify 使用结构化日志；客户端继续遵循现有 `lib/logger.ts` 约束，新增 sync/account namespace 时不在 `src/` 直接使用 `console.*`。

服务端同步日志可记录：

```text
requestId
userId
deviceId
operation
mutationCount
acceptedCount
conflictCount
fromRevision
toRevision
durationMs
errorCode
```

禁止记录：

- 密码
- Session Token
- OAuth code/access token
- Secret 明文
- 完整同步 payload

客户端可向用户展示短错误编号/request correlation id，便于排查同步故障。

## 18. API 错误契约

HTTP code 表达错误大类，稳定业务 code 表达客户端动作。

至少包括：

```text
AUTH_REQUIRED
SESSION_EXPIRED
DEVICE_REVOKED
SYNC_CONFLICT
SYNC_SCHEMA_UNSUPPORTED
RATE_LIMITED
PAYLOAD_TOO_LARGE
VALIDATION_FAILED
```

客户端根据 code 决定自动重试、重新登录、冲突提示、停止同步或要求升级。

## 19. Shared Contracts

由于客户端和服务端都使用 TypeScript，可以共享纯协议包，例如：

```text
packages/contracts
```

只包含：

- API DTO
- schema
- error codes
- sync protocol version

不得让客户端直接 import 服务端 ORM/数据库 model。

实现阶段应优先考虑仓库现有结构能否承载共享协议；只有确有需要时再形成 workspace/monorepo 结构，避免为了共享少量类型先做大规模工程重组。

## 20. 协议版本

所有同步请求包含：

```text
syncProtocolVersion = 1
```

无法兼容的老客户端收到 `SYNC_SCHEMA_UNSUPPORTED`，而不是继续错误同步。

## 21. 安全边界

- 所有业务 API 从服务端 Session 推导 userId
- 每次 entity/device/conflict 访问验证 ownership
- 严格 Origin/CORS 白名单
- auth 与 sync API 分层限流
- push 采用 batch，并限制 mutation 数、payload bytes、字符串长度和实体数量
- OAuth Client Secret 只存在服务端
- Better Auth secret 与 NewsNook data encryption key 分离
- 用户 Secret 数据库只存密文
- Secret 主密钥不与 PostgreSQL backup 同地保存
- 不在日志中输出安全凭据

## 22. 测试策略

### 22.1 Unit

- conflict classifier
- merge rules
- rank
- schema validation
- secret encrypt/decrypt
- sync notification mapping

### 22.2 Integration（真实 PostgreSQL）

CI 使用真正 PostgreSQL，不 mock 以下行为：

- `FOR UPDATE`
- transaction rollback
- concurrent push
- idempotency
- revision monotonicity
- tombstone
- cross-user isolation
- device revoke
- secret at-rest encryption

至少增加同一用户两设备并发 push 测试，验证 revision 不重复、mutation 不重复、最终状态一致；同时验证不同用户不会因同一行锁互相阻塞。

### 22.3 Client

- Outbox persistence
- retry/backoff
- cursor persistence
- remote update 不产生 sync echo
- 首次登录三种选择
- session expiration
- conflict queue

### 22.4 E2E / 真机

必须覆盖：

- 邮箱注册/登录
- Google/GitHub 登录
- Android 系统浏览器 OAuth + Deep Link 返回
- Android Secure Session 恢复
- 断网修改 -> kill App -> 重启 -> 恢复网络 -> 自动同步
- 后台同步通知
- 退出登录后本地订阅仍保留
- 旧 WebView 兼容性回归

CI 不依赖真实 Google/GitHub 完成每次 OAuth；自动测试使用假 OIDC/provider 或可控 callback flow，staging 再做真实 provider smoke test。

## 23. 部署

V1 部署保持简单：

```text
Internet
 -> Cloudflare/HTTPS
 -> Nginx or Caddy
 -> newsnook-api (Node/Fastify)
 -> PostgreSQL
```

Docker Compose 可以只包含：

```text
newsnook-api
postgres
```

如果服务器已有 PostgreSQL，可直接使用外部数据库。

V1 明确不需要：

- Redis
- RabbitMQ
- Kafka
- Kubernetes
- Elasticsearch

API Container 除 PostgreSQL 外保持无状态，未来可以增加多个 API 实例，而无需修改同步协议；同一用户并发仍由 PostgreSQL `sync_heads FOR UPDATE` 协调。

## 24. Migration、健康检查与备份

数据库 migration 是显式部署步骤，不让多个 API 实例启动时自动并发迁移。

建议部署流程：

```text
backup
 -> migration
 -> API deploy
 -> health check
```

健康检查：

```text
/health/live
/health/ready
```

PostgreSQL 至少每日备份，并异机/对象存储滚动保留；必须定期验证 restore，而不只检查 dump 命令成功。

## 25. 退出登录与设备撤销

退出登录默认：

- 停止云同步
- 清理/撤销本设备认证凭据
- 保留本机订阅与配置

设备管理允许用户撤销某设备访问；撤销不删除该设备已经同步到用户账户的数据。

“退出并删除本机账户数据”不是 V1 必需能力。

## 26. 非目标与明确删除的复杂度

本设计明确不做：

- 强制登录
- 云端文章抓取/正文存储
- 正文/缓存同步
- 已读/收藏/进度同步
- OAuth/OIDC Provider
- CRDT
- Event Sourcing
- 完整 change log
- WebSocket 实时同步
- Redis/MQ/Kafka
- 分布式锁
- Kubernetes
- E2EE/零知识 Secret
- KMS/Vault/Envelope Encryption
- 复杂 Tombstone retention/rebase

这些只有在出现真实需求后再单独设计。

## 27. 成功标准

V1 完成后应满足：

1. 新用户无需账户仍可按现有方式使用 NewsNook。
2. 用户可以通过邮箱密码、Google、GitHub 登录同一个 NewsNook 账户体系。
3. 登录后可以在至少 Web/Android 两个客户端之间同步订阅、分类、排序、同步设置和 Secret。
4. 首次登录明确提供“本机 / 云端 / 合并”选择，并可在覆盖前恢复本地快照。
5. 离线编辑不会丢失；恢复网络后自动同步。
6. 相同 mutation 重试不会产生重复数据或重复 revision。
7. 两设备并发修改不会破坏 revision 单调性或跨用户数据隔离。
8. 删除能可靠传播到长期离线设备。
9. 普通冲突自动解决，高风险冲突可由用户处理，且单个冲突不阻塞整个账户同步。
10. 服务端或数据库暂时不可用时，NewsNook 本地阅读和本地订阅操作仍可工作。
11. 数据库中不存在 Secret 明文；日志中不存在密码、Session、OAuth Token、Secret 明文。
12. Android 真机 OAuth Deep Link、Secure Session、断网恢复、通知策略通过回归。

## 28. 实现前必须同步更新的仓库文档

由于本设计正式改变了当前产品约束，实施阶段必须更新：

- `AGENTS.md`
- `docs/architecture.md`
- 必要时 `README.md` / 用户指南中的“无需账号/无后端”表述

新的约束应表述为：

> NewsNook 核心阅读与本地数据路径保持 local-first；账户与云同步是可选增强能力。未登录、断网或 NewsNook Cloud 不可用时，现有本地核心功能必须继续工作。

这不是把业务内容处理迁移到后端，也不允许未来代码因为存在账号体系就默认要求云端在线。

## 29. 实现审查结论

实现前对本设计与 [`实现计划`](../plans/2026-08-27-account-cloud-sync.md) 做了一次一致性审查：整体架构与仓库现状兼容，无需推翻。以下是落地时明确下来的细化，与本文其余部分并列生效。

### 29.1 实体 id 不引入第二套 UUID

§8.1 写的是「每条记录具有稳定 UUID」。NewsNook 的内置信源 id、分类 id、自建源 id 本身就是离线可确定的稳定 id，再叠一层 UUID 映射会破坏 OPML、Preferences 与预设快照的语义。因此：

```text
subscription.entityId = 现有 source id
category.entityId     = 现有 category id
setting.entityId      = 稳定 setting key
secret.entityId       = 稳定 secret key
```

只有 `deviceId` / `mutationId` / `conflictId` 使用 UUID。

### 29.2 共享协议包是构建产物，客户端只引类型

`packages/contracts` 用 `tsc` 产出 `dist/`（ESM + `.d.ts`），并暴露两个入口：

- `@newsnook/contracts`：完整协议（含 Zod schema），供 `cloud/` 与测试使用
- `@newsnook/contracts/errors`：纯 TypeScript 错误码，不依赖 zod

客户端 `src/` 只以 `import type` 引用协议类型、以 `/errors` 子路径引用错误码，因此 zod 不会进入 App 包体。根 `npm run build` 会先构建 contracts。

### 29.3 场景预设作为单个 setting 实体同步

§13 的实体表没有为「场景预设」单列一张表。V1 把整份 `PresetsState` 作为一个 `setting` 实体（`entityId = presets`）同步：预设是一份用户自选的整体布局快照，拆成细粒度实体只会制造大量无意义的结构冲突。

### 29.4 冲突以 `sync_conflicts` 行的 UUID 为准

§13.4 的 `sync_conflicts.id` 落地为 UUID。单条 `POST /api/v1/sync/conflicts/:id/resolve` 与批量 `POST /api/v1/sync/conflicts/resolve` 都只接受 `accept_local` / `accept_server`；「全部应用」必须走批量接口，避免逐条请求打满 rate limit。

### 29.5 测试脚本按模块拆分而非按 name pattern 过滤

仓库既有约定是大量细粒度 `npm run test:*`。cloud 侧同样拆成 `test:cloud-health` / `test:cloud-auth` / `test:cloud-secrets` / `test:cloud-sync`，`test:cloud` 跑全部，比 `--test-name-pattern` 更贴合现有习惯，也更容易在 CI 里定位失败。

### 29.6 集成测试对 PostgreSQL 的依赖是显式的

需要真实数据库的 cloud 测试读 `TEST_DATABASE_URL`；未提供时测试直接跳过并打印原因，本地开发不会因为没装 PostgreSQL 而红。CI 一定提供该变量，因此 §22.2 要求的 `FOR UPDATE`、并发 push、幂等、tombstone、跨用户隔离仍然是真实数据库上的断言。

### 29.7 实现期补充的四条约定

以下几条在编码时才定下来，一并记录：

- **`@newsnook/contracts/protocol` 子入口**：除 §29.2 的 `/errors` 外，另有一个不含 zod 的 `protocol` 入口，导出协议版本、`SYNC_LIMITS`、枚举与 `rankBetween` / `rankForIndex`。客户端需要在运行时算排序键，只引类型不够，但也不该为此把 zod 打进 App 包。
- **首次同步闸门**：`LocalSyncState.firstSyncCompleted` 为 false 时日常同步循环直接停在 `needs-first-sync`。没有这道闸，一台刚装好的设备会在用户做出 §6.3 的选择之前，就把默认配置推成云端基线。
- **Outbox 不落 Secret 明文**：Outbox 持久化前 Secret 载荷抹成 null，真正的值在 push 前一刻从活投影里取。这同时避免了「Outbox 里躺着一份过期 Secret」的问题。
- **通知落地走深链**：Android 同步通知点开后发的是 `newsnook://sync/account-sync`，与分享深链共用 Capacitor 的 `appUrlOpen` 通道，而不是自定义 intent extra。
