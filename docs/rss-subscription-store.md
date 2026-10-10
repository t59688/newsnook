# RSS 订阅商店：在线发现

日期：2026-10-05。按用户要求移除全量离线目录与本机目录检索。

## 当前流程

- 名称/关键词：请求 `https://cloud.feedly.com/v3/search/feeds?query=...&count=40`，远端执行检索，客户端最多展示 40 个命中地址。
- 网站网址：直连发现 RSS / Atom / JSON Feed，必要时使用 [Feedsearch](https://feedsearch.dev/)；输入的网址也可以作为待检测候选。
- 点击结果后实际预览；成功或明确选择临时失败后仍添加，才保存为普通自建订阅。发现索引中的记录不代表当下可读取。
- 请求 30 秒超时；编辑查询和关闭页面取消请求，迟到结果不覆盖当前查询。

[Feedly 官方 API 说明](https://feedly.com/new-features/posts/introducing-the-feedly-teams-api)介绍了 Feed 搜索端点。本次直接请求关键词 OpenAI 返回 HTTP 200，无需账号。第三方服务可能限流、变更或要求鉴权，界面应显示错误并允许输入网站或 Feed 地址；不靠全量离线目录兜底，不使用用户 Feedly Cookie。

## 存储与迁移

搜索结果只在 React 页面与 App 导航内存中存在。未订阅结果不进本机持久存储。已删除 RSSHub、RSS-Bridge、Plenary、JackyST0 快照、离线索引、目录更新/管理/缓存模块及生成脚本。

进入商店时删除旧 `newsnook:feed-discovery` IndexedDB 和 `newsnook:feed-discovery-config`；其他窗口占用数据库时记录警告，下次进入重试。不清理已订阅 URL、正文、列表、稍后读、已读和预设。旧备份的目录字段忽略；已订阅的 paused/discovery 字段仍由备份与同步保留。

## 验证

`npm run test:feed-discovery` 覆盖在线请求、无查询零请求、40 条上限、非法地址/重复地址、取消、预览、明确订阅和保存失败。相关备份、暂停、预存、同步、硬件返回与 WebView 测试继续运行；最终以当次日志为准。

本次最终结果：在线发现、配置备份、预存、同步投影/引擎/运行时、共享协议、硬件返回、WebView 运行时/CSS、边缘代理和自建源共 12 个相关测试命令通过；lint、TypeScript、生产构建及 `git diff --check` 通过。lint 和构建保留既有警告。浏览器通过 Web 开发代理实际搜索 OpenAI，界面返回 28 个在线结果及 Feedly 归属链接；初始页面不加载目录。四个全量目录构建资源已消失，订阅商店页面资源约 20.30 KB（gzip 7.30 KB）。Android 真机与生产 Web 实例未实测。

## 2026-10-09：RSSHub 网址路由发现与多实例管理

**目标**：用户输入普通网站网址时，复用 RSSHub 社区已有的 Radar 路由，验证成功后作为现有 `kind: 'feed'` 自建源订阅。不建设 NewsNook RSSHub 后端、不恢复完整 RSSHub/RSS-Bridge 离线目录，也不改变普通 Feedly 关键词搜索。

### 发现页交互

- 「发现」明确区分**按名称搜索**和**通过网站订阅**两种任务。前者查 Feedly 中现有的 RSS；后者提交网站 / 作者主页 URL，查原站 Feed 与 RSSHub Radar。不会误导用户认为关键词会搜索 RSSHub 路由。
- 搜索按钮、输入提示及示例随任务切换；粘贴完整网址可自动切换至网站模式。切换模式或主分页时中止旧请求、清空旧查询与结果，防止旧数据混入。
- URL 模式仅接受有效网址才发请求；示例只填入输入框，不自动产生网络流量。RSSHub 实例管理入口只出现在相关模式；数字表示**已启用实例**，不是在线率保证。
- 结果列表区分原站 RSS / 网址检测与 RSSHub 转换，保留源站域名、待验证状态，隐藏冗长的原始 Feed URL（详情中仍可查看）。关键词搜索结果另设“订阅 UP 主 / 作者”的网址入口，减少模式误解。
- 保持墨问主题语义色、现有 SettingsShell、按钮触达尺寸以及可访问的 pressed/label 状态，不新增后端和持久化配置。

### 数据流

1. 关键词 → Feedly 在线搜索（保留）；普通网站 URL → 原站 RSS + Feedsearch + RSSHub Radar 并行发现，失败路径互不遮蔽。
2. Radar 规则按需从 RSSHub 官方 `gh-pages/build/radar-rules.json` 获取，失败时向一个公开实例的 `/api/radar/rules` 读取同结构数据。完整约 1.4 MB 的 Radar 元数据**仅在页面需要时放入内存**，6 小时有效；没有构建到 APK，未订阅候选不进磁盘缓存。下一次应用冷启动可能再次联网读取。
3. 只匹配声明式的 host、subdomain、source path/query 与 target path 模板；旧路由中带函数体、JS 表达式、无法解析的正则/动态规则一律跳过，**不会执行下载的脚本**。Radar 只覆盖有雷达规则的部分网站，并不是完整 RSSHub 路由搜索服务。
4. 选择命中的路由，补齐缺失参数、选择启用的实例 → 通过 NewsNook 既有 Web 代理或 Android HTTP 通道发 GET → 复用 `previewFeed` 严格验证 RSS/Atom/JSON Feed。预览最多尝试两个同类实例，未验证结果不伪装成功；可明确选择保存一时网络不可用的 Feed。
5. 保存 `NewsSource.kind = 'feed'`、`url` 与 `discovery: { generator: 'rsshub', routeKey, instanceId }`，保留原有分类、预设、暂停与同步/备份语义。已订阅来源在“已订阅 → 服务”可手动检测/更换实例，更新 URL 时不更换 `source.id`。
6. 下拉刷新、预取、正文预存对 RSSHub 来源继续使用 `fetchSourceText`。对无敏感参数的路由最多尝试两个实例，每实例 8 秒，失败的路由族 3 分钟冷却，进程内记住最近成功实例。普通 Feed 不受该机制影响。手动更换实例通过既有 `replaceCustomSourceInstance` 保留阅读状态。

### 服务与安全边界

- 默认提供 isRSS、FunnyCups、Slarker、RSSForever 公共实例；官方 `rsshub.app` 仅作为**默认关闭的演示实例**。这不是在线率保证，首页连接成功不代表特定路由能工作。
- 用户可增删和启停公开 HTTPS 实例；禁止直接配置 localhost、常见内网地址、明文 HTTP、URL 凭据及任意路径/端口。Web 使用既有 Cloudflare/Vite 请求代理；Android 使用已有 Capacitor 原生通道，不向 NewsNook Cloud 增加订阅抓取服务。
- 自动故障回退按**公共默认实例/用户自定义实例**分组，不从自定义服务无提示地转发到公共第三方。可能包含 token、cookie、未知 URL 查询字段等敏感信息的路由只请求原绑定实例，禁止跨实例迁移。
- 第三方实例运营者可能记录请求与订阅地址；运行态冷却和成功实例提示不构成持久同步；不能保证所有 Radar 规则都能解析，也不能绕过目标站反爬、账号权限或公共实例限额。

### 验证

- `npm run test:rsshub`：覆盖实例 URL 验证、Radar 模板与参数解析、Unicode 路径、危险表达式过滤、敏感路由、故障切换、限次重试、取消、已订阅实例重绑定 UI。
- `npm run test:feed-discovery`：原有在线发现和订阅商店交互回归，加上 RSSHub 功能测试。
- 同步/备份、刷新并发、下拉手势以及 Web 生产构建应继续通过。生产公共实例的长期可用率、Android 真机以及生产 Web 网络仍需独立实测；以最终 CI 和手动验收为准。


## 2026-10-10：自动选择可用 RSSHub 实例与多频道订阅

- 「通过网站订阅」既接受普通网站 URL，也接受 `rsshub://bilibili/user/video/946974` 这类逻辑路由。逻辑 URI 先验证并转成路由路径，不按网站域名查找，也不需要 Radar 目录；网址发现仍按需获取在线 Radar。
- 搜索命中已完整解析的 RSSHub 路由后，在页面内启动后台 Feed 实测。成功需通过现有 `previewFeed` 验证 RSS/Atom/JSON Feed；有内容和合法空 Feed 都可判成功。用户看到“检测中”、“可订阅 · N 篇文章”或“暂不可用”的实际状态，绝不以实例首页健康状态代替路由验证。
- 每次搜索仅取最多 8 条完整路由、3 条并发；每条路由最多尝试 4 个启用实例，单次约 6 秒，总探测约 16 秒；旧查询/关闭页面主动中止。记录内存中的路由族最近成功实例，下次搜索优先复用；均受冷却与设置中的实例启停约束。
- 逻辑 URI 和普通网站自动搜索仅使用默认公共实例；用户显式输入/绑定的自定义实例只在同一自定义信任组回退。带 token、cookie、未知查询字段等敏感路由必须绑定实例，不自动扇出到公共服务器。
- 可用频道支持逐条勾选、一次批量订阅。App 层按当前预设复核及去重后，一次写入自定义订阅、分类和综合启用状态；失败不提交中间状态。已订阅来源保留原有实例更换、暂停、同步、备份及刷新路径。
- 默认公共实例增加 OrigRead 引用的 Virworks、owo.nz 和无敌飞雪，仍属第三方，无法保证每个站点/地区都可访问；正式安装后的性能/网络需在 Android 真机及生产 Web 验收。所有检索与探测仍是客户端请求，不增加 NewsNook 服务端 RSS 抓取。
