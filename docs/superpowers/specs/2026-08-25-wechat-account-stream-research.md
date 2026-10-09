# 公众号「名称/ID → 信息流 + 文字详情」取流方案调研（2026-08-25）

> 调研代理：Cloud Agent（数据中心 IP 环境）。Android 住宅网络的结论引用
> PR #20（`cursor/wechat-mp-parser-e66e`）2026-08-26 真机冒烟记录。
> 本文与 `docs/news-sources.md` §4 互为引用：§4 记「当前生效结论」，本文记
> 完整比选过程与否决理由。

## 0. 结论速览

| 排序 | 路径 | 定位 |
|---|---|---|
| 1 | **wechat2rss 镜像 feed（仅取列表）+ 直连 mp 文章页取正文** | 内置号短期主路径；本轮已实施「列表剥离全文」最小改造 |
| 2 | **公开合集 appmsgalbum JSON 直连** | 自定义源最优轻量列表（20 条 ≈ 14KB）；受作者手工归档限制，非全量流 |
| 3 | 条件请求（ETag/304）与镜像单篇兜底 | follow-up，见 §6 |
| ✗ | 搜狗微信、profile_ext、RSSHub 公共实例、freewechat、自建服务 | 均否决或仅作应急/文档备选，理由见 §3 |

「按名称订阅」没有免登录的全网入口（§5）；可达的近似是
**镜像目录内名称检索**（wechat2rss `/list/all`，约 395 号）与**用户粘贴合集/文章
分享链接**（biz 提取，已在 kind `wechat` 实现合集链接识别）。

## 1. 需求与硬约束

- 输入是「公众号名称 / 微信号 / biz / 合集 ID / feed hash」中任意一种，输出：
  ① 轻量信息流（标题、链接、时间、封面，**不含全文**）；② 站内可读的文字正文。
- 硬约束：Backendless（无自建 API）、站内全文、本地持久化、Android WebView
  客户端直连（Web 生产走 Cloudflare 边缘代理 = 数据中心 IP）。
- 本轮新增强制约束：**信息流与正文分离**——列表拉取不得携带全文；正文点击/预取
  时按需 `resolveBody`，复用 `bodyCache` 预算与 pin。

## 2. 候选路径打表

打分维度：A 账号定位方式 · B 列表轻量性 · C 正文二次获取 · D 稳定性/风控 ·
E 硬约束契合 · F 「按名称订阅」支持。

### 2.1 wechat2rss 第三方镜像（现内置路径）

- **A**：feed hash（不可由名称/biz 本地推导，sha1 候选均不匹配；只能查实例目录
  `/list/all`，77KB HTML，name → hash 锚点可解析，收录约 395 号）。
- **B**：差——原始 feed 0.7MB～2.9MB（20 条），`content:encoded` 占 **98–99%**
  体积；`<description>` 近乎为空（20 条合计 <1KB）。传输层缓解：支持 gzip
  （2.9MB → 216KB wire）、支持 `ETag`/`If-None-Match` → 304（未变化时近零流量）；
  **不支持 Range**（返回 200 全量）。剥离全文后剩余元数据仅 ~9–14KB。
- **C**：条目链接为 `/s?__biz=…` 形态 → 数据中心 IP 会被 302 到验证页（见 §4），
  住宅 IP（Android 真机）通常可直取 `#js_content`；镜像无单篇端点，但**重拉整个
  feed（216KB gzip）可作单篇兜底**（follow-up）。
- **D**：第三方公益实例（Cloudflare 前置），可能限流/下线/换址；img-proxy 与实例
  同生命周期。
- **E**：契合（纯客户端 GET；实例基址集中在 `WECHAT2RSS_BASE` 一处）。
- **F**：目录内可按名称检索；目录外的号（归藏、Founder Park 等）无解。

### 2.2 微信公开合集 appmsgalbum JSON

- **A**：需要 `__biz` + `album_id`（来自用户粘贴的合集分享链接；仅名称无法定位）。
- **B**：优——`f=json` 20 条 ≈ **13.8KB**，字段：`title` / `url` /
  `create_time`（unix 秒）/ `cover_img_1_1`；正文不随列表下发。支持
  `begin_msgid` + `begin_itemidx` 翻页（`continue_flag`），第二页 10 条 ≈ 6.5KB。
- **C**：同 2.1 的直连 mp 文章页路径。
- **D**：官方端点、无验证壳（2026-08-25 数据中心 IP 实测 ret=0 正常返回）；
  但**内容为作者手工归档**，非全量流，且作者可下架/改名。
- **E**：完全契合（已在 kind `wechat` 落地：`isWechatAlbumUrl` /
  `normalizeWechatAlbumUrl` / `parseWechatAlbum`）。
- **F**：不支持名称订阅；靠用户从微信分享合集链接。

### 2.3 搜狗微信搜索

- **A**：理论上名称 → 账号页；实测数据中心 IP 拿到的公众号搜索结果页是**空壳**
  （标题正常、无任何结果条目与跳转链），历史行为还有验证码墙与一次性跳转链
  （`/link?url=` 带时效签名）。
- **B/C**：即便命中，结果页只给最近 10 篇且链接是临时签名形态，不可持久化为
  `originUrl`。
- **D**：差；反爬策略随时变化，客户端直连极不稳定。
- **E/F**：名义上最接近「按名称订阅」，实际可用性不足以承载产品路径。**否决**
  （维持 `docs/news-sources.md` §4.3 结论）。

### 2.4 profile_ext / 历史消息页（微信官方 HTML/XHR）

- 实测 `mp/profile_ext?action=home&__biz=…` 无会话时返回 2KB「请在微信客户端
  打开」提示页；带会话的 XHR 翻页（`action=getmsg`）依赖微信客户端 Cookie
  （key/uin/pass_ticket），无法在无账号前提下获得。**否决**：与「无账号」定位
  冲突，且属于灰区接口，风控与封禁风险高。
- 附注：`mp/homepage?__biz=…&f=json` 仅对开通「页面模板」的号有效（抽样返回
  `ret:5`），不通用。

### 2.5 RSSHub 微信路由

- 公共实例 `rsshub.app` 已对通用抓取返回 403（“testing purposes only,
  self-host for production”，2026-08-25 实测）；微信相关路由长期依赖第三方数据源
  （feeddd 已停更等），可用性差。
- 自托管 RSSHub 与 Backendless 冲突，不能作为内置路径；仅可在用户文档中作为
  「自托管进阶玩法」提及（自定义源本就支持任意 RSS URL，无需改代码）。**否决
  （内置）／可选（自托管文档）**。

### 2.6 freewechat（自由微信，GreatFire 系存档）

- `freewechat.com/profile/<biz>` 可按 biz 直出账号存档页（抽样 122KB，含
  `/a/<biz>/<mid>` 文章链接），`?rss` 输出 RSS——但同样是 **content:encoded 全文
  3MB**（与镜像同病）；站内搜索接口对本环境 403。
- 定位是抗审查存档站，在目标用户群的网络环境下可达性波动大，且引用该站作为内置
  数据源会给应用带来不必要的合规敏感度。**否决（内置）**；仅作单篇应急镜像的
  已知选项记录（不写入代码）。

### 2.7 自建 wechat2rss / 采集服务

- 与 Backendless 硬约束直接冲突，**否决**。自托管者可把自建实例 URL 填进
  自定义源（kind `wechat` 对镜像 feed 的解析与实例无关），无需为此改代码。

## 3. 否决汇总

| 路径 | 否决理由（一句话） |
|---|---|
| 搜狗微信 | 数据中心 IP 空壳/验证码墙、结果链接带时效签名，不可持久化 |
| profile_ext / getmsg | 需微信客户端会话，与无账号定位冲突，风控高 |
| RSSHub 公共实例 | 403 拒绝通用抓取；微信路由上游长期不可用 |
| freewechat | 全文 RSS 同样超重；可达性与合规敏感度不适合内置 |
| 自建服务 | 违反 Backendless |

## 4. 实测记录（2026-08-25，云端数据中心 IP）

抽样命令均为普通 HTTP GET（Android Chrome UA），不含任何登录态。

| 探测点 | 结果 |
|---|---|
| `wechat2rss.xlab.app/feed/a1cd…a34d.xml`（夕小瑶） | 200，700,875 B，20 条，`content:encoded` 占 98%，`<description>` 合计 187 B |
| `…/feed/3be8…a563.xml`（PaperWeekly） | 200，2,900,958 B，20 条，全文占 99%；gzip 后 wire 215,742 B |
| 同 URL + `If-None-Match`（原样 ETag） | **304**，0 B——镜像支持条件请求 |
| 同 URL + `Range: bytes=0-4095` | 200 全量——不支持 Range |
| `wechat2rss.xlab.app/list/all` | 200，77KB HTML，锚点含「名称 → /feed/<hash>.xml」全量映射 |
| `mp/appmsgalbum…f=json`（看理想·李想主义合集） | 200，13,820 B / 20 条，`ret=0`，字段齐（title/url/create_time/cover_img_1_1），`continue_flag=1` |
| 同端点 + `begin_msgid`/`begin_itemidx` | 200，6,563 B / 10 条——翻页可用 |
| mp 文章页 `/s?__biz=…`（feed 条目链接形态） | 302 → `mp/wappoc_appmsgcaptcha` 验证页（无正文）；与 PR #20 记录一致 |
| mp 文章页 `/s/<slug>` | 200，3.1MB HTML，`#js_content` 与 `og:title` 在，无验证壳——数据中心 IP 亦可读 |
| `weixin.sogou.com/weixin?type=1&query=…` | 200 但结果区为空壳（无条目、无跳转链） |
| `mp/profile_ext?action=home&__biz=…` | 200，2KB「请在微信客户端打开」 |
| `mp/homepage?__biz=…&f=json` | `{"base_resp":{"ret":5}}`——仅开通页面模板的号可用 |
| `rsshub.app/wechat/…` | 403（公共实例限制通用抓取） |
| `freewechat.com/profile/<biz>` | 200，122KB 存档页；`?rss` 3,054,680 B 全文 RSS；`/search` 403 |

风控相关只记录现象（验证页/空壳/403），不展开绕过手段。

## 5. 「名称/ID → 流」缺口说明

微信不提供免登录的「名称 → biz → 文章流」公开链路；搜狗是唯一名义入口且已实测
不可用。产品上「按名称订阅」只能做到：

1. **镜像目录内检索**（follow-up，可选）：拉 `/list/all`（77KB，可日缓存），
   客户端模糊匹配名称 → feed hash → 即刻订阅。覆盖约 395 号，命中率有限但零后端。
2. **粘贴合集链接**（已实现）：微信内「合集 → 分享」链接粘贴进自定义源，
   `addCustomSource` 自动识别 kind `wechat` 并归一为 JSON 列表入口。
3. **粘贴文章链接**（follow-up，可选）：文章页内嵌 `appmsgalbuminfo` 变量，若该文
   属于合集可发现 `album_id` 反推列表入口；不属于任何合集的号仍无解。
4. feed hash 无法本地推导（对名称/微信号/biz 的 sha1/md5 均不匹配目录值），
   必须查目录，不要试图在客户端「算」出 hash。

## 6. 强制约束落地：信息流与正文分离

现状核对（kind `wechat`，PR #20 分支）：

- 列表**持久化**层已安全：`storage.ts` 的 `compactCachedArticle` 写缓存前一律剥离
  `contentHtml`（读取旧缓存时也原位压缩）。
- 但**解析层**仍把 `content:encoded` 全文放进内存态 `Article` 并作为正文主路径
  （`resolveArticleBody` 的 `bodySource: 'feed'` 短路），单源会话内存滞留最高
  ~2.9MB，与「列表只拿元数据」相悖。

本轮最小改造（随本 PR 实施）：

- `parseWechatMirrorFeed` 在派生摘要（220 字）与封面（首图，img-proxy URL）后
  **丢弃 `contentHtml`**；列表条目只剩元数据。
- 正文统一走既有按需路径：`resolveBody` 直连 mp 文章页 →
  `extractWechatBodyHtml`（`#js_content`）→ 验证壳时软降级；读过的文章由
  `bodyCache`（约 3MB 预算 + 稍后读 pin）承接，重开不再请求。
- 合集列表（`parseWechatAlbum`）本就不带正文，无需改动。

代价与缓解：

- 打开文章从「零等待（feed 全文）」变为「按需网络」——与网易/知乎等多数内置源
  行为一致；稍后读预取（`App.tsx` 的 `prefetchBody`）与 bodyCache 缓解重复请求。
- Web 生产（边缘代理 = 数据中心 IP）对 `/s?__biz=` 形态命中验证壳的概率高，剥离
  后该环境的公众号正文可达性下降，走摘要 + 打开原文兜底；Android（产品主体）
  住宅网络不受影响。

Follow-up（按优先级，不在本 PR 内）：

1. **feed 刷新条件请求**：`lib/http.ts` 记录 `ETag` 并带 `If-None-Match` 重访，
   304 时复用列表缓存。镜像已支持；对所有 RSS 源普适（thezvi 2MB 等同样受益）。
   需评估 CapacitorHttp 与边缘代理的透传。
2. **镜像单篇兜底**：直连 mp 命中验证壳时，重拉该源镜像 feed（gzip ~216KB）在
   内存中摘出目标条目的 `content:encoded` 作正文（不落列表缓存）。主要救 Web
   生产环境。
3. **目录内名称检索**（§5.1）与**文章链接反推合集**（§5.3）。
