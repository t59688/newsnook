# Linux.do 话题更新提醒排查

## 实际接口与故障

模拟器 logcat 确认，原实现请求 `https://linux.do/message-bus/<client-id>/poll?dlp=t` 返回 404，后续请求的 `/latest` 游标始终为 `-1`。Linux.do 将轮询部署在 `https://ping.ldstatic.com`；对该地址实际 POST 可返回 HTTP 200 与 MessageBus 状态帧。

`/__status.data` 中的数字是各频道的消息游标，不是提醒数量。用户提供的 `111.json` 包含 45 条 `/latest` 事件，按 `topic_id` 去重为 31 个话题；末尾状态帧的 `/latest` 游标为 4370676。提醒只累计真实事件，不把状态帧数值当成数量。

## 修复边界

- `api/endpoints.ts` 使用实际轮询域名；`feed/updates.ts` 保持各频道游标、话题去重与刷新期间事件的确认边界。
- Android 只额外允许 HTTPS、准确域名、32 位十六进制客户端 ID、准确 poll 路径和 `dlp=t` 的 POST。主站通用 API 白名单保持原样。
- 跨域轮询通过独立原生请求执行，不转发主站 Cookie、CSRF 或 User-Api-Key。登录用户从官方主站 HTML 获取 `shared_session_key`，仅在原生内存短暂缓存，通过官方 `X-Shared-Session-Key` 鉴权；令牌不经过 Capacitor 请求参数或日志。
- 会话隔离比较登录身份 Cookie `_t`，避免 Cloudflare 与普通会话 Cookie 轮换把有效响应误判为换号；真正换号或退出后的迟到响应丢弃。
- 只订阅最新、新、未读及删除频道，不复制网页上与当前功能无关的私信、聊天和在线状态频道。

官方协议参考：[MessageBus 初始化与跨域鉴权](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/instance-initializers/message-bus.js)、[话题事件与去重计数](https://github.com/discourse/discourse/blob/main/frontend/discourse/app/models/topic-tracking-state.js)。

## 可重复验证

`npm run test:linuxdo-feed-updates` 验证频道游标、去重、状态帧、列表位置、点击回顶、刷新失败、刷新期间新事件与退避；`npm run test:linuxdo-message-bus-native` 编译并运行原生 URL/令牌解析/身份 Cookie 策略测试。Android 构建可进一步验证原生桥接编译。

本次已通过 Linux.do 全套回归、原生策略测试、lint、Web 构建与 cloud debug APK 构建，并安装到 `emulator-5554`。模拟器真实轮询游标连续推进；匿名「最新」列表出现 15 个话题的提醒，在滚动位置 800 点击后回到 0 并重新加载 30 条。刷新期间收到的 4 个新更新继续保留，页面没有错误。登录用户的跨域密钥分支尚未用真实登录账号现场验证。

本机构建首次遇到 JDK Windows Unix-domain socket 临时目录的 `Invalid argument: connect`。仅本次命令设置 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=<仓库>/android/.gradle` 后构建通过，未修改项目 Gradle 配置或系统设置。
