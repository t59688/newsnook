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

默认静态目录不执行上游 JavaScript；交互式动态目录可使用下文限定的只读渲染快照。不解登录/验证、不猜未暴露的 REST/AJAX 端点。只有动态壳或隐藏接口的站点需要额外可验证的协议适配。新增规则应先加入代表结构与负例，不能用域名单独打补丁。

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


## 导航层级与榜单列表（2026-10-28）

`CatalogProfile.categories` 保留向后兼容，只表示一级站点入口，不再把每页出现的子菜单累积为全站分类。响应级 `CatalogPage.navigation` 包含 `activePrimaryUrl` 与当前页面的子导航 groups；不持久化 HTML、DOM 或整站导航树，不改变备份/同步协议。界面以一级导航与独立子栏目行表达，父子选中状态分别来自最后成功响应，失败请求不会给旧列表贴上新栏目的选中标记。

`navigation.ts` 识别语义导航、模板局部导航容器、嵌套列表归属、当前 URL 和 active/aria-current。实际查询参数完整保留；在查询型子栏目仅标记子项时沿 DOM 祖先追溯父栏目；三级菜单按最近列表分别归属，不覆盖二级父节点。分页、排序、筛选、播放控件及侧栏不进入一级菜单。当前页链接不因 URL 与页面相同而被删除。

页面类型新增 `navigation`：有实际上下文子栏目但无内容条目的页面可以继续浏览，不抛“此页面不是目录”。仅有全站页头、验证码、未知动态空壳或详情页仍使用各自状态。没有猜测接口、自动爬遍子页或新增网络服务。

`collectionStructure.ts` 用相同 URL 的标题与海报寻找最小卡片容器，避免固定某个 CMS 类名；重复编号的纯文本列表同样可构成目录，保持上游顺序。DOM 主抽取与启发式回退共享非内容区域边界，防止侧栏/导航在回退路径重新混入；作者头像/署名等元信息不因图文配对被提升为正文。单条合法海报仍保留。

### 实站与回归证据

Android OkHttp 返回的 qiyunzl 页面：主页 38 条；榜单总页 40 条文字条目；电影、电视剧、动漫、综艺榜单分别 60 条；人气明星页本次响应没有内容条目，保留其真实子导航供继续浏览。旧解析器对总榜、电影榜和电视剧榜均返回 0 条 unsupported。

实际页面资源有 `/zanpian/` 模板、Bootstrap 与 jQuery 特征，可确认赞片系前端模板线索；没有足够证据确定后端语言、产品分支或版本。因此继续使用通用身份与真实页面能力，禁止仅因模板名套用猜测的 CMS API 或将混合内容全部强制标为视频。

新增 13 项结构/会话回归及真实 React UI 流程测试，均经历先失败再通过。独立只读审查发现的查询子菜单、三级归属与作者头像误判已补回归修正。相关 CMS、目录引擎、框架识别、正文、RSS 视频、浏览器、播放器套件及 lint/生产构建通过。模拟器实测主导航 → 榜单 → 电影/电视剧子榜单 → 普通电影栏目 → 重入榜单，数量、两级选中与上下文清理均有响应证据；页面数量以当次上游内容为准，不能等同于所有 CMS/主题实站覆盖。


## 通用 CMS 页面能力引擎（2026-10-28）

这次升级不增加任何站点域名特例，也不把“识别到 CMS”当成已支持其所有操作。静态 HTML 与允许的渲染快照进入同一证据管线：身份先验 → 标准控件/链接分组 → 导航与内容区域 → 可执行请求 → 响应状态验证。

### 结构与接口

- `abilities/semantics.ts` 是覆盖现有全部 `FrameworkId` 的字段别名注册表：17 类 CMS/静态生成器，加努努与未知模板共 19 个入口。身份只解释已出现的字段，不创建搜索接口或猜测筛选 URL。
- `abilities/forms.ts` 按标准表单收集成功控件：GET/POST、重复字段、外部 `form=id` 控件、select/radio/checkbox、多选、禁用控件及 fieldset/legend 例外。选择年份只替换年份字段，保留地区、排序、查询和其他值；搜索同理。
- `abilities/linkControls.ts` 依据最小 DOM 分组、标题语义、真实链接及变化字段推断类型、年份、地区、语言、状态、标签和排序。路径型链接及签名 URL 原样保留，不拼接猜测的路由。分页识别通过区域级缓存避免每个年份选项重复扫描整行。
- `CatalogPage.capabilities` 为响应级纯数据：`controls`、`search`、`nextRequest`、证据和限制原因；页面 HTML/DOM、动态会话字段不持久化。原有 `CatalogProfile` version 1 / rulesRevision 1 仍是安全、向后兼容的能力投影。
- 内容抽取之前先确定控件区域，避免年份数字变页码、排序按钮变分类、筛选表单吞掉内部实际结果。`nav` 中的正常分类入口仍是导航，不因 `Categories` 标签误变筛选。
- `CatalogSession` 以请求方法、地址及请求体标识分页；同 URL 的不同 POST 页独立。下一页严格使用页面声明的链接/提交按钮（包括 `formaction`/`formmethod`），失败保留最后成功内容，重试重放同一请求；刷新历史页替换当前位置，不重复追加。
- `CatalogControls` 使用现有主题和可收起的筛选面板，普通按钮表达单选/多选，选中态来自最后成功响应；忙碌时不提交旧表单状态。排名与实体类型保存在 `CatalogPage.itemMetadata`，不改变 `Article` 或云端同步结构。

### 内容类型与缓存

引擎身份不再将所有条目强制标为视频。视频路由、播放器/封面结构、VideoObject/Movie/TVSeries 等证据逐条判定；人物、明确文章和未知文档不会仅凭影视 CMS 名称进入播放器。详情抽取可在发现实际播放器后提升为视频。排行位置独立于标题，兼容纯文字、海报、嵌套 `ol > li > card` 和 JSON-LD position。

目录版本标记提升为 `catalog-v4`，仅触发既有的无损本地修复：人物/文章等可确定路由修正类型，真实视频保留。保留条目 ID、缓存时间、正文、已读、收藏与阅读位置，不清空离线列表，不新增存储键。未知地址且无足够证据的既有元数据不靠猜测重写。

### 动态页面与执行边界

`useCatalogSession` 的交互式站点浏览允许一次只读渲染快照；默认目录读取、RSS、主信息流与后台预存仍为静态。只有成功 HTTP 响应被识别为动态壳、且请求为 GET，才进入独立 `CatalogSnapshot` WebView；HTTP 错误、验证页和 POST 不通过另一网络栈静默重试。

快照默认 8 秒、最大 10 秒、最多 2 MiB；完整视口离屏渲染，等待内容稳定，克隆实际 input.value、checked、selected。全站导航、aria-busy 和普通 skeleton 不是内容；合法懒加载海报 `.loading` 仍可用。取消、替换、超时、导航代次与 Activity 生命周期统一清理，仅当前请求能返回结果。

该 WebView 不自动点击、提交表单或播放视频，不授权文件、权限、下载和弹窗，不改变 `BrowserHostPlugin`/普通浏览器。无法保持用户配置代理策略时不偷偷直连；JS-only 任意事件、登录/验证码、敏感会话字段和修改型表单不伪装成可重放操作，界面提供原站入口。标准表单中的账户/保存/删除类动作以及缺少只读意图的 POST 不作为筛选。

### 验证与已知边界

- 新增 69 项定向 Node 用例，加真实 React 工作流：19 身份能力契约、随机类名/嵌套变形、组合筛选、GET/POST、搜索、多选、重复字段、安全负例、分页/重试/取消、元数据与实际注入脚本。另补现有目录缓存离线迁移回归。矩阵采用不同结构的原创夹具，不等于每种商业主题都已实站测试。
- 两轮独立只读审查共发现 6 个 Important 问题，均先补失败回归再修正：设置 POST、导航被筛选吞掉、分页 submitter 覆盖、嵌套排行、骨架屏提前就绪、v3 缓存迁移遗漏。
- CMS、目录引擎、框架识别、正文、普通浏览器、播放器、冷启动、共享契约、lint 和 Web 生产构建通过。既有阅读器启动测试缺少 `pageUserAgentForArticle` mock 导出，本次修复测试契约后重跑通过，未修改启动业务。
- Android Cloud/Local 全量原生测试分别 291/293 项，零失败、零错误、零跳过；两种 Java 编译与 Cloud 调试 APK 构建通过。使用运行代码构建包，备份后 `adb install -r`，保留用户数据。
- 模拟器独立 WebView 对受控异步目录验证：延迟渲染后识别 6 条、4 组筛选；重定向、取消、超时及视图清理通过。Chrome 使用实际 SiteScreen/样式的受控上游验证真实鼠标点击和 POST 参数，年份→地区→排序→中文搜索保持组合；412px/360px 无横向溢出。受控服务器、预览壳和截图脚本均未进入产品代码。
- 本次对 qiyunzl 的 4 个外网页面请求均返回 `connection closed`，未取得新 HTML，因此不把旧记录或夹具结果算作本次实站通过。任意自定义 JS 协议、未暴露表单/链接和未验证主题仍需要实际证据；不会承诺任意站点静态解析百分之百成功。

常规命令：`npm run test:cms-capabilities`，已包含在 `npm run test:site-catalog` 中。设计与实施记录：`docs/superpowers/specs/2026-10-28-cms-capability-engine.md`、`docs/superpowers/plans/2026-10-28-cms-capability-engine.md`。
