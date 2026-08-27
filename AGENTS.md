# AGENTS.md — NewsNook（有所闻）

给 AI / 自动化助手的项目地图与工作规范。人类贡献流程见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)；详细架构见 [`docs/architecture.md`](./docs/architecture.md)。

## 1. 产品一句话

本地优先的 **Android / Web 新闻阅读客户端**：不登录即可完整使用；可选账户与云同步增强跨设备体验；无推荐算法。订阅源由用户配置，列表与正文由客户端直连上游，在应用内阅读。定位是**工具**，不是内容平台。

硬约束（改代码前先过一遍）：

| 约束 | 含义 |
|---|---|
| Local-first | 核心阅读不依赖 NewsNook Cloud：未登录、断网、云端故障都不能阻止订阅浏览、正文解析与离线缓存阅读 |
| 可选云同步 | 可有账户与配置同步（订阅 / 分类 / 跨设备设置 / Secret）；**不得**把列表拉取、正文解析、离线缓存做成云必经路径；不把业务逻辑下沉到服务端 |
| 站内全文 | 打开条目必须在 App 内可读；「打开原文」只能是次要兜底 |
| 本地持久化 | 偏好、稍后读、已读、预设、缓存先落本机；云端只是同步域的投影，不是运行时真相 |
| 双变体 | `cloud`（轻量）与 `local`（含 ML Kit / Bergamot）；包名与签名相同 |
| 依赖方向 | UI → hooks/features → lib → 原生/HTTP；源 URL/`kind` 只来自 `sources/registry.ts`（含自建源）。账户/同步：`UI → account/sync → 本地适配/contracts → cloud API`；阅读链路直连上游站点 |

## 2. 技术栈速览

- **UI**：React 19 + TypeScript + Tailwind CSS v4 + Vite 8
- **原生**：Capacitor 8（Android）；无 React Router / Redux / Zustand
- **解析**：fast-xml-parser、@mozilla/readability、linkedom、DOMPurify
- **Lint**：oxlint；测试多为 `scripts/*.test.ts` + `npm run test:*`

版本号唯一源：`package.json` 的 `version`（Gradle `versionName` / `versionCode` 同源）。

## 3. 仓库地图

```text
newsnook/
├── src/                         # React 应用（主战场）
│   ├── App.tsx                  # 全局状态机、返回键、设置栈、正文预取
│   ├── main.tsx / BootstrapRoot.tsx
│   ├── components/              # 壳、列表项、阅读器控件、通用 UI
│   ├── screens/                 # Feed / Me / Channels + settings/*
│   ├── hooks/                   # useFeeds / usePreferences / usePresets …
│   ├── sources/                 # registry · categories · presets · preferences
│   ├── features/                # 领域能力（按边界分包）
│   │   ├── account/             # 可选登录 / Session / 设备身份
│   │   ├── sync/                # SyncEngine · Outbox · 合并与冲突
│   │   ├── translation/         # TranslationService + Provider 接口
│   │   ├── proxy/               # 智能分流 / 隧道 / 原生 HTTP
│   │   ├── comments/            # 跟贴 Provider + 抽屉
│   │   ├── appUpdate/           # GitHub Release 检测与应用内更新
│   │   └── easterEgg/           # 版本彩蛋（勿当成核心阅读路径）
│   └── lib/                     # http · parseFeed · resolveBody · storage · sanitize …
├── android/                     # Capacitor Android 工程（入库）
├── cloud/                       # 可选账户与同步 API（Fastify + PostgreSQL）
├── packages/contracts/          # 客户端与 cloud 共享的同步协议 / DTO
├── functions/                   # Cloudflare Pages Functions（生产 Web 边缘代理）
├── scripts/                     # 构建脚本 + 单元/行为测试
├── public/ · assets/            # 静态资源 / 图标源图
├── docs/                        # 架构、用户手册、构建、设计稿
│   ├── architecture.md
│   ├── user-guide.md
│   ├── local-recommend.md
│   ├── android-build.md
│   ├── news-sources.md
│   └── superpowers/{specs,plans}/
├── vite.config.ts               # 开发态 /api 代理
├── capacitor.config.ts
└── package.json
```

### 按任务找入口

| 任务 | 从这里开始 |
|---|---|
| 导航 / 返回键 / 设置栈 | `src/App.tsx` |
| 新增或修复内置源 | `src/sources/registry.ts` → `lib/parseFeed.ts` / `lib/resolveBody.ts`；探测笔记 `docs/news-sources.md` |
| 分类 / 场景预设 | `sources/categories.ts` · `presets.ts` · `hooks/usePresets.ts` |
| 列表拉取与缓存 | `hooks/useFeeds.ts` · `lib/http.ts` · `lib/storage.ts` |
| 配置备份与恢复 | `lib/backup.ts` · `components/BackupPanel.tsx`（入口在 `screens/settings/StorageScreen.tsx`）；与云同步并存，本地文件备份不依赖账号 |
| 账户（登录 / Session / SecureStore） | `features/account/`：`authClient.ts`（Better Auth HTTP + Web Cookie / Android Bearer） · `useAccount.ts` · `secureStore.ts` + `secretStore.ts`（Keystore 与 Secret 水合） · `mobileCallback.ts`（`newsnook://auth/callback`） · `screenModel.ts`（页面状态机） |
| 云同步（客户端） | `features/sync/`：`projection.ts`（本地态 → 同步实体） · `reconcile.ts`（影子对账 + Outbox） · `SyncEngine.ts`（push/pull/apply/退避） · `merge.ts` · `runtimeAdapter.ts` + `useCloudSync.ts`（接 React） · `notifier.ts`（Toast / 通知分寸） · `firstSync.ts` · `devices.ts` |
| 云同步（服务端与协议） | `cloud/`（Fastify + PostgreSQL + Better Auth；push 用 `pg_advisory_xact_lock` 串行化） · `packages/contracts/`（zod schema；`./protocol` 子路径供客户端免 zod 引用）；部署见 [`docs/cloud-deploy.md`](./docs/cloud-deploy.md)，规格见 [`docs/superpowers/specs/2026-08-27-account-cloud-sync-design.md`](./docs/superpowers/specs/2026-08-27-account-cloud-sync-design.md) |
| 阅读位置记忆 | `lib/readingPosition.ts`（`newsnook:reading-pos`；滚动与墨水屏分页共用一张表） |
| 分享 / 阅读器溢出菜单 | `lib/shareToken.ts`（v2 token 编解码，App 与边缘 worker 共用） · `lib/shareLink.ts`（站内短链 `news.aizeek.com/a/<token>` 组装 + 深链冷启动） · `lib/articleId.ts`（收发两端共用的条目 id 规则） · `lib/shareArticle.ts` · `components/ShareArticleSheet.tsx` · `components/ReaderMoreMenu.tsx` · `components/EinkReaderMenu.tsx` · `functions/lib/shareCard.ts`（爬虫抓 `/a/*` 时的 Open Graph 卡片） |
| 本地离线搜索 | `lib/localSearch.ts` · `screens/settings/LocalSearchScreen.tsx`（与 `web-catalog` 的联网站内搜索无关） |
| 本地推荐（动态分类） | 原理与效果见 [`docs/local-recommend.md`](./docs/local-recommend.md)；代码：`lib/recommend.ts`（排序 + 阅读阈值） · `lib/articleId.ts`（信源归属） · `sources/categories.ts`（`RECOMMEND_CATEGORY` · 保留名） · `sources/preferences/categoryPrefs.ts`（候选池 / 轨道拼装）；接线在 `App.tsx` |
| 功能引导 | `features/productTour/`（steps 纯定义 · Service 封装 driver.js · useProductTour 接 App）；目标元素用 `data-tour` 锚定；重看入口在 `screens/settings/AboutScreen.tsx` |
| 站内正文 | `lib/resolveBody.ts` · `lib/sanitize.ts` · `lib/bodyCache.ts` · `screens/ReaderScreen.tsx` |
| 翻译 | `features/translation/`（稳定边界：`types.ts`；新增引擎实现 Provider 并注册） |
| 代理 / 网络 | `features/proxy/` · `lib/http.ts` · `vite.config.ts` · `functions/` |
| 跟贴 | `features/comments/` |
| 分享短链 / App 唤起深链 | `lib/shareToken.ts`（token 编解码） · `lib/shareLink.ts` · `lib/appDeepLink.ts` · `functions/lib/shareCard.ts`（爬虫 OG 卡片） · `wrangler.jsonc`（`run_worker_first`） |
| 墨水屏 | `lib/eink.ts` · `hooks/usePagedReader.ts` · `index.css` 中 `[data-eink]` |
| 主题 / 排版 | `lib/theme.ts`（明暗 + 风格方案注册表） · `lib/customScheme.ts`（自定义配色推导） · `sources/preferences.ts` · `index.css`（`data-scheme` 方案块） |
| 应用更新 | `features/appUpdate/` |
| 日志 / 调试输出 | `lib/logger.ts`（`log.*` 命名空间；禁止 `src/` 直接 `console.*`） |
| Android 构建 / 签名 | `docs/android-build.md` · `scripts/android-*.mjs` |
| 产品设计背景 | `docs/superpowers/specs/` |

## 4. 架构要点（AI 必读）

1. **无路由库**：Tab / 设置栈 / 阅读器全是 `App.tsx` 的 `useState` 状态机。
2. **源模型**：`SourceKind` 决定列表与正文路径；通用 `feed` 走 RSS/Atom/JSON Feed + Readability；站点定制 kind 有专用解析。
3. **列表不长期存全文**：`contentHtml` 不进列表缓存；正文走 `bodyCache`（约 3MB 预算，稍后可读 pin）。
4. **HTTP 分环境**：
   - Web dev：Vite `/api/*` 代理
   - Web prod：`functions/` 边缘代理（**无** App 内 SOCKS/HTTP 隧道）
   - Android：`CapacitorHttp` 或用户代理隧道
5. **翻译**：Reader 只依赖 `TranslationService`；`cloud` 变体对 ML Kit/Bergamot 给空实现，勿把 JNI 逻辑编进轻量包。
6. **持久化前缀** `newsnook:`，见 `lib/storage.ts`；小配置可镜像 Capacitor Preferences，大缓存走 localStorage。
7. **依赖方向**：UI 不直接拼上游 URL；不要在 `components/` 里硬编码源协议细节。现有业务模块不得直接调云 API——先写本地，再由 Sync Engine 经 Outbox 异步上传。
8. **可选账户与云同步**：登录可选；V1 同步订阅 / 分类排序启停 / 跨设备设置 / Secret；**不同步**正文、列表/正文缓存、稍后读、已读、阅读位置与历史。设备本地项（如 `einkMode`）不上传。细节见架构文档与同步规格。
9. **日志**：`src/` 业务代码统一走 `lib/logger.ts` 的 `log.<namespace>`；`scripts/` 测试脚本可继续 `console.log` 输出结果。

## 5. AI 工作规范

### 5.1 改动原则

- **最小必要改动**：只改完成当前任务所需的文件；不顺手重构、不批量格式化无关代码。
- **融入现有结构**：复用已有模块、命名、错误处理与测试风格；优先扩展（新 Provider / 新 kind）而非改核心路径。
- **先读再改**：改解析、缓存、翻译、代理前，先读对应 `lib/` 或 `features/` 入口与相关 `scripts/*.test.*`。
- **中文给用户，英文给代码**：面向用户的文案与文档用中文；标识符、API、日志字段保持项目既有英文风格。
- **新增生产依赖**：必须说明原因；默认不引入。
- **公开契约**：本地存储键/形状、源 registry 行为、外部网络行为变更时，在说明里写清楚，并评估迁移/兼容。

### 5.2 明确不要做的事

- 不要引入推荐算法、内容平台式「热度排序强推」，或把正文/离线缓存上云做成阅读必经路径。
- 不要强制登录；不要让未登录/断网/云故障阻断本地订阅浏览与站内正文。
- 不要在 V1 同步正文、列表缓存、稍后读、已读、阅读位置；不要为此预埋 CRDT / Event Sourcing / Redis / MQ。
- 不要用外链浏览器替代站内正文主路径（错误态可提示打开原文，但不能变成默认阅读方式）。
- 不要把 keystore、`.env.android.local`、用户 API Key、真实代理凭证、OAuth Client Secret 写进仓库或示例；日志中永不打印明文 Secret。
- 不要为了「优雅」引入新的全局状态库或路由库，除非任务明确要求且已讨论。
- 不要删除或弱化现有 `test:*` 来让检查通过。
- 不要在公开回复中展开可利用的安全细节；安全流程见 [`SECURITY.md`](./SECURITY.md)。
- 不要在 `src/` 直接写 `console.*`；用 `log.http` / `log.sniffer` 等（仅 `lib/logger.ts` 内部可调 `console`）。

### 5.3 功能边界提示

| 场景 | 期望做法 |
|---|---|
| 新内置源 | 在 `registry.ts` 注册；必要时扩展 `SourceKind` + `parseFeed` / `resolveBody`；更新 `docs/news-sources.md`（若涉及探测结论） |
| 新翻译引擎 | 实现 `TranslationProvider`，在工厂注册；Reader 侧尽量零改动 |
| 新跟贴源 | 实现 `CommentProvider`，在 `comments/service` 注册 |
| UI 文案 | 与现有「我的 / 设置」语气一致；避免营销腔与平台化话术 |
| 墨水屏 | 行为叠加在 `einkMode` 上，不是第三套主题色；关闭后须零残留 |
| 分享链接 | 主链接必须是站内 `/a/<token>` 深链（`lib/shareLink.ts`），原站地址只用于「打开原文」；token 自解释，不得为此新增服务端存储或短链服务。v2 载荷只放原文地址 + 信源 id，别再往里塞中文（标题打开后由 `resolveBody` 补） |
| 账户 / 云同步 | 改动落在 `features/account`、`features/sync`、`cloud/`、`packages/contracts/`；业务写本地再进 Outbox；UI 不直接调云 API；协议变更走共享 contracts |
| 调试日志 | 见 **5.4**；新增模块优先复用已有命名空间，必要时在 `LogNamespace` 扩展 |

### 5.4 日志（`lib/logger.ts`）

**级别**（阈值，从安静到详细）：`silent` < `error` < `warn` < `info` < `debug` < `trace`。  
设 `level: 'warn'` 时只输出 `error` 与 `warn`；`info`/`debug`/`trace` 被丢弃。

**默认**：Vite 开发态（`import.meta.env.DEV`）→ `debug`；正式 APK / Web 生产构建 → `warn`。  
正式版默认 `warn` 的原因：避免 logcat 被 HTTP/嗅探等调试信息刷屏、减少性能与隐私泄露风险，同时仍保留存储失败、翻译分块失败等可行动告警。

**命名空间**（分模块开关）：`app` · `boot` · `catalog` · `feed` · `http` · `proxy` · `reader` · `sniffer` · `storage` · `translation`。  
`namespaces` 里显式 `false` 关闭单模块；未列出则默认启用。

**运行时覆盖**（不改代码、不重打包）：

```javascript
__newsnookLog.setLevel('trace')
__newsnookLog.enable('http'); __newsnookLog.disable('sniffer')
localStorage.setItem('newsnook:log', JSON.stringify({ level: 'debug', namespaces: { http: true } }))
// Web：?log=debug&logNs=http,-sniffer
```

**代码约定**：`import { log } from '../lib/logger'` → `log.http.debug(...)`；临时调试结束后勿留 `trace`/`debug` 热路径日志。oxlint 对 `src/**` 启用 `no-console`。

## 6. 常用命令

```bash
npm install
npm run dev                 # Web 开发（含 /api 代理）
npm run lint                # oxlint
npm run build               # 字体子集 + tsc -b + vite build

# 按改动选择相关测试，例如：
npm run test:json-feed
npm run test:resolve-body
npm run test:translation
npm run test:proxy
npm run test:custom-sources
npm run test:share-article
npm run test:share-link
npm run test:eink
npm run test:logger
npm run test:share-og
npm run test:config-backup
npm run test:local-search
npm run test:recommend
npm run test:product-tour

# 账户与云同步（客户端）
npm run test:sync-projection
npm run test:sync-engine
npm run test:account-auth
npm run test:secure-secret-hydration
npm run test:cloud-sync-runtime
npm run test:account-sync-ui
npm run test:sync-notifier

# 账户与云同步（协议与服务端；cloud 需要 TEST_DATABASE_URL 指向真实 PostgreSQL）
npm run test:cloud-contracts
npm run test:cloud            # 或 test:cloud-{health,auth,secrets,sync}
npm run cloud:migrate         # 显式迁移，API 启动不自动跑
# Docker：cd cloud && ./deploy db migrate
npm run cloud:build

npm run android:run         # 轻量 cloud
npm run android:run:local   # 完整 local（Bergamot 需先 bergamot:init）
npm run bergamot:init
```

Android SDK / 签名 / 发版细节：[`docs/android-build.md`](./docs/android-build.md)。
Cloud 单机部署：[`docs/cloud-deploy.md`](./docs/cloud-deploy.md)（`cloud/deploy` CLI）。

## 7. 验证清单（改完再声称完成）

1. 改动是否仍满足「本地优先 / 站内全文」？核心阅读路径是否仍可不依赖 NewsNook Cloud？
2. 是否只碰了必要文件？有无误改 `cloud`/`local` 变体边界，或把业务逻辑下沉到同步服务？
3. 解析 / 缓存 / 翻译 / 代理 / 同步类改动：是否跑过对应 `npm run test:*`？
4. 是否引入密钥、新依赖或存储格式破坏？Secret 是否避免明文日志与入库示例？
5. 用户可见文案是否为中文且语气一致？

## 8. 文档索引

| 文档 | 用途 |
|---|---|
| [`README.md`](./README.md) | 产品说明与特性 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 人类贡献与 PR 约定 |
| [`docs/architecture.md`](./docs/architecture.md) | 分层、数据流、持久化、风险 |
| [`docs/user-guide.md`](./docs/user-guide.md) | 用户操作手册 |
| [`docs/local-recommend.md`](./docs/local-recommend.md) | 本地推荐：原理、权重与效果（与代码同步） |
| [`docs/android-build.md`](./docs/android-build.md) | 构建、签名、CI |
| [`docs/cloud-deploy.md`](./docs/cloud-deploy.md) | NewsNook Cloud 部署、迁移、备份与冒烟 |
| [`docs/news-sources.md`](./docs/news-sources.md) | 源探测与频道笔记 |
| [`docs/legal.md`](./docs/legal.md) | 法律与声明 |
| [`SECURITY.md`](./SECURITY.md) | 安全报告 |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | 历史设计规格 |
| [`docs/superpowers/specs/2026-08-27-account-cloud-sync-design.md`](./docs/superpowers/specs/2026-08-27-account-cloud-sync-design.md) | 可选账户与云同步设计 |
| [`docs/superpowers/plans/`](./docs/superpowers/plans/) | 历史实现计划 |
| [`docs/superpowers/plans/2026-08-27-account-cloud-sync.md`](./docs/superpowers/plans/2026-08-27-account-cloud-sync.md) | 账户与云同步实现计划 |

---

更新本文件时：保持简短可执行；细节仍以 `docs/architecture.md` 为准。架构级变更请同步更新架构文档与本地图中的入口表。
