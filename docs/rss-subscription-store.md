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
