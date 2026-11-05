# RSS 本地目录与 R2 发布

依据用户引用的「查找高质量RSS订阅」设计历史，在本地 beta 实现。

- 目录独立于 Feedly 在线检索、网址/RSSHub 发现；首页为可筛选专题和即时本地搜索，点击复用现有预览与明确订阅。
- 内置 JSON 种子，IndexedDB 保存验证成功的远程快照；内置种子永不覆盖已缓存版本。目录不进入偏好、备份或云同步。
- 固定 `https://news-update.aizeek.com/rss-catalog/v1/manifest.json`，按用户最终要求每 1 小时后台检查一次；失败一小时后重试。首屏可用后的空闲时机按需加载维护模块，打开目录也会检查；不进入首屏阻塞路径。
- manifestSchema=1，catalog.schemaVersion=1；快照包含 schemaVersion、generatedAt、feeds，记录包含稳定 id、title、url、category、language、region、aliases、tags。
- 用 SHA-256 命名不可变快照。验证大小（最大 8 MiB）、哈希、结构、数量、URL 和重复 id/URL；成功持久化后切换，失败保留旧版。网络、存储均不可阻塞原有阅读。
- 不引入生产依赖；共享纯 TypeScript 校验契约供客户端和构建脚本使用。
- 手动 GitHub Action 读取仓库种子，校验并构建、上传快照、从 R2 读回校验，最后更新 manifest；保留历史快照以便回滚，默认不删除任何版本。
- R2 凭证复用现有 Actions Secrets，永不发给客户端；配置 CORS、自定义域名和短/长期缓存。

取舍：远端搜索会让每次输入依赖网络，打包固定目录则必须发 APK 才能更新；采用历史决策中的静态分发与本地搜索。用户提供的 3,493 条原始目录保存到 `data/rss-catalog/upstream.json`，确定性生成精简种子。每个 APK 均内置种子，已有远程缓存优先。语言筛选复用应用主题弹窗，不使用原生 select。不把目录收录声称为实时可用，订阅前仍需检测。
