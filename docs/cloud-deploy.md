# NewsNook Cloud 部署与运维

「有所闻」的云端只做一件事：给**自愿登录**的用户同步订阅、分类排序、应用配置与 Secret。
它不托管文章、不做推荐、不参与正文抽取。**服务全挂，App 仍是完整可用的本地阅读器。**

代码在 [`cloud/`](../cloud)，共享协议在 [`packages/contracts/`](../packages/contracts)，
客户端接入在 `src/features/account/` 与 `src/features/sync/`。

## 1. 组件与边界

| 组件 | 用途 |
|---|---|
| Fastify API（`cloud/src`） | Better Auth 认证、设备、push/pull/bootstrap/冲突 |
| 外部 PostgreSQL 17+ | 唯一存储：认证表（`auth` schema）+ 同步表（`public` schema）；由你自行提供，Compose 不内置数据库 |
| SMTP（可选） | 邮箱验证与密码重置；不配置时邮件只写日志，仅适合本地开发 |

没有 Redis、消息队列、WebSocket、后台 worker。并发 push 的串行化由
PostgreSQL 对 `sync_heads` 那一行的 `SELECT ... FOR UPDATE` 事务行锁完成，不引入分布式锁。

## 2. 环境变量

变量清单见 [`cloud/.env.example`](../cloud/.env.example)。三个安全相关的值缺失或不合规会**直接拒绝启动**：

| 变量 | 约束 |
|---|---|
| `BETTER_AUTH_SECRET` | 至少 32 字符 |
| `NEWSNOOK_DATA_ENCRYPTION_KEY` | base64 或 hex，必须解码成正好 32 字节（AES-256），且不得等于 `BETTER_AUTH_SECRET` |
| `CLIENT_ORIGINS` | 逗号分隔的裸 origin 列表，不接受 `*` |

生成方式：

```bash
openssl rand -base64 48   # BETTER_AUTH_SECRET
openssl rand -base64 32   # NEWSNOOK_DATA_ENCRYPTION_KEY
```

`NEWSNOOK_DATA_ENCRYPTION_KEY` 只用来加解密 `user_secrets`。它必须与数据库备份**分开保管**：
密钥丢失时数据库里的 Secret 密文永久无法恢复（其余同步数据不受影响，用户重填一次密钥即可）。

## 3. 数据库迁移

迁移永远是**显式的一步**，API 启动时不会自动跑：

```bash
# Docker（推荐）：自动进容器执行，不必手动 docker exec
cd cloud && ./deploy db migrate

# 本机 Node（开发）
DATABASE_URL=postgres://... npm run cloud:migrate
```

`cloud/src/db/migrate.ts` 按文件名顺序执行 `cloud/migrations/*.sql`，在 `schema_migrations`
里登记已应用的文件，并用 `pg_advisory_lock` 保证多实例同时部署时只有一个在跑。
已应用过的文件不会重复执行，输出 `migrations applied: (none)` 即代表已是最新。

## 4. 部署

### Docker Compose（单机，推荐）

`cloud/Dockerfile` + `cloud/compose.yml`：镜像基座 `node:24.18.0-alpine3.24`，**只跑 API**。
PostgreSQL 使用**外部实例**（本机已有库、云托管 RDS 等均可）。同目录
[`cloud/deploy`](../cloud/deploy) 负责 compose 与进容器执行运维命令。

```bash
cd cloud
cp .env.example .env
# 必填 DATABASE_URL / BETTER_AUTH_* / NEWSNOOK_DATA_ENCRYPTION_KEY / CLIENT_ORIGINS
# 宿主机 Postgres 示例：
#   DATABASE_URL=postgres://newsnook:SECRET@host.docker.internal:5432/newsnook
# 远程库示例：
#   DATABASE_URL=postgres://newsnook:SECRET@db.example.com:5432/newsnook
chmod +x deploy               # 首次
./deploy build
./deploy up
./deploy db migrate           # 对外部库显式迁移
./deploy health
```

常用命令：

| 命令 | 作用 |
|---|---|
| `./deploy up` | 后台启动 api |
| `./deploy down` | 停止服务 |
| `./deploy db migrate` | 在 api 镜像内对 `DATABASE_URL` 执行迁移 |
| `./deploy db shell` | 临时 postgres 客户端进 `psql` |
| `./deploy db dump [file]` | `pg_dump -Fc` 到文件 |
| `./deploy api shell` | 进入 api 容器 |
| `./deploy logs` | 跟踪 api 日志 |
| `./deploy health` | 探测 live / ready |
| `./deploy help` | 完整说明 |

**连接串注意**：容器内的 `localhost` / `127.0.0.1` 指向容器自己，不是宿主机。
Compose 已配置 `host.docker.internal`；宿主机上的 Postgres 请用该主机名。
远程库写真实 DNS/IP，并确保安全组/防火墙放行 API 宿主机出口。

### 跨机 Nginx 反代

Nginx 与 API **不在同一台机器**时：

```text
客户端 → https://api.example.com (Nginx 机, 443)
       → http://<API 机内网地址>:<发布端口>   （由 API_PUBLISH_* 决定，勿把真实地址写进仓库）
       → 容器内 :8787
```

API 机 `cloud/.env`：

```bash
BETTER_AUTH_URL=https://api.example.com
API_PUBLISH_HOST=0.0.0.0
API_PUBLISH_PORT=8787
TRUST_PROXY=true
CLIENT_ORIGINS=https://app.example.com   # 前端 origin，不是 API 域名
```

然后 `./deploy up`。防火墙只允许 **Nginx 机 → API 机发布端口**，不要对公网开放该端口。

Nginx 自行配置：`proxy_pass` 到 API 机的 `API_PUBLISH_HOST:API_PUBLISH_PORT`；转发 `Host` / `X-Forwarded-For` / `X-Forwarded-Proto`；`client_max_body_size 2m` 足够（同步 push 上限约 512KB）。
V1 **无 WebSocket**，不要套大文件上传那套 `proxy_buffering off` / `Upgrade`。

### 直接跑 Node

```bash
npm ci
npm run cloud:build          # 先构建 contracts，再构建 cloud
DATABASE_URL=... npm run cloud:migrate
node cloud/dist/server.js
```

### 发布顺序（每次都照做）

```text
备份数据库 → 显式迁移 → 部署新版本 → /health/live → /health/ready → auth 冒烟 → sync 冒烟
```

Docker 对应：

```bash
cd cloud
./deploy db dump
./deploy build
./deploy up
./deploy db migrate
./deploy health
```

## 5. 健康检查与冒烟

| 端点 | 含义 | 用途 |
|---|---|---|
| `GET /health/live` | 进程活着，不碰数据库 | 容器存活探针 |
| `GET /health/ready` | 数据库可连 | 负载均衡就绪探针、发布门禁 |

冒烟（把 `$BASE` 换成实际地址）：

```bash
curl -fsS "$BASE/health/live"
curl -fsS "$BASE/health/ready"

# 未登录必须是 200 + user:null，而不是 500
curl -fsS "$BASE/api/v1/me"

# 无凭证访问同步接口必须是 401 AUTH_REQUIRED
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/sync/pull?since=0"
```

再用一台真实设备登录一次，确认 push/pull 能跑通、`sync_heads.revision` 单调增长。

## 6. 备份与恢复演练

**必做的运维项**，不是可选建议：

1. **每天全量备份** PostgreSQL（`pg_dump -Fc`），保留至少 7 天。
2. 备份**存到异地/对象存储**，不与数据库同机。
3. `NEWSNOOK_DATA_ENCRYPTION_KEY` **单独保管**（密钥管理服务或离线保险），
   绝不和数据库备份放在同一个桶、同一台机器、同一份 `.env`。
4. **定期恢复演练**：至少每季度一次，把备份恢复到临时库，跑迁移 + `/health/ready` + 一次登录同步。
   没演练过的备份等于没有备份。

```bash
# Docker
cd cloud && ./deploy db dump

# 本机
pg_dump -Fc "$DATABASE_URL" > newsnook-$(date +%F).dump

# 恢复到临时库并验证
createdb newsnook_restore
pg_restore -d newsnook_restore newsnook-2026-08-27.dump
DATABASE_URL=postgres://.../newsnook_restore npm run cloud:migrate
```

用户侧还有一层兜底：客户端在首次同步选择前会自动留一份「同步前配置」本机快照，
用户可以在「我的 · 账户与同步」里整包退回，不依赖服务端。

## 7. 日志与故障定位

- 结构化日志，`authorization` / `cookie` / `set-cookie` / `set-auth-token` 一律 redact。
- **日志里永远不会出现 Secret 明文、Session token 或完整同步 payload**；push 摘要只记条数与实体类型。
- 每个错误响应都带 `requestId`；用户在应用内看到的「编号 xxxxxxxx」就是它的前 8 位，
  可直接用来在日志里定位，不需要用户提供任何敏感内容。

常见状态码：

| 码 | 含义 | 客户端行为 |
|---|---|---|
| 401 `AUTH_REQUIRED` / `SESSION_EXPIRED` | 会话失效 | 暂停同步并提示重新登录，本地数据不动 |
| 403 `DEVICE_REVOKED` | 设备被撤销 | 停止同步，保留本机全部数据 |
| 409 `DEVICE_IN_USE` | 本机 deviceId 已属其他账户 | 客户端换新 deviceId 后自动重试 |
| 409 冲突 | 高风险冲突 | 进冲突队列，其余实体继续同步 |
| 413 `PAYLOAD_TOO_LARGE` | 批次过大 | 客户端按 `SYNC_LIMITS` 分批 |
| 429 `RATE_LIMITED` | 限流 | 按 `Retry-After` 退避 |
| 426 `PROTOCOL_UNSUPPORTED` | 协议版本过旧 | 提示升级 App，不破坏本地数据 |

## 8. OAuth 与邮件

- Google / GitHub / Linux DO 的 client id/secret 不填就不启用对应入口，服务照常运行。
- 回调地址是 `"$BETTER_AUTH_URL"/api/auth/callback/{google,github,linuxdo}`。
- Linux DO Connect 申请页：<https://connect.linux.do>；OIDC discovery：
  `https://connect.linux.do/.well-known/openid-configuration`。
- Android 不在深链里传长期 Session：浏览器完成登录后服务端签发**一次性令牌**，
  App 用它换 Session token 并存进 Android Keystore（见 `cloud/src/routes/mobileAuth.ts`）。
- 同邮箱的不同登录方式**不会被自动合并**（`disableImplicitLinking: true`）；
  绑定必须由已登录用户在「账户与同步」里显式发起。
- Android 的登录与绑定都必须由 Custom Tab 自己向服务端发起
  （`GET /api/v1/auth/mobile/start/:provider`、`GET /api/v1/auth/mobile/link/:provider?ott=…`）。
  在 WebView 里 fetch `sign-in/social` 或 `link-social` 再把授权 URL 丢给浏览器，
  OAuth state Cookie 会留在 WebView，回调必然 `state_mismatch`。
  绑定流程的 Session 靠一次性令牌交接，回跳固定是 `newsnook://auth/callback?linked=<provider>`。
- 这些路由不需要新的环境变量：`BETTER_AUTH_URL` 仍须与真实回调域名（反代对外的 host）
  完全一致，反代前置时保持 `TRUST_PROXY=true` 并转发 `X-Forwarded-Proto` / `X-Forwarded-Host`。

## 9. CI

[`.github/workflows/cloud-sync-ci.yml`](../.github/workflows/cloud-sync-ci.yml) 在真实 PostgreSQL 上跑：

```text
checkout → Node → npm ci → postgres healthy
  → 构建 contracts → 显式迁移 → cloud 测试
  → 客户端 account/sync 测试 → lint → cloud 构建 → web 构建
  → Android 两个变体的 Java 编译
```

CI 用的认证密钥、加密密钥都是**仅供测试的假值**，PR 流水线里不注入任何生产 OAuth / SMTP 凭证。
