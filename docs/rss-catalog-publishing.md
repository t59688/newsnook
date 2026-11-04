# RSS 目录发布与维护

## 数据与本地行为

维护数据保存在 `data/rss-catalog/upstream.json`；`scripts/rss-catalog-import.ts` 确定性生成 `src/features/rssCatalog/seed.json`。应用仅打包精简种子，维护文件、验证明细和归一化映射不进入 APK。

`data/rss-catalog/upstream.json` 是唯一维护源，包含 **6,509 条** RSS、Atom、JSON Feed，其中 **104 条**含 `nsfw: true` 标记。导入器校验所有来源并生成同样 **6,509 条**的离线种子；发布器直接使用相同的完整目录，可独立更新 R2，无需重新发布 APK。没有第二份 NSFW 数据文件、兼容目录或独立发布链路。源文件只保留运行需要的字段，网络审计过程保存在仓库外。

### 离线创作者来源索引（2026-11-04）

唯一维护目录合入经验证的 1,717 条跨平台来源，并加入 3Blue1Brown 的 B 站投稿订阅。目录收录原生 RSS 与已解析的 RSSHub 路由，搜索用户无需先去网址模式转换。上游可为每个来源附加 platform、creator_id、rsshub_route、aliases、tags。导入器执行格式验证，归一化为客户端的 platform、creatorId、rsshubRoute。中文名称拼音及无空格拼音在构建时通过 pinyin-pro 生成；运行时 WebView 无须加载拼音库。

本地搜索匹配创作者名、别名、UID、拼音、专题及标签；仅当精确查询没有命中时，针对长度足够的单词执行单字符错字容错，不做 UID 模糊匹配。搜索不向任何网站发网络请求。RSSHub 来源选择后沿用 RSS 商店已有实例管理、探测、预览、订阅以及故障切换，原生 RSS 继续按原流程处理，不建设第二套转换系统。

内置目录的 metadata.revision 单调递增，对应生成快照的 revision。应用启动对比本地缓存与内置种子的日期和修订号，不让旧 R2/IndexedDB 完整快照盖过更新的 APK 离线目录；在线也只接受同等或更新修订号的完整快照。R2 仍使用固定 Manifest + 哈希快照，后续可以独立更新。此次新增尚未发布到 R2，也没有发布新 APK；上一在线版本为 4,665 条。


**内容标记**：客户端目录条目保留 `nsfw: boolean`（未标记的来源归一化为 `false`），用于来源列表中的小型提示标签和元数据检索。目录没有 NSFW 开关、显隐状态或搜索过滤：全部 6,509 条来源直接参与搜索、分类统计、预览与订阅。缺少 `nsfw` 字段的旧目录缓存校验失败后，客户端直接使用新离线种子，再由常规 R2 更新恢复网络快照。

**每个 APK 都携带一份内置种子**，保证任何版本的新安装都可离线查找。安装包中的种子只在没有有效远程缓存时使用；已下载的 R2 快照始终优先，不会被 APK 中的种子覆盖。后续仅更新目录时，发布 R2 快照即可，无需重发 APK；下一次发 APK 时可以同时更新内置种子，供新的安装使用。

生成后的输入结构：`{ schemaVersion: 1, generatedAt: ISO时间, feeds: [...] }`，每条包含 `id/title/url/category/language/region/aliases/tags/nsfw`。`id` 应保持稳定，修正地址时不更换 id。 上游 metadata.revision 须随完整目录单调递增，与下一次 RSS Catalog 发布版本相匹配，例如 2026.11.04.4 对应 20261104004。上游有新分类/地区时扩展导入脚本映射，未映射值会报错，避免直接显示内部分类键。未知语言使用 `und`，不要根据标题猜测语言；禁止添加凭证或需要登录的私密 Feed。重复 id/URL、非 HTTP(S)、URL 凭据、非法字段及空目录都会拒绝发布，不会静默丢弃数据。目录最大 32 MiB / 100,000 条。旧客户端仍使用其内置的 8 MiB / 50,000 条上限，超限更新会拒绝并保留旧目录；正式发布大快照前需协调新客户端上线。

客户端从内置种子或 IndexedDB `newsnook:rss-catalog` 读取快照。在首屏可用后的空闲时机与进入目录时，检查固定地址 `https://news-update.aizeek.com/rss-catalog/v1/manifest.json`。按用户最终要求，成功检查后 1 小时内不重复联网；运行中的应用每小时尝试维护，失败在进程内退避一小时。下次冷启动失败退避重新计时。关键词不发网络请求；预览与订阅读取原站。后台更新不弹窗、不修改已有订阅。

这里的“后台”是应用运行期间不阻塞界面的异步维护；未注册 Android WorkManager 或关闭应用后的定时唤醒任务。应用长时间关闭时，更新等到下次启动/打开目录再检查。

新快照验证字节数、SHA-256、JSON 结构、记录数与日期后，通过一次 IndexedDB 事务替换；写盘失败保留旧版。旧 APK 内置种子不会覆盖新缓存。新库不受旧 `newsnook:feed-discovery` 清理影响。目录不进入 Preferences、备份或可选云同步；已有订阅、列表/正文缓存和阅读状态格式不变。

## 手动构建与发布

### 两阶段数据建设（2026-11-04）

先运行独立的 [公开来源采集与检查工具](../tools/feed-catalog/README.md)，只生成 `artifacts/feed-catalog/` 下的下载、候选和检查证据，不访问应用代码或权威目录。目录入口清单只维护公开数据集地址；真实来源条目仍只在 `data/rss-catalog/upstream.json` 维护。第二步在项目根目录离线导入报告：

```bash
npm run rss-catalog:merge -- --report artifacts/feed-catalog/report.json
npm run rss-catalog:merge -- --report artifacts/feed-catalog/report.json --apply
npm run rss-catalog:import
```

默认只显示增量；显式 apply 前，完整验证报告、出处、Feed 成功证据、平台身份、去重及最终发布体积。成功后原子写入唯一权威目录；重复导入不增加 revision，不变更原有条目或已订阅数据。随后用原有生成脚本产出内置种子和本地发布文件。此操作不推送 Git、不发布 R2/APK。

不设置最近 90 天更新的收录门槛；Feed 格式合法即可保留低频或空来源。403/429/5xx、TLS、超时、单实例失败与身份暂不可确认不会删除来源。连续至少 3 次独立检查均为 404/410、跨度至少 7 天、原站身份也无法再确认，才标记永久失效；工具仅输出审查证据，桥接器不自动删除旧来源。第一次成功检查后才允许新增，不以临时失败或未检查候选冒充可订阅目录。

编辑维护目录后生成内置种子并发布：

```bash
# 编辑 upstream.json 后先生成种子（CI 验证两者一致）
node --import tsx scripts/rss-catalog-import.ts
node --import tsx scripts/rss-catalog-import.test.ts
node --import tsx scripts/rss-catalog-release.test.ts
node --import tsx scripts/rss-catalog-release.ts --version 2026.11.04.4
# 可先指定另一份已经归一化的数据，仅构建不会写入 R2
node --import tsx scripts/rss-catalog-release.ts --input /path/to/catalog.json --version 2026.11.04.4
```

产物默认在 `node_modules/.cache/newsnook/rss-catalog/`。确认内容后，配置环境变量并安装 AWS CLI：

- `R2_ACCOUNT_ID`（或 `R2_ENDPOINT`）
- `R2_BUCKET`，默认 `newsnook-update`
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`，仅授予目标 bucket 必要读写权限

```bash
node --import tsx scripts/rss-catalog-release.ts --publish --version 2026.11.04.4
node --import tsx scripts/rss-catalog-verify.ts --manifest node_modules/.cache/newsnook/rss-catalog/manifest.json
```

脚本以参数数组调用 AWS CLI，不拼接 shell 命令。先上传 `rss-catalog/v1/catalogs/sha256-<hash>.json`，从 R2 下载并校验原始字节，再上传 manifest。失败不切换 manifest；历史快照全部保留，暂不自动清理。回滚时指定历史数据输入与新的发布版本号，依然先读回校验；不要删除仍有客户端引用的快照。目录是完整快照，变更不触发 APK 发布。

GitHub Actions → **Publish RSS Catalog** → Run workflow。工作流已在默认 `main` 登记，`source_ref` 指定含脚本与数据的分支或提交，默认 `beta`。`version` 可空；默认仅构建，勾选 `publish` 才写 R2。工作流全局串行，防止两个手动任务交错。复用仓库变量 `R2_ACCOUNT_ID` 与 Secrets `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。发布后强制检查公开域名的本次版本、快照字节、SHA-256、JSON、数量及 WebView CORS；最多等 90 秒让短缓存更新。本地并发发布需由操作者串行执行。不要把 Secret 写入源文件或提交到仓库。

## R2 分发配置

复用 `news-update.aizeek.com` 自定义域名。目录读取使用公开、无凭据的 GET；无需 Worker、数据库或搜索 API。配置该 bucket 的 CORS 允许 Web 和 Capacitor 来源读取公开目录，例如：

```json
[
  { "AllowedOrigins": ["*"], "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag", "Content-Length"], "MaxAgeSeconds": 3600 }
]
```

此为公开只读资源，不发送 Cookie。若 bucket 已有 CORS 策略，应合并规则，保留现有 APK 分发需求。修改 CORS 后清理旧 CDN 缓存以便头部生效；见 [Cloudflare CORS 文档](https://developers.cloudflare.com/r2/buckets/cors/)。

此规则已在本次验收中通过 Cloudflare 控制台配置并验证。现有发布密钥只有对象权限，读取桶 CORS 配置返回 AccessDenied，因此没有给发布凭证扩大权限，也没有保留无法运行的自动改桶配置步骤；后续发布通过公开验证检查 CORS 是否仍可用。

脚本设置 manifest 为 `public,max-age=60`，哈希快照为 `public,max-age=31536000,immutable`。在 Cloudflare 为 `/rss-catalog/v1/*` 配置允许缓存 JSON 的 Cache Rule，并遵守对象的缓存头；不要给 manifest 配置一年 TTL。启用适合 JSON 的传输压缩，哈希按解压后的 UTF-8 原始字节计算，不能直接上传 gzip 内容并错误标记编码。自定义域名及缓存说明见 [Cloudflare R2 缓存文档](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/)，上传参数见 [AWS CLI cp 文档](https://docs.aws.amazon.com/cli/latest/reference/s3/cp.html)。

首次生产验收需验证：GET manifest 和快照均为 200、CORS 可读、响应字节哈希正确、APK 更新路径仍可访问。源文件编辑、GitHub Secrets 与 R2 控制台设置不会由本地代码自动部署。

## 2026-11-03 首轮 Android 模拟器验证（当时的 80 条临时种子）

Pixel 6 Pro / Android 12（`emulator-5554`），安装当前 `1.9.2-beta.8` cloud debug APK。安装前将应用私有目录备份到电脑仓库外的私有目录，仅执行 `adb install -r`，首次安装时间与安装前后的 CapacitorStorage 文件哈希一致；原有 2 个自建订阅仍保留。

- 正式商店默认打开目录，80 条种子首次渲染 30 条，加载更多显示 60 条；科技专题筛选 22 条。
- 搜索 OpenAI 命中 1 条；无结果提示和重置正常。查询、专题筛选期间新增 WebView 资源请求为 0。
- 原站少数派 RSS 实际检测成功，展示 10 条内容与真实标题，订阅按钮可用；未点击保存，避免改变已有预设与订阅。
- 开启飞行模式并关闭 Wi-Fi 后强制停止、冷启动，仍能打开目录与搜索 OpenAI；验证完成恢复原有网络开关。
- Feedly / 网址模式切换及 Android 返回正常，412 CSS px 视口无横向溢出；当前应用未发现崩溃或未捕获异常。
- 当时无已持久化的远程目录快照，因此此轮只验证种子离线路径，未验证生产 R2 下载更新。后续已导入完整全球目录；Android 实体设备尚未测试。

本机 JDK 的 Unix-domain socket 临时目录问题沿用已有排查文档的临时 JVM 参数解决，未改 Gradle 配置。

## 完整目录与主题选择器复验

导入完整数据后重新构建并覆盖安装同一模拟器，界面显示 3,493 条、61 个专题、3 种语言。中文筛选为 1,168 条，英文为 1,442 条；清空语言筛选搜索“农业”得到 7 条，搜索与筛选期间新增资源请求为 0。

页面原生 `select` 数量为 0，语言菜单采用 `FeedStorePicker` / `OptionPickerDialog` 的主题底部弹窗；Android 返回键仅关闭菜单，选项点击后正确筛选并关闭。固定中文/英文标签避免 WebView 的 Intl 本地化缺失显示代码名。视口无横向溢出。数据导入与种子一致性检查、新目录测试、原有发现流程回归、lint、Web 生产构建和 cloud debug APK 构建通过；既有 lint/构建警告仍保留。

## 真实 R2 发布与模拟器更新验收（2026-11-03）

工作流、目录数据及其最小工具依赖已单独提交到 beta；main 只登记工作流文件。客户端 UI/CSS 等其他改动仍在本地，没有混入此次发布提交。固定清单地址现返回 HTTP 200。

| 版本 | 条数 | 结果 |
|---|---:|---|
| `2026.11.03.1` | 3,493 | 首次发布，公开字节/hash/CORS 校验通过，模拟器保存同版本 |
| `2026.11.03.2` | 3,494 | 加一条 W3C 地址，模拟器检测变化并真实下载；收尾发现末尾斜杠别名重复 |
| `2026.11.03.3` | 3,494 | 将测试新增项替换为已验活 GitHub 官方状态 RSS，当时线上版本 |

[首次发布 Action](https://github.com/t59688/newsnook/actions/runs/41661810310)、[第二版 Action](https://github.com/t59688/newsnook/actions/runs/41663864222)、[修正版 Action](https://github.com/t59688/newsnook/actions/runs/41664875598) 均成功。首次公开验证发现 CORS 缺失，修复后再次检查通过；配置修复过程中的失败任务没有覆盖有效目录。

当时（2026-11-03）的快照 SHA-256：`49409f796128cab9eae11afcab583274f91fb748c14ac1980969daebff67c26a`，完整 UTF-8 字节数 817,862。manifest 为 60 秒缓存头，快照为一年 immutable，公开读取返回 `Access-Control-Allow-Origin: *`。当前 Cloudflare 返回 `CF-Cache-Status: DYNAMIC`，边缘 JSON 缓存规则仍是后续性能配置项；传输压缩已生效，更新正确性不依赖 CDN 命中。

模拟器使用原先安装的 cloud debug APK（内置 3,493 条），本次没有重装或升级 APK：

以下是首次发布验收时的历史记录，当时检查间隔为 24 小时；之后用户明确调整为 1 小时，现以本文前面的运行规则为准。

- 先确认 IndexedDB 为 `.1` / 3,493 条；线上发布 `.2` 后在 24 小时节流内重新进入目录，目录请求为 0，仍使用 `.1`。
- 临时将 WebView 的 `Date.now` 推进 24 小时后重新进入目录，抓包确认仅请求 manifest 与新快照，均为 200；完整下载、SHA-256 校验、IndexedDB 写入、界面更新全部完成。未修改生产 24 小时阈值，也未改 Android 系统时钟。
- `.2` 快照解压后 817,838 字节，实际传输约 101,208 字节；`.3` 解压后 817,862 字节，实际传输约 101,487 字节，设备重算 payload 哈希与线上一致。
- 测试时间函数恢复后，再次检查相同哈希只请求清单，不重新下载快照；`checkedAt` 已恢复实际时间。
- 新增 GitHub Status 的原站 RSS 实际预览成功，返回 25 条，订阅按钮可用；没有保存新订阅，原有两个自建订阅保持不变。
- 开启飞行模式、关闭 Wi-Fi、强停再冷启动，仍读取 `.3` / 3,494 条，可离线搜索到新源，目录网络请求为 0。结束后恢复原网络状态。

同日修复设置页公共焦点样式覆盖 `outline-none` / `focus:outline-none` 造成的双框：尊重输入控件已有焦点方案，普通输入框和按钮保留键盘焦点提示。`npm run test:settings-focus` 通过真实浏览器计算样式验证；模拟器上的目录、Feedly 搜索、本地搜索三种输入框均无额外方框，目录外层圆角焦点边框仍有效。

后续按用户要求将成功检查间隔调整为 1 小时。边界测试验证一小时内零请求、满一小时重新检查；重建并覆盖安装模拟器后，临时推进 WebView 时间一小时，实际请求 manifest 返回 200，相同哈希未下载快照。测试时钟及 `checkedAt` 已恢复，R2 数据无需为间隔变更重发。
