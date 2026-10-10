# 网页目录与 CMS 适配

本模块把 CMS 身份识别、页面能力发现、目录抽取和浏览会话分开。识别不出引擎名称的静态目录也能使用；识别到引擎名称不会自动生成搜索、分类、排序或分页地址。

## 入口与依赖

`SiteScreen`、单源 `FeedScreen` → `features/siteCatalog/useCatalogSession` → `session` → `service` → `lib/http`。主信息流 `useFeeds` 与离线预存 `sourceWindow` 使用相同的 `loadCatalogPage`。`catalogEngine` 负责条目抽取和 Article 映射；`frameworkDetect` 保留既有引擎/主题证据与旧契约。

- `detection.ts`：比较 generator、专有脚本变量与资源证据。明确身份优先于共享主题；冲突保持通用身份。
- `capabilities.ts` / `pagination.ts`：只提取已返回 HTML 中的链接与搜索表单。
- `service.ts`：当前响应 URL、合法 base、页面状态、一次目录映射、真实信源归属。
- `session.ts`：请求取消、过期响应隔离、历史页、错误保留与重试、循环终止。
- `profile.ts`：本地保存、导入与同步边界的受限归一化。
- `probe.ts`：首页加最多三个实际栏目链接，最多四次请求，串行探测；不会扫描猜测的 CMS 接口。
- `cache.ts`：仅目录列表元信息的本地版本迁移。
- `catalogEngine/pageUrl.ts`：兼容 URL 工具独立于 DOM；共享 registry 与边缘代理不会加载客户端目录解析器。

所有列表与详情读取继续直连上游。Web 代理只转发，不承担 CMS 识别与解析；账号与 NewsNook Cloud 不参与读取路径。没有新增生产依赖。

## 当前规则覆盖与验证范围

| 引擎 / 类型 | 身份证据与目录能力 | 验证范围 |
|---|---|---|
| 苹果 CMS v8/v10 | 专有变量、播放器/资源/路由证据，保留既有主题识别 | 既有 stui、Conch、vfed、MXPro、ds3 等回归；经典视频详情路由与懒加载封面 |
| 海洋、飞飞、赞片、JEECMS、努努主题 | 专有标识和既有适配器；共享主题不抢占明确身份 | 既有引擎回归；飞飞 v4 `Public` + `cms` + `ff-search`；香菇影视实站 |
| WordPress、Hugo、Hexo、Ghost | generator / 专有资源；文章、slug、JSON-LD 与语义卡片 | 既有回归与属性顺序、大小写、普通文本负例 |
| Typecho、DedeCMS、Drupal、Joomla | generator / 专有证据，加通用抽取规则 | 官方模板结构的独立渲染样本：作者元信息、摘要列表、Views 行、blog-item、页导航 |
| 帝国、PbootCMS、易优、Z-Blog | generator / 专有证据；通用静态目录与表单能力 | 身份正负例、两个 generator 变体、通用目录能力契约；没有宣称逐个默认/商业主题实站全覆盖 |
| 未知引擎 | 无须身份，走实际 JSON-LD、article/li/card 等目录结构 | 单条、无图、分离封面、大小写 URL、同站 base、截断、导航排除 |

身份矩阵覆盖 17 个明确引擎；努努与未知目录另由既有/通用用例覆盖。身份测试与完整模板兼容测试是不同的验证层，不能把相同 HTML 更换 generator 当成各引擎所有主题都已验证。

模板结构依据：[Typecho 默认首页](https://raw.githubusercontent.com/typecho/typecho/master/usr/themes/default/index.php)、[Typecho 元信息](https://raw.githubusercontent.com/typecho/typecho/master/usr/themes/default/functions.php)、[Joomla 分类博客](https://raw.githubusercontent.com/joomla/joomla-cms/5.4-dev/components/com_content/tmpl/category/blog.php)、[Drupal Views 行模板](https://raw.githubusercontent.com/drupal/drupal/11.x/core/modules/views/templates/views-view-unformatted.html.twig)、[DedeCMS 默认文章列表](https://raw.githubusercontent.com/dedecms/DedeCMS/master/templets/default/list_article.htm)。测试使用小型原创渲染样本，正文与标题为测试数据。

## 页面能力

- 分类、排序、筛选来自真实链接；缺少能力时不显示相应操作。
- 搜索支持 GET、表单 POST、飞飞页面明确给出的 `data-action` 重写路径；中文查询仅编码一次。保留合法 hidden 参数与重复名称字段；不持久化密码、CSRF、nonce 等敏感字段。需要这类动态会话字段的搜索暂不执行。
- 下一页支持 rel、中文/英文标签、主题导航控件、具有当前页证据的数字页导航。offset、start、page 等只使用实际链接的步长，不把 offset 当成页码。
- 没有页数证据时只显示上一页/下一页和会话当前页序号，不猜测总页数。
- 站点浏览最多 30 页；循环链接、重复内容、无结果与末页会停止。主列表刷新后按本次遍历记录重走历史，跳过本机已经保留的条目，避免把保留历史误判为末页。
- 详情、验证页、动态空壳和不支持页面分别处理。网络失败保留成功列表，重试保持原请求方法与分页历史。

不执行上游 JavaScript，不解登录/验证、不猜未暴露的 REST/AJAX 端点。只有动态壳或隐藏接口的站点需要额外可验证的协议适配。新增规则应先加入代表结构与负例，不能用域名单独打补丁。

## 解析与预算

明确的 JSON-LD ItemList 优先，其次为语义/重复卡片；孤立的首页推荐项 JSON-LD 不覆盖实际列表。保留旧启发式回退，合并同 URL 的封面、日期与类型证据。URL 路径大小写与业务查询参数保持不变。摘要中的列表、作者链接、分类栏、侧栏排行榜及相关阅读容器不会被当成正文条目。混合内容 CMS 的图文路由优先于共享影视主题；打印版与 AMP 详情使用同站 canonical 和正文结构证据区分。

单页最多 200 条并报告截断；HTML 上限 2 MiB；一次探测总超时 25 秒，单页读取也有 25 秒超时。浏览器在流式读取时停止超大响应；Android 桥接响应收到后检查大小，桥接本身目前无法在 JS 侧逐块中止下载。取消后即使原生请求仍在执行，结果也不能写入当前会话。

Web 开发/生产代理可通过 `X-NewsNook-Upstream-Url` 返回实际上游地址；Android 手动跟随重定向并保留最终地址。旧代理或包装反代没有可靠元信息时使用请求地址，禁止把代理响应 URL 当成上游地址。POST 的 301/302/303 转 GET，307/308 保留请求体；重定向有上限。

## 配置与缓存兼容

`NewsSource.catalogProfile` 是可选 version 1 / rulesRevision 1 纯数据配置。旧 `frameworkHint` 继续可读取；重新探测保存两者，编辑 URL 保留 sourceId 并清除不适用的旧规则。新 profile 优先于旧 hint；无身份标记的分页可继承有效规则，明确冲突退化为通用身份。未知未来版本的合法、有限纯数据保存在 `catalogProfileOpaque`，运行时退化为通用发现，备份保留该数据，同步仍投影到 `catalogProfile`。较旧客户端可以忽略新字段。新版 cloud 共享契约接受该可选字段；旧服务可能丢弃它，但本机读取不依赖同步。

目录列表使用 `catalog-v2:` 版本标识，新增可选 `paging.nextUrl`。旧缓存在本机修正全视频类型，保留条目、原缓存时间和 URL-hash ID；不清空离线列表。正文、已读、稍后读、阅读位置及 RSS 缓存键/格式不变。无法从旧缓存获得下一页证据时，联网后重新发现首页能力。

## 验证

`npm run test:site-catalog` 包含抽取、引擎/能力、会话、配置/同步、详情、响应预算、身份矩阵、官方模板结构、站点 UI、主信息流/预存/迁移、原生 POST 与共享 registry 依赖边界测试。相关原有测试仍保留。

可选实站检查：`npx tsx scripts/site-catalog-smoke.ts [网址]`，默认香菇影视；不属于离线回归，不在测试中依赖变动的网络内容。2026-10-10 验证该站身份为飞飞 CMS，首页 54 条与 9 个栏目；实际 GET 搜索 6 条；动作栏目 42 条，沿实际 hjs1 → hjs2 链接翻页并获得新条目。此结论不推断精确 CMS 版本。

### qiyunzl.cn 探测记录（2026-10-10）

`https://www.qiyunzl.cn/` 与 `https://qiyunzl.cn/` 在手机应用上被报告返回 404，但同一手机浏览器可以正常打开。404 来自 HTTP 层的非成功响应处理，在 HTML 身份与目录解析之前；仅靠调整 CMS 抽取规则不能修复这种响应。

本次执行环境分别使用 Android Chrome 与桌面 Chrome UA 请求两个域名，均取得 HTTP 411 和“恭喜，站点创建成功！”默认页；添加普通浏览器 Accept、Accept-Language 或 Referer 后结果未变。将取得的页面交给当前目录解析器，两者均为 `generic / unsupported`，条目与分类为零，没有真实 CMS 或目录证据。

GitHub Actions 的独立网络也返回相同 HTTP 411 与默认页标题，没有 generator、外部脚本或目录链接，见[临时诊断运行](https://github.com/t59688/newsnook/actions/runs/38050703945/job/114209068236)。取证完成后已移除临时实站请求，常规 CMS CI 不依赖目标网站。

PR #76 修正了原生探测与目录读取 UA 不一致、GET 重定向改写协议及 CI 缺少共享契约构建的问题。上述早期取证未取得真实目录，因此当时未完成实站验证。

后续在 Android 12 模拟器中对照验证：Chrome 能打开两个 HTTPS 域名；同一模拟器、相同规范化 UA 与普通请求头下，CapacitorHttp 返回 403 验证页，现有 OkHttp 原生插件直连返回 200 与真实“看看影院”首页。这证明仅统一 UA 仍不足以兼容该站；没有把服务器的具体判定机制归因于某个未经验证的 TLS 或 Cookie 特征。

订阅探测、目录 GET/POST 与目录详情读取现在显式选择现有 OkHttp 插件，继续遵循用户代理配置、手动重定向和响应预算。该路径按请求启用 WebView CookieManager：读取匹配 URL 的 Cookie，保存响应 Set-Cookie；显式 Cookie 优先，其他插件调用默认不启用，保留独立账号会话的隔离。普通新闻/RSS 拉取继续使用原路径。没有新增生产依赖、存储键或配置格式，也不依赖 NewsNook Cloud。

真实页面缺乏充分引擎身份证据，继续按通用目录解析：识别 `video-pic` 懒加载海报、播放器标记与多个首页分组；搜索页的 `details-info-min` 视频卡片作为完整条目抽取，排除内部演员链接，同名非视频容器仍保留普通文章。最终 cloud 调试 APK 已在模拟器中验证两个域名探测成功、首页 38 个视频条目及封面、电视剧栏目与实际下一页链接、搜索“兰香如故”返回 10 条，以及点击结果后在应用内显示视频详情与剧集入口；未以此宣称完整剧集播放验证。HTTP 状态与内容数量属于此次网络和上游页面状态，不代表站点未来永不改变。
