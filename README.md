# NewsNook（有所闻）

<p align="center">
  <strong>一个本地优先、开箱即用、可自由扩展的信息聚合与阅读平台。</strong>
</p>

<p align="center">
  新闻、RSS、Web / CMS 站点与独立内容社区，在一个干净、可控的阅读体验里汇合。
</p>

<p align="center">
  <a href="https://github.com/t59688/newsnook/releases"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/t59688/newsnook?style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/t59688/newsnook?style=flat-square"></a>
  <a href="https://github.com/t59688/newsnook/issues"><img alt="GitHub Issues" src="https://img.shields.io/github/issues/t59688/newsnook?style=flat-square"></a>
  <img alt="Android" src="https://img.shields.io/badge/platform-Android-3DDC84?style=flat-square&logo=android&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="PRs Welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square">
</p>

<p align="center">
  <a href="#为什么是-newsnook">为什么是 NewsNook</a> ·
  <a href="#功能">功能</a> ·
  <a href="#安装">安装</a> ·
  <a href="#开发">开发</a> ·
  <a href="#架构">架构</a> ·
  <a href="#贡献">贡献</a>
</p>

---

## NewsNook 是什么

NewsNook（有所闻）不是单一的 RSS 阅读应用，也不是传统的新闻客户端。

它希望成为一个**属于用户自己的信息入口**：安装后即可阅读内置新闻与专题，也可以继续加入自己的 RSS / Atom / JSON Feed，接入可识别的 Web / CMS 目录站点，并通过独立站点工作区使用知乎等内容社区。

这些不同来源最终汇入同一套阅读能力：全文阅读、图片与视频、翻译、AI 速读、稍后读、历史、本地搜索、离线缓存、分享与可选同步。

> NewsNook 不生产、不托管新闻正文，也不以广告、云端画像或停留时长驱动内容分发。  
> 你决定看什么，应用负责把内容整理好、读顺、保存到自己的设备里。

### 一眼看懂

| 能力 | NewsNook |
| --- | --- |
| 安装后直接阅读 | 内置新闻源、主题分类与场景预设 |
| 自建订阅 | RSS 2.0 / Atom / RDF / JSON Feed / OPML |
| Web 站点 | 通用目录抽取与框架识别 |
| CMS | MacCMS、WordPress、Hugo、Hexo、Ghost 等 |
| 独立站点工作区 | 当前包含知乎工作区 |
| 正文 | 站内全文、Readability 与站点定制抽取 |
| 多媒体 | 图片、音频、Progressive / HLS / DASH、自定义播放器 |
| 投屏 | DLNA |
| 翻译 | 云端翻译、AI 翻译、Android 本地翻译、Bergamot |
| AI | OpenAI-compatible Provider、AI 速读 |
| 本地能力 | 稍后读、历史、搜索、推荐、缓存、阅读位置 |
| 同步 | 可选账号，仅同步配置域；阅读数据保持本地 |
| 当前主要平台 | Android |

---

## 为什么是 NewsNook

今天的信息通常散落在新闻站、RSS、博客、独立网站、内容社区和视频页面里。问题往往不是“没有内容”，而是需要在大量 App、网页和算法信息流之间不断切换。

NewsNook 尝试提供另一种方式。

### 开箱即用，而不是从空白开始

第一次安装不需要先找 RSS 地址。

项目内置新闻、科技、AI、商业、国际、深度阅读等来源与场景预设，可以直接阅读；之后再逐步调整成自己的信息结构。

### 开放订阅，而不是锁在一个内容池里

标准 Feed 是一等公民。你可以添加 RSS / Atom / JSON Feed，也可以通过 OPML 从其它阅读应用迁入或导出。

NewsNook 不要求内容必须来自项目维护者预先登记的来源。

### 不止 RSS

很多网站没有 Feed，或者 Feed 只提供很少的信息。

NewsNook 因此提供 Web Catalog 与 CMS 框架识别能力，可从网页目录中识别分类、分页、搜索和内容卡片。目前代码中包含 MacCMS、WordPress、Hugo、Hexo、Ghost 等框架适配，以及通用的目录提取路径。

### 独立站点可以拥有真正的工作区

复杂内容社区不适合强行塞进 RSS 模型。

NewsNook 为此提供独立站点工作区架构。当前的知乎工作区拥有自己的导航、信息流、搜索、问题与回答、评论、用户、话题、收藏及账号相关模块，与普通新闻源互不污染。

部分账号私有或写入能力依赖上游协议、登录状态和当前实网验证情况；不可用时会降级，而不会把未验证能力伪装成稳定功能。协议边界见 [知乎协议矩阵](./docs/zhihu-protocol.md)。

### 本地优先，而不是云端优先

阅读历史、正文缓存、稍后读、已读状态与阅读位置首先属于设备本身。

账号不是使用门槛。云同步是可选能力，并与内容阅读解耦；即使不登录、云端不可用或网络中断，已经保存到本地的阅读能力仍然存在。

### 推荐可以有，但不应该成为黑箱

NewsNook 没有云端“猜你喜欢”信息流。

项目包含可关闭的**本地推荐**：只在设备上根据用户自己的已读行为，对当前启用来源中的内容进行重排，不上传阅读画像，也不替代用户配置的分类与来源。

实现说明见 [本地推荐](./docs/local-recommend.md)。

---

## 界面

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/screenshots/home.jpg" alt="首页信息流" />
      <br />
      <sub>开箱即用的信息流</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/bilingual.jpg" alt="双语阅读" />
      <br />
      <sub>正文翻译与双语阅读</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/screenshots/scenes.jpg" alt="场景预设" />
      <br />
      <sub>一键切换阅读场景</sub>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img src="docs/screenshots/categories.jpg" alt="分类与信源" />
      <br />
      <sub>分类与信源管理</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/appearance.jpg" alt="外观设置" />
      <br />
      <sub>外观与阅读偏好</sub>
    </td>
    <td align="center">
      <img src="docs/screenshots/home-dark.jpg" alt="深色模式" />
      <br />
      <sub>夜间阅读</sub>
    </td>
  </tr>
</table>

> 截图会随版本演进；实际界面以当前 Release 为准。

---

## 功能

### 1. 开箱即用的新闻与信息流

- 内置中文与国际新闻、科技、AI、商业、深度内容等来源
- 分类化信息流
- 场景预设，一键切换整套分类与信源组合
- 单一信源浏览
- 收藏信源与分类内快速筛选
- 上拉加载、下拉刷新与分页
- 本机阅读画像驱动的可选本地推荐
- 列表外文标题翻译

NewsNook 的内置源并不意味着封闭内容池。它们只是默认配置，你可以关闭、重组或用自己的来源替换。

### 2. RSS / Atom / JSON Feed

- RSS 2.0
- Atom
- RDF
- JSON Feed
- 自定义订阅
- OPML 导入与导出
- 自定义分类
- 自定义源参与普通信息流、场景和本地能力
- 通用正文抽取与失败降级

对于付费墙、强反爬、登录后内容或只返回摘要的 Feed，NewsNook 不承诺绕过来源站限制。

### 3. Web Catalog 与 CMS

对于没有标准 Feed 的站点，NewsNook 可以探测网页目录并建立站点型来源。

当前代码包含 MacCMS、SeaCMS、WordPress、Hugo、Hexo、Ghost 等框架探测与适配，同时保留通用目录解析路径。相关能力包括：

- 目录卡片提取
- 分类发现
- 分页规则
- 站内搜索模板
- 排序能力
- 详情页解析
- 媒体发现

框架识别只是帮助客户端理解公开页面结构，不代表绕过站点认证、授权、地区限制、付费机制或 DRM。

### 4. 知乎工作区

知乎不是被当成一个普通 RSS 源，而是独立工作区。

当前架构包含：

- 公共推荐 / 信息流
- 问题与回答阅读
- 回答间导航
- 评论
- 搜索
- 用户页
- 话题
- 收藏相关界面
- 通知与会话相关模块
- 编辑器与本地草稿
- Android 第一方 WebView 登录流程
- 多账号本地状态隔离
- 独立缓存、导航栈与存储域

知乎上游协议可能变化，账号私有和写操作能力也需要对应授权与实网验证。NewsNook 会按能力矩阵启用或禁用相关操作，而不是假设所有接口永久可用。

详细设计见 [知乎协议矩阵](./docs/zhihu-protocol.md)。

### 5. 阅读页

统一阅读页负责把不同来源变成一致的阅读体验：

- 标题、来源、时间、正文和图片
- Readability 与来源定制正文抽取
- 阅读位置记忆
- 字号、字体、行高、段距、首行缩进
- 深色模式
- 墨水屏模式
- 分页阅读
- 图片放大、保存与分享
- 评论 / 跟贴入口
- 原文核对
- 正文重新抽取
- 站内分享链接

完整阅读过的正文可以保存在本机，在没有网络时继续回看。

### 6. 视频、音频与媒体发现

NewsNook 不把文章限制为纯文本。

媒体能力包括：

- Progressive Media
- HLS
- DASH
- 页面静态媒体识别
- Android 原页运行时媒体发现
- 通用 Media Sniffer
- 自定义视频播放器
- 播放进度与倍速
- 横竖屏全屏
- 双击、长按、滑动、缩放等播放器手势
- DLNA 投屏
- 部分音频 / 播客内容

媒体发现只使用当前页面会话能够公开产生的资源信息。DRM、会员、登录、地区限制和服务端授权仍由来源站决定。

媒体实现和边界见 [媒体嗅探文档](./docs/sniffer.md)。

### 7. 翻译

支持正文和信息流标题翻译。

在线能力：

- Google
- Azure
- DeepL
- DeepLX
- OpenAI-compatible AI 翻译

本地能力：

- Android ML Kit
- Bergamot Translator

正文支持仅译文与原文 + 译文对照两种主要阅读方式。

API Key 由用户自行配置并保存在本机，客户端直接访问用户选择的服务。

### 8. AI 阅读能力

NewsNook 将 AI 作为可选阅读工具，而不是内容入口的控制器。

当前项目包含 OpenAI-compatible Provider 配置和 AI 速读等能力。用户可以使用自己的模型服务地址、Key 和模型，不需要把阅读体验绑定到某一家 AI 服务。

### 9. 本地资料库

- 稍后读
- 最近阅读
- 已读状态
- 阅读位置
- 正文缓存
- 列表缓存
- 本地搜索
- 本地推荐
- 配置备份与恢复

本地搜索只搜索设备已经拥有的数据，不需要把私人阅读记录上传到搜索服务器。

### 10. 可选账号与同步

登录不是使用 NewsNook 的前提。

云同步用于同步适合跨设备共享的配置，例如订阅、分类和应用设置。正文、缓存、稍后读、已读状态与阅读位置不作为普通云同步内容上传。

云端实现见 [Cloud 部署说明](./docs/cloud-deploy.md)。

---

## 隐私与产品原则

NewsNook 的设计遵循几个明确原则：

1. **本地优先**  
   阅读行为和缓存首先保存在设备上。

2. **账号可选**  
   不注册账号也能完成核心阅读流程。

3. **用户选择来源**  
   内置源、自定义 Feed、站点和场景都可以由用户控制。

4. **无广告驱动**  
   项目本身不依赖广告信息流来提高停留时长。

5. **无云端阅读画像推荐**  
   可选推荐在本机完成，不上传阅读画像。

6. **不托管第三方内容库**  
   内容来自原发布方，NewsNook 负责获取、解析和本地呈现。

7. **尊重来源站权限边界**  
   不承诺绕过登录、付费墙、DRM、地区限制或其它访问控制。

更多法律与责任边界见 [法律与声明](./docs/legal.md)。

---

## 安装

### Android

当前正式面向用户的平台是 Android。

前往 **[GitHub Releases](https://github.com/t59688/newsnook/releases)** 下载最新 APK 安装即可。

项目提供两个构建变体：

| 变体 | 适合谁 | 说明 |
| --- | --- | --- |
| cloud | 大多数用户 | 体积更小；使用在线 / AI 翻译 |
| local | 需要本地翻译的用户 | 包含 ML Kit / Bergamot 等本地翻译能力，安装包更大 |

两个变体使用相同应用身份，可以按需要覆盖切换。实际 APK 大小与 ABI 支持请以对应 Release 说明为准。

> Android 安装第三方 APK 时，系统可能要求允许当前浏览器或文件管理器“安装未知应用”。

### 应用内更新

Android 版本包含应用更新检测与下载安装流程。发布渠道和下载地址以项目当前 Release / 更新配置为准。

---

## 开发

### 技术栈

- React 19
- TypeScript
- Vite
- Capacitor 8
- Android
- Tailwind CSS
- Mozilla Readability

建议准备 Node.js、npm；Android 开发还需要 Android Studio / Android SDK 与 JDK。

### 本地运行

~~~bash
git clone https://github.com/t59688/newsnook.git
cd newsnook

npm install

# Web 开发服务器
npm run dev
~~~

### 构建

~~~bash
# Web / 前端生产构建
npm run build

# 静态检查
npm run lint
~~~

### Android

~~~bash
# 轻量版
npm run android:run

# 完整本地翻译版
npm run android:run:local
~~~

如果需要 Bergamot 原生翻译能力，请先按 Android 构建文档准备对应依赖。

完整说明见 [Android 构建与调试](./docs/android-build.md)。

### 测试

仓库在 scripts/ 中维护大量按模块划分的回归测试，覆盖 Feed、缓存、翻译、媒体、分享、同步、CMS 框架识别、知乎等能力。

可用测试命令以 package.json 中的 test:* scripts 为准。提交改动前，请至少运行与你修改模块对应的测试，并执行：

~~~bash
npm run lint
npm run build
~~~

---

## 架构

NewsNook 的核心不是某一种 Feed 协议，而是一条统一的“内容进入 → 规范化 → 阅读”管线。

~~~mermaid
flowchart LR
    A["内置新闻源"] --> F["获取 / 解析"]
    B["RSS / Atom / JSON Feed"] --> F
    C["Web / CMS Catalog"] --> F
    D["独立站点工作区"] --> W["站点专属能力"]

    F --> N["统一 Article / Source 模型"]
    N --> L["信息流 / 分类 / 场景"]
    N --> R["统一阅读页"]

    W --> R

    R --> M["图片 / 视频 / 音频 / DLNA"]
    R --> T["翻译 / AI 速读"]
    R --> P["稍后读 / 历史 / 搜索 / 缓存"]

    S["本地 Preferences"] --> L
    S --> R

    O["可选 Cloud Sync"] -. "仅配置域" .-> S
~~~

### 代码结构

~~~text
newsnook/
├─ src/
│  ├─ components/          通用 UI 与播放器组件
│  ├─ features/            独立业务能力
│  │  ├─ zhihu/            知乎工作区
│  │  ├─ mediaSniffer/     媒体发现
│  │  ├─ frameworkDetect/  CMS / 框架识别
│  │  ├─ catalogEngine/    Web Catalog 提取
│  │  ├─ translation/      翻译
│  │  ├─ sync/             同步
│  │  └─ ...
│  ├─ lib/                 Feed、正文、缓存、分享等基础能力
│  ├─ screens/             页面级 UI
│  └─ sources/             Source / Category / Preset 注册与偏好
├─ android/                Capacitor Android 工程
├─ cloud/                  可选账号与配置同步服务
├─ functions/              边缘函数 / Web 能力
├─ scripts/                测试、构建和维护脚本
└─ docs/                   设计、架构和开发文档
~~~

更完整的模块边界、数据流和状态模型见 [架构文档](./docs/architecture.md)。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [用户指南](./docs/user-guide.md) | 面向使用者的功能说明 |
| [架构](./docs/architecture.md) | 应用分层、数据流、状态模型 |
| [新闻源](./docs/news-sources.md) | 内置来源与解析说明 |
| [Android 构建](./docs/android-build.md) | Android 环境、签名、调试与发版 |
| [Cloud 部署](./docs/cloud-deploy.md) | 可选同步服务 |
| [本地推荐](./docs/local-recommend.md) | 本地推荐算法与隐私边界 |
| [媒体嗅探](./docs/sniffer.md) | 媒体发现、播放器与能力边界 |
| [知乎协议](./docs/zhihu-protocol.md) | 知乎能力矩阵与验证状态 |
| [与 FreshRSS 的差异](./docs/vs-freshrss.md) | 产品定位比较 |
| [安全策略](./SECURITY.md) | 安全问题报告方式 |
| [贡献指南](./CONTRIBUTING.md) | 开发与提交约定 |
| [法律与声明](./docs/legal.md) | 第三方内容、责任与许可说明 |

---

## NewsNook 不是什么

为了避免误解，以下并不是项目目标：

- 不是第三方内容的镜像站或托管平台
- 不是靠广告和用户画像运营的信息流产品
- 不是用于绕过付费、登录、DRM 或地区限制的工具
- 不是保证任意网站永远可解析的通用爬虫
- 不是必须部署服务端才能使用的阅读应用
- 不是只支持 RSS 的传统订阅器

NewsNook 更像一层位于“信息来源”和“用户阅读”之间的个人阅读基础设施。

---

## 项目状态

NewsNook 仍在持续演进。

由于大量能力直接依赖第三方公开接口、Feed、网页结构或 WebView 行为，上游变化可能造成某个来源或站点功能暂时失效。项目会通过解析器、能力探测、缓存和降级路径尽量隔离单点故障，但不会对第三方长期可用性作保证。

如果你发现某个来源失效，请提交 Issue，并尽量附上：

- NewsNook 版本
- Android 版本与设备型号
- 来源 / 站点名称
- 文章或页面 URL
- 截图或日志
- 可复现步骤

---

## 贡献

欢迎 Issue 和 Pull Request。

你可以参与：

- 修复失效来源
- 增加新的公开 Feed 或站点适配
- 改进正文抽取
- 提升 CMS / Catalog 兼容性
- 完善知乎工作区
- 改进视频与媒体体验
- 改进翻译与 AI 阅读
- 优化 Android / Web UI
- 补充测试与文档

开始之前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

对于较大的功能，建议先创建 Issue 说明目标、交互和技术方向，避免重复实现或与现有架构冲突。

---

## 安全

请不要通过公开 Issue 披露敏感漏洞、凭据或可用于攻击真实服务的细节。

安全问题请按照 [SECURITY.md](./SECURITY.md) 中的流程报告。

API Key、登录凭据、签名文件和其它秘密信息不应提交到 Git 仓库。

---

## 开源许可

NewsNook 采用 **GNU Affero General Public License v3.0 or later（AGPL-3.0-or-later）** 开源。

详见：

- [LICENSE](./LICENSE)
- [NOTICE](./NOTICE)

NewsNook 的开源许可只覆盖本项目自身代码，不改变第三方文章、图片、视频、商标、网站或接口的权利归属。

---

## 致谢

NewsNook 建立在大量优秀的开源项目与开放标准之上，包括但不限于：

- React
- Vite
- TypeScript
- Capacitor
- Tailwind CSS
- Mozilla Readability
- Bergamot Translator

也感谢所有提供公开 Feed、开放接口、技术文档和兼容性反馈的社区与内容发布者。

特别感谢 [LINUX DO 社区](https://linux.do/) 对开源交流、技术讨论与社区反馈的支持，也感谢社区用户对 NewsNook 的关注与建议。

### 友情链接

- [LINUX DO](https://linux.do/)

---

## 支持项目

NewsNook 是一个免费、开源的个人项目。

如果它对你有帮助，可以：

- 给仓库一个 Star
- 提交 Bug 与兼容性反馈
- 改进文档
- 贡献代码
- 向其他需要本地优先阅读工具的人推荐它

也可以通过爱发电支持项目的持续维护：

[![爱发电](https://img.shields.io/badge/爱发电-支持_NewsNook-946CE6?style=for-the-badge)](https://ifdian.net/a/t59688)

赞助完全自愿，不影响软件功能、版本获取或社区参与。

---

<p align="center">
  <strong>NewsNook · 有所闻</strong><br />
  <sub>把分散的信息，带回自己的阅读空间。</sub>
</p>
