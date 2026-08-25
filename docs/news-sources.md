# 内置信源探测笔记

> **权威源**：`src/sources/registry.ts`（本文件只记探测结论、坑与落选理由）  
> 列表分页策略与 kind 对应见 `pagingStrategyOf`；正文路径除注明外为「feed 自带全文，否则 Readability 抽 `originUrl`」。  
> 复核基准：2026-08-25

## 1. 分组总览

### 1.1 网易频道（kind `netease`，25 个）

已注册频道的 TID / URL 以 `registry.ts` 为准。未注册（接口返回空列表）：智能、暴雪游戏、彩票。

现行要点：

- 列表 UA 固定 `NewsApp`
- 汽车频道：`/nc/auto/list/5Yac5Zyz/0-20.html`（顶层键是 `list` 而非 TID，解析器按数组键兼容）
- 正文走网易详情接口；图集 / 视频等特殊 `skipType` 按现有解析器处理

### 1.2 中文媒体 / 科普（group `cn` / `tech`）

| id | kind | 探测要点 |
|---|---|---|
| `sspai` `ifanr` `ithome` `geekpark` `solidot` `appinn` `ruanyifeng` `gcores` `pansci` | feed | 标准 RSS/Atom，直接可用 |
| `kr36` | feed | 裸域 `36kr.com` 对无 JS 客户端返回反爬壳；必须用 `www.36kr.com/feed-article` |
| `huxiu` | feed | `rss.huxiu.com`；视频稿适配见 §2 |
| `infoq-cn` | feed | `www.infoq.cn/feed`，默认关闭 |
| `huanqiukexue` | feed | `/feed` 404；WP 默认 query feed `/?feed=rss2` 仍在 |
| `guokr` | guokr | 无 RSS，旧 miniserver JSON 已 404；解析「科学人」列表页，须桌面 UA（移动 UA 404）；只有首页按时间倒序 |
| `zhishifenzi` | feed | 对 Android Chrome UA 返回 500；列表与正文均用桌面 UA |
| `tmtpost` | feed | `/rss.xml` |
| `jazzyear` | jazzyear | 无 RSS（/feed 与 /rss.xml 均 302 → 404 页）；解析首页卡片列表 |
| `latepost` | latepost | 无 RSS；POST `/site/index`（XHR 头 + Referer）；站点证书链不完整，代理需 `secure:false`，正文对 TLS 错误 insecure 回退 |
| `netease-fanpu` `netease-wuli` `netease-diqiu` | netease | 返朴 / 中科院物理所 / 地球知识局：公众号全文同步发布在网易号，走 dy TID 列表接口；正文 `full.html` 偶发 204，由 m/dy 落地页 + Readability 兜底；见 §6 |
| `swarma` `qianhei` | wechat | 集智俱乐部 / 浅黑科技：wechat2rss 镜像，默认关闭由科普 / 科技深度分类与预设启用；见 §6 |

### 1.3 财经快讯 / 盘面（group `cn`）

| id | kind | 探测要点 |
|---|---|---|
| `cls-telegraph` | cls | `get_roll_list` 需按官网前端算法签名（参数排序后 SHA1→MD5）；last_time 游标翻页 |
| `eastmoney-kx` | eastmoney-kx | `getlist_102_ajaxResult_50_{page}_.html`，需 Referer |
| `eastmoney-news` | eastmoney-news | `np-listapi` 按 `page_index` 翻页，需 Referer |
| `wscn-live` | wscn-live | awtmt.com lives 接口，需 Accept + Referer |

### 1.4 国际（group `intl`）

| id | kind | 探测要点 |
|---|---|---|
| `bbc-zh` `bbc-zh-china` `bbc-zh-world` | feed | 简体 RSS 已 301 → 繁体；china/world 旧 index.xml 停在 2011–2014 归档，统一用 `zhongwen/trad/rss.xml` |
| `bbc-world` `bbc-business` | feed | feeds.bbci.co.uk 标准 RSS |
| `gnews-*`（7 个) | google-news | headlines section RSS；跳转链接解码见 `google-news-decode` 测试 |
| `dw-top` | feed | RDF 格式 |
| `scmp-china` `scmp-news` | feed | `/rss/4/feed/`、`/rss/91/feed/` |
| `npr` `guardian-world` `aljazeera` | feed | 标准 RSS |
| `france24` | feed | `/en/rss` 已 301 到 HTML 目录页；用仍返回 `application/rss+xml` 的分区源（asia-pacific） |
| `foreign-affairs` `nyrb` `bloomberg-opinion` `project-syndicate` `sinocism` `theinitium` | feed | 深度长文 / 智库；均标准 RSS，默认关闭 |

### 1.5 科技深度（group `tech`）

| id | kind | 探测要点 |
|---|---|---|
| `arstechnica` `mittr` `verge` `techcrunch` `wired` `quanta` `stratechery` `vitalik` `fabricated-knowledge` `construction-physics` | feed | 标准 RSS/Atom；Substack 系（vitalik 等）feed 自带全文 |
| `paulgraham` | paulgraham | 无 RSS；解析 `articles.html` 静态列表，无真实日期（`hasRealDate=false`） |

> `hn` / `v2ex` 归 **AI 社区栏**（见 §5），不在本表。

### 1.6 AI（group `ai`）

| id | kind | 探测要点 |
|---|---|---|
| `qbitai` `leiphone` `synced` | feed | 标准 RSS |
| `jiqizhixin` | jiqizhixin | 无 RSS；文章库 JSON API（列表摘要，正文取详情 JSON），需 Referer + Accept |
| `aiera` | wordpress | WP 站但 `/feed` 常年 500；走 WP REST `wp-json/wp/v2/posts` |
| `zhidx` | wordpress | 同新智元：`/feed` 500；WP REST 可用，30 条中 29 条 `content.rendered` 全文（2026-08-25 实测） |
| `baoyu` | feed | `baoyu.io/feed.xml`（302 → `s.baoyu.io`，代理跟随正常）；RSS 仅摘要，正文 Readability 抽静态页（Astro，全文在 DOM，实测 1k–5k 字） |
| `oneusefulthing` `understandingai` `latent-space` `thezvi` | feed | Substack，feed 自带全文；`understandingai` 约 2 成付费文截断、回落 Readability；`thezvi` feed 近 2 MB、单篇极长，默认关闭 |
| `openai-news` `google-ai` `deepmind` `huggingface` `pytorch` | feed | 实验室 / 平台一手，标准 RSS/Atom |
| `mittr-ai` `verge-ai` `ieee-ai` `venturebeat-ai` `marktechpost` | feed | 聚焦栏目 RSS |
| `lastweek-ai` `import-ai` `ahead-of-ai` `lil-log` `simonw` `interconnects` | feed | 周报与作者博；Substack/静态站均正常 |
| `arena` | arena | 无官方 RSS；解析官网 Blog 列表页（Sanity 嵌入数据） |
| `anthropic` | anthropic | 无官方 RSS；解析 `/news` 列表页（Sanity）；URL 带尾斜杠会 308，代理 rewrite 不跟随，必须无尾斜杠 |
| `xixiaoyao` `paperweekly` `42zhangjing` | wechat | 公众号解析器；列表过渡数据源为 wechat2rss 镜像 feed（自带全文），缺全文时直连 mp.weixin.qq.com 文章页抽正文；探测与风险见 §4 |
| `uisdc-aigc` | uisdc | 优设 AIGC 标签页，无 RSS；解析归档 HTML + `/page/N` 翻页，正文 Readability；见 §4 |
| `woshipm-ai` | feed | 人人都是产品经理 AI 分类 WP feed，全文；见 §4 |

### 1.7 专栏 / 轻松（group `special`）

| id | kind | 探测要点 |
|---|---|---|
| `zhihu-daily` | zhihu | `news-at.zhihu.com/api/4/news/latest` + `before/{yyyyMMdd}` 游标；域名用 `news-at`，不用 `news.at`；默认关闭 |
| `jandan` | jandan | 官方 `/feed` 对爬虫 403；用 `i.jandan.net` 旧版 JSON API（一次目录） |
| `astral-codex-ten` `marginalian` `aldaily` `theue` | feed | 标准 RSS，默认关闭 |

未注册（确认失效）：豆瓣一刻、锤子阅读、网易背景图接口。

## 2. 虎嗅视频稿适配

虎嗅官方 RSS 的视频稿使用 `<type>video_article</type>`，但 `description`
只包含导语，不提供媒体地址；原文网页又可能返回阿里云访问验证页。因此视频稿不走
通用 Readability，而按文章 URL 中的数字 `aid` 请求：

```text
POST https://api-web-article.huxiu.com/web/article/detail
platform=www&aid={aid}
```

详情响应只作为结构化正文输入，不再枚举 `video_info` 的画质字段。响应内媒体 URL
统一交给 `features/mediaSniffer`，按 MIME/URL/上下文信号评分并保留原始签名参数，
再生成媒体描述交给 `InkVideoPlayer`。Android 上若静态响应没有地址，还可由短生命周期
WebView 观察页面的网络、DOM、MSE 与 DRM 信号；接口或观察失败时继续走原文抽取与
反爬软降级。DRM 资源只标记状态，不进入普通直链播放。

## 3. 深度解读 / 评测补强探测记录（2026-08-25）

背景：AI（文生图、文生视频、LLM、文生音乐）与科技分组里**原始发布类**信源
（实验室官方 blog、发布说明、快讯）偏多，**深度解读 / 评测 / 产品体验**偏少。本轮补强
以「非一手、可站内全文、稳定 feed、中文优先」为筛选标准。

**已收录（6 个，见 §1.6）**：

| id | 定位 | 语言 |
|---|---|---|
| `zhidx` | 智东西：AI 产业深度报道与硬件/产品评测 | 中文 |
| `baoyu` | 宝玉的分享：LLM / Prompt / AI 工程的深度解读与译文 | 中文 |
| `oneusefulthing` | One Useful Thing（Ethan Mollick）：面向普通用户的模型能力实测与使用心得 | 英文 |
| `understandingai` | Understanding AI（Timothy B. Lee）：面向大众的深度解释性报道 | 英文 |
| `latent-space` | Latent Space：AI 工程深度解读与从业者访谈 | 英文 |
| `thezvi` | Don't Worry About the Vase（Zvi）：模型发布后的超长深度评测综述 | 英文 |

英文源占多数的原因：中文 AI 深度解读生态主要在微信公众号内，无稳定 RSS / 可抓取
网页版；以下候选均已实测并落选：

| 候选 | 探测结果 |
|---|---|
| AppSo（爱范儿 AI 产品栏目） | `/app/feed` 302 → 随机文章 HTML；`/category/app/feed` 404，feed 已下线 |
| 归藏 AIGC Weekly（Quaily） | Atom feed 正常（`quaily.com/op7418/feed/atom`），但文章页只 SSR 约 1000 字预览，其余在 PREMIUM 付费墙后，不满足站内全文 |
| Founder Park | 无独立可抓取站点（域名解析失败），内容在微信 |
| Xiaohu.AI | `/feed` 返回 HTML，非 feed |
| 品玩 PingWest | `/feed` 返回 HTML，非 feed |
| SemiAnalysis | `/feed/` 全文 RSS 可用，但付费文章中途截断、阅读体验断裂；且半导体深度已有 `fabricated-knowledge`，暂不收 |
| Every.to / The Batch（deeplearning.ai）/ Artificial Analysis | 均无可用 RSS 端点（探测 404 或返回 HTML） |

验证方式：以上「已收录」6 源均用 `parseSourcePayload` 对线上响应做过端到端解析
（条目数、日期、`contentHtml` 全文判断），`baoyu` 另用 Readability + linkedom 验证了
静态页正文抽取（1k–5k 字，`isSubstantialHtml` 通过）。

## 4. 公众号镜像与社区频道探测记录（2026-08-25）

背景：§3 指出中文 AI 深度解读生态主要在微信公众号内。本轮改走
**第三方镜像 + 自定义解析**路径接入，并补充设计/产品社区频道（体验解读、工具评测、
教程深读），面向「无法亲手玩模型」的读者。

### 4.1 公众号解析器（kind `wechat`；2026-08-26 由 `wechat2rss` kind 升级）

`wechat` 是一等公民 kind（公众号解析器），旧 kind 名 `wechat2rss` 由
`normalizeSourceKind` 归一兼容（旧备份 / 旧自建源无需迁移）。解析器按响应载荷分流，
支持两类列表入口：

- **镜像 feed（内置号的过渡列表数据源）**：wechat2rss 公共实例
  （`https://wechat2rss.xlab.app`，第三方维护，收录约 395 个号）。实例基址集中在
  `registry.ts` 的 `WECHAT2RSS_BASE`，失效或换址只改一处。微信不提供无登录的公众号
  全量文章流（profile_ext 需要会话、搜狗有验证码墙，见 §4.3），故内置三号仍以镜像
  feed 取列表，但解析与正文不再依赖镜像模板。
- **公开合集直连（appmsgalbum）**：`mp.weixin.qq.com/mp/appmsgalbum?action=getalbum
  &__biz=…&album_id=…&f=json`，无登录可访问（2026-08-26 实测数据中心 IP 亦可），
  返回 `getalbum_resp.article_list`（标题 / 原文链接 / 秒级 `create_time` /
  `cover_img_1_1` 封面）。自定义源粘贴合集分享链接时由 `isWechatAlbumUrl` 识别、
  `normalizeWechatAlbumUrl` 归一成 JSON 列表入口（`addCustomSource` 自动定 kind）。
  合集只含作者手工归档的文章，不等于全量文章流。

镜像 feed 结构（2026-08-25 实测）：标准 RSS 2.0，`content:encoded` 自带**完整正文**
（占 feed 体积 98–99%，`<description>` 近乎为空），图片经镜像 `img-proxy` 中转
（绕开 mmbiz.qpic.cn Referer 防盗链）。**信息流与正文分离**（2026-08-25 起）：
`parseWechatMirrorFeed` 只用全文派生摘要（220 字）与封面（首图），随后丢弃
`contentHtml`，列表条目只含元数据；正文一律走下方直连路径按需获取。噪声由
`cleanWechatArticleHtml` 剥离：头部「原创 作者 日期 地点」meta 行、尾部
「跳转微信打开」link-proxy 链接、隐藏的 `<mp-style-type>`（微信编辑器产物，
原文页里同样存在）。传输层实测：实例支持 gzip（2.9MB → 216KB wire）与
`ETag`/`If-None-Match` → 304（条件请求接入为 follow-up），不支持 Range；
名称检索可用实例目录 `/list/all`（77KB，名称 → feed hash 全量锚点）。完整比选
过程见 `docs/superpowers/specs/2026-08-25-wechat-account-stream-research.md`。

直连正文路径（镜像列表条目 / 合集条目 / 旧文缓存被逐出时）：`resolveBody` 抓
`mp.weixin.qq.com` 文章页，由 `extractWechatBodyHtml` 取 `#js_content`
（.rich_media_content）——容器带 `visibility: hidden` 内联样式、图片全部 `data-src`
懒加载（由 `normalizeContentImages` 统一提升并加 `referrerpolicy="no-referrer"`），
标题回填取 `og:title` / `#activity-name`。2026-08-26 实测：`/s/<slug>` 形态文章页
对数据中心 IP 也返回完整 HTML；`/s?__biz=…` 参数形态在数据中心 IP 常返回
`secitptpage/verify` 环境验证壳（无正文），已加入 `isBlockedPublisherHtml` 识别，
命中后走换 UA → 翻译镜像 → 摘要 + 打开原文的既有软降级链。移动端住宅网络通常两种
形态均可正常返回文章 HTML。

首轮收录 4 个；二轮甄选（§5）移除差评，现存 3 个（均默认关闭，由「深读 / 社区」分类与
「极客与 AI」预设承接）：

| id | 公众号 | 定位 | feed 体积 | 备注 |
|---|---|---|---|---|
| `xixiaoyao` | 夕小瑶科技说 | AI 深度解读 + 产品实测，中文 | ~0.7MB | 20 条全部全文（1.7k–4k 字） |
| `paperweekly` | PaperWeekly | AI 论文深读 | ~2.9MB | 刷新流量较大；19/20 条 ≥800 字 |
| `42zhangjing` | 42章经 | AI/创投深度访谈（补 Founder Park 类缺口） | ~0.8MB | 更新频率低（月 2–3 篇），偶有活动帖 |
| ~~`chaping`~~ | 差评 X.PIN | ~~科技/AI 产品评测与体验（大众向）~~ | — | 二轮甄选移除，理由见 §5 |

风险（须知情）：镜像是第三方公益实例，可能限流、下线或调整 URL 结构；收录列表
不可定制（归藏、数字生命卡兹克、Founder Park 等号不在免费列表内）；img-proxy 与
实例同生命周期，实例失效时旧文配图一并失效。

### 4.2 社区频道

**优设 · AIGC（kind `uisdc`，`uisdc-aigc`）**

- 探测：`/feed` 200 但返回首页 HTML（RSS 已禁用）；`/tag/aigc/feed` 与
  `/wp-json/wp/v2/posts` 均 404（WP REST 已关）。只能解析归档 HTML。
- 列表：`https://www.uisdc.com/tag/aigc`，卡片在 `<div class="item-wrap">`，标题链接在
  `h2.item-title`，发布时间在 `i.meta-time`（近一周为「刚刚 / N小时前 / N天前」相对
  日期，需归一；更早为 `YYYY/MM/DD`）；封面为 `image.uisdc.com` 直链。每页 40 条，
  `/tag/aigc/page/N` 上游翻页（109 页，注册表限 20 页）。
- 正文：常规文章页（`/{slug}`）与灵感卡片页（`/group/{id}.html`）由
  `extractUisdcBodyHtml` 抽取（避开 Readability 把 `.uisdc-none` 当隐藏节点、
  以及 group 图集落在 `.group-singular-images` 兄弟节点的问题）；文中「阅读文章」
  相关卡（`.tuwen_link`）会剥离。`<span class="img-zoom">` 包图在排版规整时会解包保留
  `<img>`（不得当空 span 删掉）。图片懒加载 `data-src` 仍由 `normalizeContentImages`
  统一提升。
- 同站其他候选 tag：`/tag/ai绘画`、`/tag/ai视频` 等结构相同，`uisdc` kind 可直接
  复用，暂只注册 AIGC 一个入口避免同站内容刷屏。

**人人都是产品经理 · AI（kind `feed`，`woshipm-ai`）**

- `https://www.woshipm.com/category/ai/feed`：WP 分类 feed 正常，`content:encoded`
  全文（~4.7k 字/篇），含大模型横评、Agent 架构拆解等评测/深读内容。全站 feed
  （`/feed`）混入运营/电商话题，故只收 AI 分类。

### 4.3 落选记录（2026-08-25 实测）

| 候选 | 探测结果 |
|---|---|
| 归藏 AIGC Weekly（重评） | 公众号不在 wechat2rss 免费列表；Quaily 路径维持 §3 结论（SSR 仅 ~1000 字预览 + PREMIUM 付费墙），仍无全文可达路径 |
| 数字生命卡兹克 | 公众号不在镜像免费列表；其 AIHOT（aihot.virxact.com）是资讯聚合平台而非本人文章存档，不能替代公众号长文 |
| Founder Park | 维持 §3 结论：无独立站点，且不在镜像免费列表 |
| 集智俱乐部（镜像可用） | feed 达 5.7MB 且内容偏复杂科学/学术交叉（生物、数学物理），与「AI 产品深度解读/评测」定位不符。**2026-08-25 硬科普轮按科普定位重评后收录（`swarma`），见 §6** |
| Datawhale（镜像可用） | 教程/训练营向，深度解读密度低 |
| 数英 digitaling.com | `/feed` 返回 HTML（无 RSS）；内容偏营销创意案例，AI 深度评测密度低，需专用解析性价比不足 |
| 站酷 zcool.com.cn | 列表页为阿里云 WAF JS 挑战壳（无 JS 客户端拿不到内容），且以作品图集为主非图文长文 |
| sogou 微信搜索 / feeddd / RSSHub 微信路由 | 搜狗验证码墙（2026-08-25 复测：数据中心 IP 拿到的公众号搜索结果页为空壳）；feeddd 项目已停更；RSSHub 公共实例对通用抓取返回 403、微信路由长期不可用——均不满足「稳定公开聚合入口」 |
| profile_ext / homepage（微信官方页） | `mp/profile_ext?action=home` 无会话返回「请在微信客户端打开」；`mp/homepage?f=json` 仅对开通页面模板的号有效（抽样 `ret:5`）——与无账号定位冲突 |
| freewechat.com（自由微信存档） | `profile/<biz>` 可按 biz 直出存档页，但 `?rss` 同为 content:encoded 全文（抽样 3MB）、站内搜索 403；可达性与合规敏感度不适合内置 |

验证方式：新增源均用 `parseSourcePayload`（新 kind 解析器）对线上响应做端到端冒烟
（uisdc 两页 40+40 条、重叠 1 条、日期/封面齐全；4 个镜像与 woshipm 全部条目带真实
日期、全文比例见上表）；优设两类详情页用 Readability + linkedom 验证站内抽取。
单测见 `scripts/community-wechat-sources.test.ts`（`npm run test:community-sources`）。

## 5. 私域信源二轮甄选与 AI 分类分层（2026-08-25）

背景：（1）公众号等私域内容必须真优质、不要凑数；（2）AI 场景预设与分类
应按信息层次分层，启用数量足够但不过多。

### 5.1 甄选标准与抽检方法

- 标准：深度解读 / 横向评测 / 产品体验 / 行业洞察，**不是**搬运官宣、刷屏快讯、
  营销软文；更新节奏稳定；wechat2rss 清洗后正文实质可用；中文优先。
- 方法：对每个候选拉取 feed 最近 12 条，统计正文纯文本长度中位数与 ≥800 字比例，
  逐条判定题材（深度 / 快讯 / 互动帖 / 软文）。

### 5.2 现有私域与社区源结论

| id | 判定 | 依据（最近 12 条抽检） |
|---|---|---|
| `xixiaoyao` 夕小瑶科技说 | **retain** | 中位 2.6k 字、12/12 ≥800 字；「实测扣子桌面端」「连夜实测 DeepSeek V4 Pro，低于预期，不推荐」等一手实测约占半，其余为快讯化解读（偶有「被曝」体标题，已知噪声）；镜像池内中文实测稀缺，保留 |
| `paperweekly` PaperWeekly | **retain**（不进默认预设） | 中位 3.9k 字、11/12 ≥800 字，论文深读题材专一、质量稳定；但学术向 + feed ~2.9MB，留在 **社区**分类按需开启 |
| `42zhangjing` 42章经 | **retain** | 中位 6.8k 字深度访谈/长文（「泡沫的四个必要不充分条件」「Agent 动力学」），月 2–3 篇低频高信噪；3/12 为短活动帖，可接受 |
| `chaping` 差评 | **remove** | 每日固定「今日最佳」「聊一聊」互动帖（51–101 字），题材泛科技吃瓜（速成车 / 东方甄选 / 社会报道），4/12 <800 字；既非 AI 深读也非顶尖评测，注册表整条移除 |
| `uisdc-aigc` 优设 AIGC | retain | AIGC 教程/实测图文 4k–10k 字，「体验解读」价值成立；社区栏首位，默认进入「极客与 AI」预设 |
| `woshipm-ai` 人人PM AI | retain（不进默认预设） | 中位 4.2k 字，含真横评（「横评 GLM-5.3 / DeepSeek-v4-pro / K3」）与 Agent 落地实战；UGC 质量波动、单日可达 6 篇，默认关 |

### 5.3 新候选探测（wechat2rss 免费列表 395 个号全量比对）

免费列表以安全类公众号为主，AI 相关候选有限；逐一实测结论：

| 候选 | 结果 |
|---|---|
| 海外独角兽 / 数字生命卡兹克 / 归藏 / Founder Park / 硅星人 / 张小珺 / 腾讯科技 / 甲子光年（公众号） | 均不在镜像免费列表，无稳定全文入口，无法收录（甲子光年已有官网源 `jazzyear`） |
| 傅盛 | 镜像可用；中位 2.0k 字、12/12 ≥800 字，AI 体验/观点向更新稳定；但篇幅偏短、标题营销腔明显（「干翻」「引爆」「掀翻」），整体弱于现存三源，落选 |
| 机器之心 / 量子位 / 新智元 / 极客公园（镜像） | 与既有站点源（`jiqizhixin` / `qbitai` / `aiera` / `geekpark`）内容重复；量子位镜像另混入每周多条招聘帖，不收 |
| Datawhale（复测） | 教程 + 营销帖（大会门票 / 企业落地班 / 培训生招聘），维持 §4 落选结论 |
| 集智俱乐部（复测） | 中位 6k 字但复杂科学/学术交叉（玻尔兹曼方程推导 18k 字、集智百科 42k 字），与 AI 产品深度定位离题——**不进 AI 分层**；2026-08-25 硬科普轮按科普定位收录进 `science` 分类（见 §6） |
| 我爱计算机视觉 | CV 论文解读向，题材窄且与 PaperWeekly 重叠，落选 |
| 腾讯技术工程 / 阿里技术 | 大厂工程博客，非 AI 深度解读定位，落选 |

### 5.4 AI 分类分层与预设启用集合

- 分类拆四栏（`categories.ts`），信源互斥：
  - `ai`（**源头**：实验室 / 平台官方 + Arena）
  - `ai-media`（**业界**：中英文媒体与 AI 栏目快报）
  - `ai-depth`（**深读**：解读 / 评测 / 周报 / 甄选公众号）
  - `ai-community`（**社区**：优设 AIGC 首位 · V2EX · HN · PaperWeekly · 人人 PM）
  四栏均在 `DEFAULT_HIDDEN_CATEGORY_IDS`（新装默认隐藏，由场景预设或分类管理打开）。
- 「极客与 AI」预设（`presets.ts`）可见顺序：源头 → 业界 → 深读 → 社区 → 科技深度 → 科技 → 科普；
  综合（mix）隐藏。默认启用示例：源头含 OpenAI / Anthropic / Google AI / DeepMind / HF / Arena；
  业界含量子位 / 机器之心 / 新智元 / MIT AI；深读含智东西 / 宝玉 / 夕小瑶 / 42章经 / Mollick / Latent；
  社区含优设 / V2EX / HN。其余 AI 源留在分类中可一键开启。
- 兼容性：老用户已持久化的 `hiddenCategoryIds` 若不含新建栏 id，升级后「业界 / 社区」可能短暂可见，
  可在分类管理隐藏或重新应用预设归位，无数据丢失。`chaping` 移除后，
  `normalizePreferences` / `normalizeSnapshot` 会自动从旧偏好与预设快照中剔除该 id。

## 6. 硬科技 / 科普信源扩充（2026-08-25）

背景：用户点名收录 **集智俱乐部 / 长尾科技 / 地球知识局** 及同档硬科普号。
甄选标准与 §5 不同：本轮要的是**深度科普 / 硬核解读 / 科研进展**（不是 AI 产品评测档），
拒绝营销软文与课程招生刷屏；归属 **科普 `science`**（浅黑科技归科技深度），不进 AI 分层。

### 6.1 收录（5 个）

| id | 源 | 路径 | 抽检（2026-08-25） | 结论 |
|---|---|---|---|---|
| `swarma` | 集智俱乐部 | wechat2rss 镜像（feed ~5.7MB，列表剥离全文兜住） | 20 条中位 4.1k 字、20/20 ≥800 字，最新 2026-08-24；复杂系统 / 统计物理 / AI 交叉深读 | 收录。官网 swarma.org `/feed` 404、`/?feed=rss2` 可用但停更于 2025-10，只能走镜像；默认关（镜像政策），科普分类与「极客与 AI」预设启用 |
| `qianhei` | 浅黑科技 | wechat2rss 镜像（feed ~4.4MB） | 20 条中位 12.1k 字、20/20 ≥800 字；硬科技长文特稿（国产制造 / 安全 / 基础设施），月更 1–2 篇，最新 2026-06-01 | 收录进 **科技深度**。低频大体积默认关，分类内可见 |
| `netease-fanpu` | 返朴 | 网易号 `T1551235486149`（dy TID 列表） | 20 条/页、offset 翻页正常、日更 1–3 篇；脑科学 / 数学 / 物理严肃科普 | 收录。官网 fanpu.cn 域名不可达；默认开（与果壳 / 泛科学等科普源一致） |
| `netease-wuli` | 中科院物理所 | 网易号 `T1479706079278` | 20 条/页、日更；生活物理问答 + 科研进展科普 | 收录，默认开 |
| `netease-diqiu` | 地球知识局 | 网易号 `T1479097401984` | 20 条/页、日更约 1 篇；人文地理科普，正文实测 2k+ 字带图 | 收录，默认开；进「全景门户」科普栏 |

网易号正文路径实测：`c.m.163.com/nc/article/{docid}/full.html` 对地球知识局直接返回 JSON 正文；
返朴 / 物理所偶发 204（既有已知行为，`resolveBody` 注释有记录），
由 `m.163.com/news/article/{docid}.html` 与 `www.163.com/dy/article/{docid}.html` 落地页 +
Readability 兜底（实测正文块 2.4k–10.6k 字），站内全文成立。
新源 id 保持 `netease` 前缀（正文兜底按前缀路由），列表 UA 固定 `NewsApp`。

默认 `enabled` 判断：网易号三源接口与既有网易频道同稳，比照果壳 / 泛科学 / 环球科学 / 知识分子
默认开；两个 wechat 镜像源沿用「第三方镜像默认关，由分类 / 预设启用」的既有政策（§4.1）。
预设挂载：全景门户科普栏 + 地球知识局；「极客与 AI」科普栏 + 返朴 / 物理所 / 集智、
科技深度栏 + 浅黑；「慢读知性」科普栏 + 返朴 / 地球知识局。

### 6.2 落选记录

| 候选 | 探测结果 |
|---|---|
| **长尾科技**（点名） | 技术上不可达：不在 wechat2rss 免费列表；官网 changweikeji.com TLS 证书过期且首页为空壳 SPA（无列表数据）；数据中心 IP 抓 `mp.weixin.qq.com/s?__biz=…` 与合集入口全部命中验证壳，拿不到 `__biz`/`album_id`；freewechat 存档文章页被 Cloudflare 拦截；`mp/homepage` 仅有栏目列表、无日期无合集 id。**兜底**：用户可在微信内复制其公开合集分享链接，走「自定义源」粘贴收录（`isWechatAlbumUrl` 路径） |
| 利维坦 | 网易号可达（`T1466496362808`）但最近 20 条中 6 条为店铺清仓等推广帖，信噪比不足 |
| 星球研究所 | 重心已转视频，无可达的图文全文流 |
| 科学大院 | 无独立网易号（内容经物理所等号转载），缺独立入口 |
| SME科技故事 | 网易 / 搜索均无法定位其原创号，无稳定入口 |
| 小火箭 | 镜像可用但停更于 2020 年底 |
| 空天防务观察 / 方方的航空小筑 / 温哥华的鱼 | 镜像可用但军工 / 防务向 + 转载与推广填充，与科普定位不符 |
| 中科院之声 / 果壳（公众号） / 酷玩实验室 / 丁香医生 / 把科学带回家 / 科研圈 / 赛先生 / 原理 | 均不在 wechat2rss 免费列表，也未找到可编程的网易号 / 官网 feed 入口（果壳已有站点源 `guokr`） |

验证：`npm run test:community-sources`（新源 kind / URL / UA / 默认启用 / 分页策略 / 分类归属断言），
`npm run test:layout-presets`（预设互斥与 mix 重叠不变量）。
