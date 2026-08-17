# AGENTS.md — NewsNook（有所闻）

给 AI / 自动化助手的项目地图与工作规范。人类贡献流程见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)；详细架构见 [`docs/architecture.md`](./docs/architecture.md)。

## 1. 产品一句话

本地优先的 **Android 新闻阅读客户端**：无账号、无自建业务后端、无推荐算法。订阅源由用户配置，列表与正文由客户端直连上游，在应用内阅读。定位是**工具**，不是内容平台。

硬约束（改代码前先过一遍）：

| 约束 | 含义 |
|---|---|
| Backendless | 不新增自建 API / 账号 / 云同步；不把业务逻辑放到服务端 |
| 站内全文 | 打开条目必须在 App 内可读；「打开原文」只能是次要兜底 |
| 本地持久化 | 偏好、稍后读、已读、预设、缓存只落本机 |
| 双变体 | `cloud`（轻量）与 `local`（含 ML Kit / Bergamot）；包名与签名相同 |
| 依赖方向 | UI → hooks/features → lib → 原生/HTTP；源 URL/`kind` 只来自 `sources/registry.ts`（含自建源） |

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
│   │   ├── translation/         # TranslationService + Provider 接口
│   │   ├── proxy/               # 智能分流 / 隧道 / 原生 HTTP
│   │   ├── comments/            # 跟贴 Provider + 抽屉
│   │   ├── appUpdate/           # GitHub Release 检测与应用内更新
│   │   └── easterEgg/           # 版本彩蛋（勿当成核心阅读路径）
│   └── lib/                     # http · parseFeed · resolveBody · storage · sanitize …
├── android/                     # Capacitor Android 工程（入库）
├── functions/                   # Cloudflare Pages Functions（生产 Web 边缘代理）
├── scripts/                     # 构建脚本 + 单元/行为测试
├── public/ · assets/            # 静态资源 / 图标源图
├── docs/                        # 架构、用户手册、构建、设计稿
│   ├── architecture.md
│   ├── user-guide.md
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
| 站内正文 | `lib/resolveBody.ts` · `lib/sanitize.ts` · `lib/bodyCache.ts` · `screens/ReaderScreen.tsx` |
| 翻译 | `features/translation/`（稳定边界：`types.ts`；新增引擎实现 Provider 并注册） |
| 代理 / 网络 | `features/proxy/` · `lib/http.ts` · `vite.config.ts` · `functions/` |
| 跟贴 | `features/comments/` |
| 墨水屏 | `lib/eink.ts` · `hooks/usePagedReader.ts` · `index.css` 中 `[data-eink]` |
| 主题 / 排版 | `lib/theme.ts`（明暗 + 风格方案注册表） · `lib/customScheme.ts`（自定义配色推导） · `sources/preferences.ts` · `index.css`（`data-scheme` 方案块） |
| 应用更新 | `features/appUpdate/` |
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
7. **依赖方向**：UI 不直接拼上游 URL；不要在 `components/` 里硬编码源协议细节。

## 5. AI 工作规范

### 5.1 改动原则

- **最小必要改动**：只改完成当前任务所需的文件；不顺手重构、不批量格式化无关代码。
- **融入现有结构**：复用已有模块、命名、错误处理与测试风格；优先扩展（新 Provider / 新 kind）而非改核心路径。
- **先读再改**：改解析、缓存、翻译、代理前，先读对应 `lib/` 或 `features/` 入口与相关 `scripts/*.test.*`。
- **中文给用户，英文给代码**：面向用户的文案与文档用中文；标识符、API、日志字段保持项目既有英文风格。
- **新增生产依赖**：必须说明原因；默认不引入。
- **公开契约**：本地存储键/形状、源 registry 行为、外部网络行为变更时，在说明里写清楚，并评估迁移/兼容。

### 5.2 明确不要做的事

- 不要引入推荐算法、账号体系、自建内容后端或「热度排序强推」。
- 不要用外链浏览器替代站内正文主路径（错误态可提示打开原文，但不能变成默认阅读方式）。
- 不要把 keystore、`.env.android.local`、用户 API Key、真实代理凭证写进仓库或示例。
- 不要做网页爬虫规则编辑器（XPath/CSS 选择器配置 UI）；自建源走标准 Feed + Readability。
- 不要为了「优雅」引入新的全局状态库或路由库，除非任务明确要求且已讨论。
- 不要删除或弱化现有 `test:*` 来让检查通过。
- 不要在公开回复中展开可利用的安全细节；安全流程见 [`SECURITY.md`](./SECURITY.md)。

### 5.3 功能边界提示

| 场景 | 期望做法 |
|---|---|
| 新内置源 | 在 `registry.ts` 注册；必要时扩展 `SourceKind` + `parseFeed` / `resolveBody`；更新 `docs/news-sources.md`（若涉及探测结论） |
| 新翻译引擎 | 实现 `TranslationProvider`，在工厂注册；Reader 侧尽量零改动 |
| 新跟贴源 | 实现 `CommentProvider`，在 `comments/service` 注册 |
| UI 文案 | 与现有「我的 / 设置」语气一致；避免营销腔与平台化话术 |
| 墨水屏 | 行为叠加在 `einkMode` 上，不是第三套主题色；关闭后须零残留 |

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
npm run test:eink

npm run android:run         # 轻量 cloud
npm run android:run:local   # 完整 local（Bergamot 需先 bergamot:init）
npm run bergamot:init
```

Android SDK / 签名 / 发版细节：[`docs/android-build.md`](./docs/android-build.md)。

## 7. 验证清单（改完再声称完成）

1. 改动是否仍满足「无后端 / 站内全文 / 本地优先」？
2. 是否只碰了必要文件？有无误改 `cloud`/`local` 边界？
3. 解析 / 缓存 / 翻译 / 代理类改动：是否跑过对应 `npm run test:*`？
4. 是否引入密钥、新依赖或存储格式破坏？
5. 用户可见文案是否为中文且语气一致？

## 8. 文档索引

| 文档 | 用途 |
|---|---|
| [`README.md`](./README.md) | 产品说明与特性 |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | 人类贡献与 PR 约定 |
| [`docs/architecture.md`](./docs/architecture.md) | 分层、数据流、持久化、风险 |
| [`docs/user-guide.md`](./docs/user-guide.md) | 用户操作手册 |
| [`docs/android-build.md`](./docs/android-build.md) | 构建、签名、CI |
| [`docs/news-sources.md`](./docs/news-sources.md) | 源探测与频道笔记 |
| [`docs/legal.md`](./docs/legal.md) | 法律与声明 |
| [`SECURITY.md`](./SECURITY.md) | 安全报告 |
| [`docs/superpowers/specs/`](./docs/superpowers/specs/) | 历史设计规格 |
| [`docs/superpowers/plans/`](./docs/superpowers/plans/) | 历史实现计划 |

---

更新本文件时：保持简短可执行；细节仍以 `docs/architecture.md` 为准。架构级变更请同步更新架构文档与本地图中的入口表。
