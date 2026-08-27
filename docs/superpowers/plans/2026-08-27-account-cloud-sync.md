# NewsNook 账户与云同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 NewsNook 本地优先体验的前提下，增加可选的邮箱密码 / Google / GitHub 账户体系，以及订阅、分类、跨设备设置和用户 Secret 的可靠多设备同步。

**Architecture:** 新增独立 `cloud/` Fastify + PostgreSQL 服务，Better Auth 只负责身份与 Session；客户端新增 `account/` 与 `sync/` 两个 feature，通过“本地投影 → shadow/outbox → push → delta pull → merge”工作。现有 `Preferences`、`enabled`、`presets` 仍是运行时真相，不为同步重写整套本地存储。Android 使用 Keystore-backed Capacitor 插件保存长期 Session 和同步 Secret；Web 使用 HttpOnly Cookie Session。

**Tech Stack:** React 19 + TypeScript + Vite 8 + Capacitor 8；Fastify + PostgreSQL (`pg`) + Better Auth；Zod 共享协议；Node `node:test` + `tsx`；Android Java + Android Keystore AES/GCM；现有 `scripts/*.test.ts` 测试风格。

**Spec:** `docs/superpowers/specs/2026-08-27-account-cloud-sync-design.md`

## Global Constraints

- 核心阅读链路继续 local-first：未登录、断网、云端 5xx、数据库维护均不能阻止本地订阅浏览、正文解析、缓存阅读。
- V1 同步：订阅、分类/排序/启停、场景预设、跨设备普通设置、Secret。
- V1 不同步：正文、列表/正文缓存、稍后读、已读、阅读历史、阅读位置。
- 设备本地设置不上传：`einkMode`、`wifiOnlyAutoLoadMedia`、`prestore`。
- Secret 上传但不做 E2EE；服务端 AES-256-GCM 加密，Android 本地也必须进入 Keystore-backed secure store；日志中永不打印明文 Secret。
- 不引入 Redis、RabbitMQ、Kafka、WebSocket、CRDT、Event Sourcing、分布式锁、Kubernetes。
- 同一用户的服务端 push 通过 PostgreSQL `sync_heads ... FOR UPDATE` 串行；不同用户不互锁。
- 日常 remote pull 不 reload App；只有首次“使用云端数据 / 使用本机数据”完成整包基线切换时允许受控 reload。
- 客户端 `src/` 新日志必须走 `lib/logger.ts`，不得直接 `console.*`。
- 旧 Android WebView 69 继续可运行；同步客户端不依赖新式 UI API、Service Worker 或浏览器后台同步 API。
- 所有认证 / OAuth Client Secret 只在服务端；业务 API 从 Better Auth Session 推导 `userId`，从不信任 payload 内的 user id。
- 实现期间持续运行原有测试，不通过删除或弱化旧测试来换取绿色 CI。

## Implementation Refinement Discovered During Repo Inspection

设计稿写“每条同步记录使用稳定 UUID”。现有 NewsNook 已经为内置信源、分类和自定义信源提供稳定 domain id，自定义信源 id 又由 URL 确定生成。实现时**不再增加第二层 entity UUID 映射**：

- `subscription.entityId` = 现有 source id。
- `category.entityId` = 现有 category id。
- `setting.entityId` / `secret.entityId` = 稳定 key。
- 只有同步专用对象使用 UUID：`deviceId`、`mutationId`、`conflictId`。

这样仍满足“离线可生成、跨设备稳定”的设计目标，同时避免给现有 `Preferences` 和 OPML 流程增加 id migration。

## Target File Structure

```text
newsnook/
├── packages/contracts/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/{index,errors,auth,sync}.ts
├── cloud/
│   ├── package.json
│   ├── tsconfig.json
│   ├── Dockerfile
│   ├── compose.yml
│   ├── .env.example
│   ├── migrations/001_cloud.sql
│   ├── src/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   ├── config.ts
│   │   ├── auth.ts
│   │   ├── mail.ts
│   │   ├── db/{pools,migrate}.ts
│   │   ├── crypto/secrets.ts
│   │   ├── plugins/authSession.ts
│   │   ├── routes/{health,mobileAuth,devices,sync}.ts
│   │   └── sync/{repository,conflicts,service}.ts
│   └── tests/
│       ├── helpers/database.ts
│       ├── health.test.ts
│       ├── auth.test.ts
│       ├── secrets.test.ts
│       └── sync.integration.test.ts
├── src/features/account/
│   ├── types.ts
│   ├── authClient.ts
│   ├── secureStore.ts
│   ├── native.ts
│   ├── mobileCallback.ts
│   ├── useAccount.ts
│   └── SyncOnboardingPrompt.tsx
├── src/features/sync/
│   ├── types.ts
│   ├── projection.ts
│   ├── state.ts
│   ├── reconcile.ts
│   ├── merge.ts
│   ├── SyncEngine.ts
│   ├── notifier.ts
│   └── useCloudSync.ts
├── src/screens/settings/AccountSyncScreen.tsx
├── src/components/SyncToast.tsx
├── android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java
├── android/app/src/main/java/com/aizeek/newsnook/SyncNotificationPlugin.java
├── scripts/{cloud-sync-contracts,sync-projection,sync-engine,account-sync-ui}.test.ts
├── .github/workflows/cloud-sync-ci.yml
└── docs/cloud-deploy.md
```

---

## Task 1: Change the product boundary and add shared protocol contracts

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/errors.ts`
- Create: `packages/contracts/src/auth.ts`
- Create: `packages/contracts/src/sync.ts`
- Create: `scripts/cloud-sync-contracts.test.ts`

**Interfaces:**

```ts
export const SYNC_PROTOCOL_VERSION = 1 as const

export type SyncEntityType = 'subscription' | 'category' | 'setting' | 'secret'
export type SyncMutationOperation = 'upsert' | 'delete'

export interface SyncMutation {
  mutationId: string
  entityType: SyncEntityType
  entityId: string
  operation: SyncMutationOperation
  baseRevision: number | null
  payload: unknown
}

export interface SyncRecord {
  entityType: SyncEntityType
  entityId: string
  revision: number
  deleted: boolean
  payload: unknown
}

export interface SyncPushRequest {
  protocolVersion: 1
  deviceId: string
  mutations: SyncMutation[]
}

export interface SyncPullResponse {
  records: SyncRecord[]
  cursor: number
  currentRevision: number
  hasMore: boolean
}
```

- [ ] **Step 1: Write the failing contract test**

Create `scripts/cloud-sync-contracts.test.ts` that imports the contract schemas and asserts:

```ts
import assert from 'node:assert/strict'
import {
  SYNC_PROTOCOL_VERSION,
  syncPushRequestSchema,
  syncPullResponseSchema,
} from '@newsnook/contracts'

assert.equal(SYNC_PROTOCOL_VERSION, 1)
assert.equal(
  syncPushRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: '8d6f3192-9f48-4cfb-8601-791d28f5513d',
    mutations: [],
  }).success,
  true,
)
assert.equal(
  syncPushRequestSchema.safeParse({ protocolVersion: 2, deviceId: 'bad', mutations: [] }).success,
  false,
)
assert.equal(
  syncPullResponseSchema.safeParse({
    records: [],
    cursor: 0,
    currentRevision: 0,
    hasMore: false,
  }).success,
  true,
)
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test:cloud-contracts`

Expected: command fails because `@newsnook/contracts` and/or the script entry does not exist.

- [ ] **Step 3: Add the minimal workspace and contracts package**

Root `package.json` gains:

```json
{
  "workspaces": ["cloud", "packages/contracts"],
  "scripts": {
    "build:contracts": "npm run build --workspace @newsnook/contracts",
    "test:cloud-contracts": "npm run build:contracts && npx tsx scripts/cloud-sync-contracts.test.ts"
  }
}
```

`packages/contracts/package.json`:

```json
{
  "name": "@newsnook/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": "./dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^4.0.0"
  }
}
```

Define Zod schemas for every request/response and export stable error codes:

```ts
export const API_ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'DEVICE_REVOKED',
  'SYNC_CONFLICT',
  'SYNC_SCHEMA_UNSUPPORTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
] as const
```

- [ ] **Step 4: Update repository architecture rules**

Change the absolute `Backendless` rule in `AGENTS.md` and `docs/architecture.md` to:

> NewsNook core reading remains local-first. Optional account/cloud sync may exist, but normal reading, source fetching, body resolving and offline data must not depend on NewsNook Cloud.

Also add `cloud/` and `packages/contracts/` to the architecture map and document the new dependency direction:

```text
UI -> account/sync features -> local adapters/contracts -> cloud API
reading/feed/body path -------------------------------> upstream sites
```

- [ ] **Step 5: Install, build, and rerun**

Run:

```bash
npm install
npm run test:cloud-contracts
npm run lint
```

Expected: contracts test prints success; lint passes.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/architecture.md package.json package-lock.json packages/contracts scripts/cloud-sync-contracts.test.ts
git commit -m "feat(sync): add shared cloud protocol contracts"
```

---

## Task 2: Scaffold the Fastify cloud service, configuration, health checks, and explicit migration runner

**Files:**
- Create: `cloud/package.json`
- Create: `cloud/tsconfig.json`
- Create: `cloud/src/config.ts`
- Create: `cloud/src/db/pools.ts`
- Create: `cloud/src/db/migrate.ts`
- Create: `cloud/src/routes/health.ts`
- Create: `cloud/src/app.ts`
- Create: `cloud/src/server.ts`
- Create: `cloud/tests/health.test.ts`
- Modify: `package-lock.json`
- Modify: root `package.json`

**Interfaces:**

```ts
export interface CloudConfig {
  port: number
  databaseUrl: string
  betterAuthUrl: string
  clientOrigins: string[]
  betterAuthSecret: string
  dataEncryptionKey: string
}

export async function buildApp(options?: { pool?: Pool; config?: CloudConfig }): Promise<FastifyInstance>
```

- [ ] **Step 1: Write failing health tests**

`cloud/tests/health.test.ts` must verify:

- `GET /health/live` -> `200 { status: 'ok' }` without touching PostgreSQL.
- `GET /health/ready` -> `200` when `SELECT 1` succeeds.
- `GET /health/ready` -> `503` when injected pool rejects.

Run: `npm run test:cloud -- --test-name-pattern health`

Expected: fails because `cloud/` does not exist.

- [ ] **Step 2: Add the cloud package**

`cloud/package.json` scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "tsx --test tests/**/*.test.ts",
    "db:migrate": "tsx src/db/migrate.ts"
  }
}
```

Dependencies: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `pg`, `zod`, `@newsnook/contracts`. Dev dependencies: `tsx`, `typescript`, `@types/node`, `@types/pg`.

- [ ] **Step 3: Implement strict environment parsing**

`config.ts` must reject missing/short secrets at startup. Parse comma-separated origins; do not default production to `*`.

- [ ] **Step 4: Implement separate PostgreSQL pools**

Use one connection config but two pools:

- `appPool`: public NewsNook tables.
- `authPool`: connection `options` sets `search_path=auth` so Better Auth stays isolated from business tables.

No route creates its own `Pool`.

- [ ] **Step 5: Implement app/server split**

`app.ts` creates Fastify with Pino logging, CORS allowlist, body limit, rate limit and health routes. `server.ts` only loads config, builds app, listens, and handles SIGTERM/SIGINT clean shutdown.

- [ ] **Step 6: Run tests**

```bash
npm run test:cloud
npm run build --workspace cloud
```

Expected: health tests pass and TypeScript build is clean.

- [ ] **Step 7: Commit**

```bash
git add cloud package.json package-lock.json
git commit -m "feat(cloud): scaffold Fastify service"
```

---

## Task 3: Integrate Better Auth for email/password, Google/GitHub, and the Android mobile-session bridge

**Files:**
- Create: `cloud/src/mail.ts`
- Create: `cloud/src/auth.ts`
- Create: `cloud/src/plugins/authSession.ts`
- Create: `cloud/src/routes/mobileAuth.ts`
- Create: `cloud/tests/auth.test.ts`
- Modify: `cloud/src/app.ts`
- Modify: `cloud/src/config.ts`
- Modify: `cloud/package.json`
- Modify: `cloud/.env.example` later in Task 14 only; do not commit real secrets now

**Dependencies:** `better-auth`, `nodemailer`, `@types/nodemailer`.

**Auth policy:**

```ts
account: {
  accountLinking: {
    disableImplicitLinking: true,
  },
}
```

Plugins:

```ts
plugins: [
  bearer(),
  oneTimeToken({
    expiresIn: 3,
    storeToken: 'hashed',
    disableClientRequest: true,
  }),
]
```

- [ ] **Step 1: Write failing auth tests**

Use a dedicated test database. Assert:

1. unauthenticated `/api/v1/me` -> `401 AUTH_REQUIRED`;
2. email sign-up creates a user;
3. email sign-in returns a usable Session;
4. same-email OAuth identity is not silently linked when `disableImplicitLinking` is enabled;
5. mobile OTT can be verified only once;
6. mobile exchange returns a Better Auth session token, never puts that long-lived token in a redirect URL.

Run: `npm run test:cloud -- --test-name-pattern auth`

Expected: failures for missing auth routes/config.

- [ ] **Step 2: Configure Better Auth**

`auth.ts` uses `authPool`, enables email/password, email verification and password reset, configures Google/GitHub only from env, and sets `trustedOrigins` from validated configuration.

Email functions call `mail.ts`; development/test may use a captured in-memory mail transport, production must require SMTP config.

- [ ] **Step 3: Mount the official Fastify-compatible Better Auth handler**

Follow the Fastify integration pattern:

```ts
fastify.route({
  method: ['GET', 'POST'],
  url: '/api/auth/*',
  async handler(request, reply) {
    const url = new URL(request.url, config.betterAuthUrl)
    const req = new Request(url, {
      method: request.method,
      headers: fromNodeHeaders(request.headers),
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    })
    const response = await auth.handler(req)
    reply.status(response.status)
    response.headers.forEach((value, key) => reply.header(key, value))
    return reply.send(response.body ? await response.text() : null)
  },
})
```

Do not parse/handle OAuth callback logic yourself.

- [ ] **Step 4: Add reusable auth-session middleware**

`authSession.ts` calls `auth.api.getSession({ headers: fromNodeHeaders(request.headers) })`, stores only trusted `{ user, session }` on the request, and returns `AUTH_REQUIRED` on failure.

- [ ] **Step 5: Implement Android OAuth handoff with one-time tokens**

Flow:

```text
Capacitor App
 -> signIn.social(disableRedirect=true)
 -> Browser.open(provider URL)
 -> provider
 -> Better Auth callback + browser cookie
 -> GET /api/v1/auth/mobile/complete
 -> server generateOneTimeToken(current browser session)
 -> 302 newsnook://auth/callback?ott=<3-minute single-use token>
 -> App receives deep link
 -> POST /api/v1/auth/mobile/exchange { token }
 -> verifyOneTimeToken
 -> return the attached Better Auth session token once
 -> Android secure store
```

`/mobile/complete` accepts no arbitrary redirect target; it always redirects to the fixed `newsnook://auth/callback` scheme. `/mobile/exchange` is rate-limited and consumes the OTT once.

- [ ] **Step 6: Support Android email/password bearer capture**

Bearer plugin sets `set-auth-token` after successful sign-in. CORS must expose only the required response header to the Android WebView. Web continues using Cookie Session and does not persist this header.

- [ ] **Step 7: Run tests/build**

```bash
npm run test:cloud
npm run build --workspace cloud
```

Expected: auth tests pass; no logged token/OTP values.

- [ ] **Step 8: Commit**

```bash
git add cloud package-lock.json
git commit -m "feat(auth): add Better Auth and mobile session bridge"
```

---

## Task 4: Add sync database schema and encrypted Secret repository

**Files:**
- Create: `cloud/migrations/001_cloud.sql`
- Create: `cloud/src/crypto/secrets.ts`
- Create: `cloud/tests/secrets.test.ts`
- Modify: `cloud/src/db/migrate.ts`

**Business tables:**

```text
devices
sync_heads
sync_mutations
subscriptions
categories
user_settings
user_secrets
sync_conflicts
```

Use Better Auth `userId` as opaque `text`; do not add a cross-schema FK to Better Auth internals.

- [ ] **Step 1: Write failing encryption tests**

Assert:

- encrypt/decrypt round-trip succeeds;
- same plaintext produces different ciphertext due to random nonce;
- changing AAD from `userA:translation.openai.apiKey` to another user/key fails authentication;
- serialized DB record does not contain plaintext.

- [ ] **Step 2: Write migration with indexes and constraints**

Important constraints:

```sql
CREATE TABLE sync_heads (
  user_id text PRIMARY KEY,
  current_revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sync_mutations (
  user_id text NOT NULL,
  mutation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);
```

Every synced entity has `(user_id, entity_id)` uniqueness plus `revision bigint`, `updated_at`, `deleted_at`. `subscriptions` adds `normalized_url` for custom-source dedupe. `sync_conflicts` never contains Secret plaintext.

- [ ] **Step 3: Implement AES-256-GCM**

`NEWSNOOK_DATA_ENCRYPTION_KEY` is decoded once to exactly 32 bytes. Store `ciphertext`, 12-byte `nonce`, auth tag (combined or explicit), and `key_version=1`. AAD is exactly `${userId}:${secretKey}`.

- [ ] **Step 4: Run migration against a disposable PostgreSQL and test**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/newsnook_test npm run db:migrate --workspace cloud
npm run test:cloud -- --test-name-pattern secret
```

Expected: migration is idempotent at the migration-table level; Secret tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud/migrations cloud/src/crypto cloud/src/db cloud/tests/secrets.test.ts
git commit -m "feat(sync): add cloud schema and secret encryption"
```

---

## Task 5: Implement the transactional push core, revision allocation, idempotency, and conflict classifier

**Files:**
- Create: `cloud/src/sync/conflicts.ts`
- Create: `cloud/src/sync/repository.ts`
- Create: `cloud/src/sync/service.ts`
- Create: `cloud/tests/sync.integration.test.ts`

**Conflict policy:**

```text
setting: stale write -> accept, server commit order wins
secret: stale write -> accept, server commit order wins
subscription upsert vs newer live subscription -> accept
subscription upsert vs server tombstone -> conflict
subscription delete when server changed since baseRevision -> conflict
category any stale mutation -> conflict
```

- [ ] **Step 1: Write failing integration tests with real PostgreSQL**

Cover:

1. accepted mutations allocate strictly increasing per-user revisions;
2. two concurrent pushes for same user never allocate duplicate revision;
3. pushes for two users can proceed without sharing the same `sync_heads` lock;
4. retrying the same `mutationId` returns stored result and does not advance revision;
5. a four-mutation batch can return three accepted + one conflict and commit all server decisions atomically;
6. transaction failure rolls back entity rows, conflict rows, mutation rows, and head revision together.

- [ ] **Step 2: Implement `FOR UPDATE` transaction boundary**

Pseudo-shape:

```ts
await client.query('BEGIN')
await client.query(
  `INSERT INTO sync_heads (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
  [userId],
)
const head = await client.query(
  `SELECT current_revision FROM sync_heads WHERE user_id = $1 FOR UPDATE`,
  [userId],
)
```

Process mutation ids inside the same transaction; allocate a new revision only for newly accepted entity changes.

- [ ] **Step 3: Persist each idempotency result**

Store one normalized result per mutation in `sync_mutations.result`. A retry must not re-run conflict classification or encryption.

- [ ] **Step 4: Implement Secret branch**

Encrypt only after validation and immediately before DB write; mutation/result logs contain Secret key name only, never payload value.

- [ ] **Step 5: Run concurrency tests repeatedly**

```bash
for i in 1 2 3 4 5; do npm run test:cloud -- --test-name-pattern sync; done
```

Expected: all five passes; no flaky duplicate revisions.

- [ ] **Step 6: Commit**

```bash
git add cloud/src/sync cloud/tests/sync.integration.test.ts
git commit -m "feat(sync): add transactional push engine"
```

---

## Task 6: Add pull, bootstrap, devices, conflicts, and HTTP routes

**Files:**
- Create: `cloud/src/routes/devices.ts`
- Create: `cloud/src/routes/sync.ts`
- Modify: `cloud/src/sync/repository.ts`
- Modify: `cloud/src/sync/service.ts`
- Modify: `cloud/src/app.ts`
- Modify: `cloud/tests/sync.integration.test.ts`

**HTTP contracts:**

```text
GET  /api/v1/me
GET  /api/v1/devices
POST /api/v1/devices/:id/revoke
GET  /api/v1/sync/bootstrap
POST /api/v1/sync/bootstrap/replace
POST /api/v1/sync/push
GET  /api/v1/sync/pull?since=N&limit=500
GET  /api/v1/sync/conflicts
POST /api/v1/sync/conflicts/:id/resolve
```

- [ ] **Step 1: Extend failing integration tests**

Assert:

- every route rejects cross-user device/entity/conflict access;
- revoked device returns `DEVICE_REVOKED` on push/pull;
- pull returns current final states with `revision > since`, sorted ascending;
- pull paginates at `limit<=500` and returns `{ cursor, currentRevision, hasMore }`;
- tombstones are returned to stale devices;
- `bootstrap/replace` tombstones old cloud entities instead of deleting them;
- conflict resolution `accept_local` creates a new revision, `accept_server` only resolves the conflict;
- bootstrap summary contains counts and cloud revision but no Secret values.

- [ ] **Step 2: Implement device registration/update**

First authenticated client call upserts `(deviceId,userId)`, records platform/appVersion/lastSeen, and refuses a device id already owned by another user.

- [ ] **Step 3: Implement bounded delta pull**

For a page, fetch all four entity tables where `revision > since`, merge and sort by revision. If records remain, `cursor` is last returned revision; final page can advance cursor to `currentRevision`.

- [ ] **Step 4: Implement first-sync replace transaction**

`bootstrap/replace` must lock `sync_heads`, turn missing existing records into tombstones/new revisions, upsert submitted snapshot, and commit once. It may be used only after explicit client first-sync choice.

- [ ] **Step 5: Register route-level validation, rate limits, and stable error payloads**

Use contract Zod schemas at the HTTP boundary. Never pass arbitrary payloads directly to SQL.

- [ ] **Step 6: Run all cloud tests**

```bash
npm run test:cloud
npm run build --workspace cloud
```

Expected: all auth/sync/health/secret tests pass.

- [ ] **Step 7: Commit**

```bash
git add cloud/src/routes cloud/src/sync cloud/src/app.ts cloud/tests
git commit -m "feat(sync): expose cloud sync APIs"
```

---

## Task 7: Build the pure client projection and sync-state reconciliation layer

**Files:**
- Create: `src/features/sync/types.ts`
- Create: `src/features/sync/projection.ts`
- Create: `src/features/sync/state.ts`
- Create: `src/features/sync/reconcile.ts`
- Create: `scripts/sync-projection.test.ts`
- Modify: `src/lib/storage.ts`
- Modify: `package.json`

**Projection rules:**

```text
subscription:
  built-in source id + enabled + rank
  custom source id + metadata + enabled + rank

category:
  built-in category id + visibility + rank + explicit source override/null
  custom category id + metadata + source ids + visibility + rank

setting:
  typography
  theme
  scheme
  customScheme
  translation non-secret fields
  proxy mode/bypass/proxy-domain fields
  autoRefreshOnCategorySwitch
  recommendEnabled
  presets

secret:
  translation.<provider>.apiKey
  proxy.url

never projected:
  einkMode
  wifiOnlyAutoLoadMedia
  prestore
  later/read/history/reading-pos/cache
```

- [ ] **Step 1: Write failing pure projection tests**

`scripts/sync-projection.test.ts` asserts:

- custom source survives projection + apply round-trip;
- deterministic existing source/category ids are preserved;
- translation `apiKey` is absent from setting payload but present as Secret key;
- `proxyUrl` is absent from setting payload and projected as `proxy.url` Secret;
- `einkMode`, Wi-Fi-only media and prestore never appear;
- changing only a local-only setting produces zero sync mutations;
- same custom source URL on two projections resolves to the same source id;
- rank order is stable.

Run: `npm run test:sync-projection`

Expected: fails before feature files exist.

- [ ] **Step 2: Add sync state storage**

Persist under `newsnook:sync-state:v1`:

```ts
export interface LocalSyncState {
  deviceId: string
  cursor: number
  shadow: Record<string, { revision: number; fingerprint: string; deleted: boolean }>
  outbox: SyncMutation[]
  firstSyncCompleted: boolean
  retryAttempt: number
  nextRetryAt: number | null
}
```

Add `sync-state:v1`, `sync-apply-journal:v1`, `sync-onboarding-seen` to native bootstrap mirror keys where appropriate. Session/Secret values do **not** go into these JSON structures.

- [ ] **Step 3: Implement reconciliation instead of requiring transactional local writes**

`reconcileProjection(current, shadow, outbox)` compares normalized fingerprints and creates missing mutations. This is the crash-recovery invariant:

> If the app dies after a local write but before Outbox was persisted, the next startup projection differs from shadow and recreates the mutation.

A mutation stores the exact fingerprint/payload it was created for. On server acknowledgement, advance shadow to the acknowledged fingerprint, not blindly to the latest live UI state.

- [ ] **Step 4: Add secret fingerprints without storing plaintext**

Use `crypto.subtle.digest('SHA-256', TextEncoder.encode(secret))` for local fingerprint only. Persist the hash, not plaintext.

- [ ] **Step 5: Run tests**

```bash
npm run test:sync-projection
npm run test:config-backup
npm run test:custom-sources
npm run test:category-order
```

Expected: new projection tests pass and old config/source tests remain green.

- [ ] **Step 6: Commit**

```bash
git add src/features/sync src/lib/storage.ts scripts/sync-projection.test.ts package.json
git commit -m "feat(sync): add local projection and reconciliation"
```

---

## Task 8: Add apply journal, merge rules, retry policy, and the client SyncEngine

**Files:**
- Create: `src/features/sync/merge.ts`
- Create: `src/features/sync/SyncEngine.ts`
- Create: `scripts/sync-engine.test.ts`
- Modify: `src/features/sync/state.ts`
- Modify: `package.json`

**Engine interface:**

```ts
export interface SyncRuntimeAdapter {
  project(): Promise<LocalProjection>
  applyRemote(records: SyncRecord[]): Promise<void>
  readState(): LocalSyncState
  writeState(state: LocalSyncState): void
  readApplyJournal(): SyncApplyJournal | null
  writeApplyJournal(journal: SyncApplyJournal): void
  clearApplyJournal(): void
}

export class SyncEngine {
  sync(reason: 'startup' | 'local-change' | 'foreground' | 'network' | 'manual'): Promise<void>
}
```

- [ ] **Step 1: Write failing engine tests with fake transport/runtime**

Cover:

1. local change -> reconcile -> push -> ack -> pull -> cursor advance;
2. HTTP response lost -> same mutation id retries;
3. user edits entity again while push is in-flight -> acknowledgement updates shadow only to old fingerprint -> second mutation is generated;
4. remote apply does not generate a sync echo;
5. app crash with an apply journal replays remote records before cursor is advanced;
6. `401` -> `authRequired`, no infinite retry;
7. `429` honors Retry-After;
8. `5xx` applies exponential backoff + jitter;
9. manual sync bypasses waiting for `nextRetryAt`;
10. concurrent triggers coalesce through a single-flight guard.

- [ ] **Step 2: Implement apply journal ordering**

Remote page apply sequence is exactly:

```text
persist journal(records,targetCursor)
 -> apply records to runtime/local storage
 -> update shadow and cursor
 -> persist sync state
 -> clear journal
```

Cold startup first checks journal and idempotently replays it.

- [ ] **Step 3: Implement bounded retry policy**

Base schedule: 1s, 2s, 4s, 8s, 16s, then cap at 5 minutes, each with jitter. Network offline pauses retries rather than incrementing endlessly.

- [ ] **Step 4: Run tests**

```bash
npm run test:sync-engine
npm run test:webview-css-compat
```

Expected: engine and compatibility tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/sync scripts/sync-engine.test.ts package.json
git commit -m "feat(sync): add resilient client sync engine"
```

---

## Task 9: Add Web/Android account adapters and Keystore-backed secure storage

**Files:**
- Create: `src/features/account/types.ts`
- Create: `src/features/account/native.ts`
- Create: `src/features/account/secureStore.ts`
- Create: `src/features/account/authClient.ts`
- Create: `src/features/account/mobileCallback.ts`
- Create: `android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java`
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MainActivity.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `src/lib/appDeepLink.ts` only if shared parser helpers are needed; auth business logic stays in account feature
- Create: `scripts/account-auth.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Secure-store keys:**

```text
account.session
secret.translation.google.apiKey
secret.translation.azure.apiKey
secret.translation.deepl.apiKey
secret.translation.deeplx.apiKey
secret.translation.openai.apiKey
secret.proxy.url
```

- [ ] **Step 1: Write failing auth adapter tests**

Test URL parser:

```text
newsnook://auth/callback?ott=abc -> abc
newsnook://auth/callback -> null
newsnook://a/<share token> -> not an auth callback
https://untrusted.example/auth/callback -> null
```

Test Web adapter never writes Better Auth cookie/token to `localStorage`. Test native adapter requires SecureStore before it reports authenticated.

- [ ] **Step 2: Implement the native secure store plugin**

Use Android Keystore (`AndroidKeyStore`) with an AES key generated by `KeyGenParameterSpec` for `PURPOSE_ENCRYPT | PURPOSE_DECRYPT`, GCM block mode, no padding. Store only `{iv,ciphertext}` in private SharedPreferences. Plugin methods:

```ts
set({ key, value }): Promise<void>
get({ key }): Promise<{ value: string | null }>
remove({ key }): Promise<void>
```

Do not use deprecated `EncryptedSharedPreferences`.

- [ ] **Step 3: Register plugin and auth deep-link intent**

`MainActivity.onCreate()` adds `registerPlugin(SecureStorePlugin.class)`.

Manifest adds a dedicated filter:

```xml
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="newsnook" android:host="auth" />
</intent-filter>
```

Do not alter the existing `newsnook://a/` share-link filter.

- [ ] **Step 4: Implement account client**

Web: Better Auth React client with credentials/cookies.

Android email/password: capture `set-auth-token`, store it in `account.session`, and add `Authorization: Bearer` to future cloud/auth requests.

Android social: call social sign-in with `disableRedirect:true`, open returned URL through `@capacitor/browser`, receive OTT deep link, exchange it, then securely store the returned session token.

- [ ] **Step 5: Run tests and Android compile**

```bash
npm run test:account-auth
npm run test:app-deep-link
npm run build
cd android && ./gradlew :app:compileCloudDebugJavaWithJavac
```

Expected: JS tests pass; Java compile succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/account src/lib/appDeepLink.ts android package.json package-lock.json scripts/account-auth.test.ts
git commit -m "feat(auth): add client adapters and secure Android session store"
```

---

## Task 10: Move synced Secret runtime values behind `SecretStore` and hydrate them before App mount

**Files:**
- Modify: `src/BootstrapRoot.tsx`
- Modify: `src/hooks/usePreferences.ts`
- Modify: `src/features/account/secureStore.ts`
- Modify: `src/features/sync/projection.ts`
- Modify: `src/sources/preferences/normalize.ts` if needed to accept runtime-injected secrets without persisting them
- Create: `scripts/secure-secret-hydration.test.ts`
- Modify: `package.json`

**Invariant:** On Android, synchronized Secret plaintext must not remain in `newsnook:preferences` / Capacitor Preferences after migration.

- [ ] **Step 1: Write failing migration/hydration tests**

Given legacy preferences containing an OpenAI API key and proxy URL on a simulated native platform:

- first bootstrap migrates values into `SecretStore`;
- persisted preferences are rewritten with blank Secret fields;
- runtime preferences still receive the Secret values after secure hydration;
- subsequent ordinary preference saves keep persisted fields blank;
- Web behavior remains compatible with existing local preference storage.

- [ ] **Step 2: Add pre-App secure hydration**

Extend `BootstrapRoot.bootstrap()`:

```text
hydrateNativeStorage()
 -> migrateLegacyNativeSecretsOnce()
 -> hydrateRuntimeSecrets()
 -> apply theme/native chrome
 -> mount App
```

Keep boot work bounded to the fixed Secret key set; do not enumerate arbitrary Keystore entries.

- [ ] **Step 3: Separate persistent-safe prefs from runtime prefs on Android**

`usePreferences` continues to expose the same `Preferences` type to the rest of the application. Before `savePreferences`, call a helper that removes Secret values on native; runtime HTTP/translation still sees hydrated values.

- [ ] **Step 4: Run regression tests**

```bash
npm run test:secure-secret-hydration
npm run test:translation
npm run test:proxy
npm run build
```

Expected: translation/proxy remain functional and Android persistence test proves plaintext does not enter normal Preferences.

- [ ] **Step 5: Commit**

```bash
git add src/BootstrapRoot.tsx src/hooks/usePreferences.ts src/features/account src/features/sync/projection.ts src/sources/preferences/normalize.ts scripts/secure-secret-hydration.test.ts package.json
git commit -m "feat(auth): secure synchronized secrets on Android"
```

---

## Task 11: Wire live runtime adapters, presets replacement, automatic triggers, and remote apply

**Files:**
- Modify: `src/hooks/usePreferences.ts`
- Modify: `src/hooks/usePresets.ts`
- Create: `src/features/sync/useCloudSync.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/logger.ts`
- Modify: `scripts/logger.test.ts`
- Create: `scripts/cloud-sync-runtime.test.ts`
- Modify: `package.json`

**New controlled APIs:**

```ts
export interface PreferencesApi {
  prefs: Preferences
  resolvedTheme: ResolvedTheme
  update(updater: (prev: Preferences) => Preferences): void
  replaceFromSync(next: Preferences): void
}

export interface UsePresetsApi {
  state: PresetsState
  replaceFromSync(next: PresetsState): void
}
```

- [ ] **Step 1: Write failing runtime-adapter tests**

Verify remote application updates `prefs`, enabled ids and presets without reload and without queuing an echo mutation. Verify current local-only settings are preserved when synced normal settings are applied.

- [ ] **Step 2: Add `account` and `sync` logger namespaces**

Extend `LogNamespace` and `ALL_NAMESPACES`; update `scripts/logger.test.ts` to prove both can be toggled. Never log auth token or Secret payload.

- [ ] **Step 3: Add explicit remote-replace entry points**

`replaceFromSync` normalizes input and updates state. Add a suppression ref scoped only around remote application so the persistence effects run normally but cloud dirty notifications do not bounce back.

- [ ] **Step 4: Implement `useCloudSync`**

It owns one `SyncEngine` and triggers sync on:

```text
startup after authenticated session restoration
local projection changes, debounced
Capacitor App active/foreground
@capacitor/network offline -> online
manual request
```

Do not add timer polling or WebSocket.

- [ ] **Step 5: Run tests**

```bash
npm run test:cloud-sync-runtime
npm run test:logger
npm run test:product-tour
npm run build
```

Expected: runtime adapter, logger and legacy tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/hooks src/features/sync src/App.tsx src/lib/logger.ts scripts package.json
git commit -m "feat(sync): connect sync engine to NewsNook runtime"
```

---

## Task 12: Add account/sync settings UI, first-run guidance, first-sync chooser, conflicts, and sync feedback

**Files:**
- Create: `src/screens/settings/AccountSyncScreen.tsx`
- Create: `src/features/account/SyncOnboardingPrompt.tsx`
- Create: `src/components/SyncToast.tsx`
- Create: `src/features/sync/notifier.ts`
- Modify: `src/screens/MeScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/features/productTour/steps.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/lib/backup.ts`
- Create: `scripts/account-sync-ui.test.ts`
- Modify: `package.json`

**UX requirements:**

```text
No account:
  Account & Sync -> sign in/register + sync benefits

Authenticated, first sync pending:
  local/cloud counts -> [使用本机] [使用云端] [合并]

Authenticated, normal:
  last sync time
  sync now
  devices
  linked methods
  conflict count
  sign out
```

- [ ] **Step 1: Write failing UI/state tests**

Pure presenter tests must assert:

- not logged in -> caption “登录后可跨设备同步”;
- syncing -> `正在同步…`;
- success -> recent sync caption;
- conflict -> badge count;
- normal background success does not request Android notification;
- repeated failure / conflict / first sync complete may request Android notification;
- product-tour welcome text says “无需账号也能使用”, not absolute “无账号”.

- [ ] **Step 2: Add a dedicated first-run sync prompt**

Do not turn driver.js product tour into an interactive auth wizard. After the existing tour/initial onboarding no longer blocks the screen, show `SyncOnboardingPrompt` once, controlled by `newsnook:sync-onboarding-seen`:

```text
跨设备同步你的 NewsNook
[登录并开启同步]
[稍后再说]
```

Both actions mark it seen; login opens Account & Sync.

- [ ] **Step 3: Add Account & Sync to Me/SettingsRoute**

Add `{ name: 'account-sync' }` to `SettingsRoute`, a `Cloud`/account row in `MeScreen`, and normal Android back handling through existing settings stack.

- [ ] **Step 4: Reuse backup machinery for pre-bootstrap safety snapshot**

Add an internal helper that captures only sync-relevant local sections before first-sync replacement. Do not include later/read/history/reading position. Store the snapshot locally with a timestamp and expose a one-time “恢复同步前配置” action until a later successful manual change makes it obsolete.

- [ ] **Step 5: Implement three first-sync choices**

- 使用本机 -> local safety snapshot -> `/bootstrap/replace` -> pull final state -> mark firstSyncCompleted.
- 使用云端 -> local safety snapshot -> pull from 0 -> apply -> mark firstSyncCompleted.
- 合并 -> local safety snapshot -> reconcile/push local -> pull remote -> show high-risk conflicts -> mark firstSyncCompleted when transport completes.

Never replace body/list caches.

- [ ] **Step 6: Implement conflict UI**

Show only high-risk conflict summaries. Actions map to `accept_local` / `accept_server`; Secret values are never displayed as conflict payload.

- [ ] **Step 7: Run UI/regression tests**

```bash
npm run test:account-sync-ui
npm run test:product-tour
npm run test:config-backup
npm run build
```

Expected: tests pass and no existing backup section changes semantics.

- [ ] **Step 8: Commit**

```bash
git add src/screens src/components src/features/account src/features/sync src/App.tsx src/lib/storage.ts src/lib/backup.ts scripts package.json
git commit -m "feat(sync): add account and sync user experience"
```

---

## Task 13: Add Android high-value sync notifications without notification spam

**Files:**
- Create: `android/app/src/main/java/com/aizeek/newsnook/SyncNotificationPlugin.java`
- Create: `src/features/sync/nativeNotification.ts`
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MainActivity.java`
- Modify: `src/features/sync/notifier.ts`
- Create: `scripts/sync-notifier.test.ts`
- Modify: `package.json`

**Notification policy:**

```text
never system-notify:
  normal automatic success
  every local change
  normal foreground syncing

may system-notify:
  first cloud sync completed
  repeated sync failure after retry threshold
  conflict requiring user action
```

`POST_NOTIFICATIONS` is already in the manifest; do not request permission on startup solely for sync. Request/route through existing app permission UX only when an actual user-visible notification feature requires it.

- [ ] **Step 1: Write failing policy tests**

`mapSyncEventToNotification(event, appVisibility)` returns `null` for normal success and a stable notification model for the three allowed cases.

- [ ] **Step 2: Implement minimal native plugin**

Use `NotificationManager` / `NotificationCompat`, one `newsnook-sync` channel, stable notification ids so repeated errors update rather than stack dozens of cards. Tapping notification opens the app; conflict notification should include intent data the JS layer can translate to opening Account & Sync after launch.

- [ ] **Step 3: Register plugin and connect notifier**

Foreground always prefers `SyncToast`; native notifications only when policy says so and permission is available.

- [ ] **Step 4: Run tests/compile**

```bash
npm run test:sync-notifier
npm run build
cd android && ./gradlew :app:compileCloudDebugJavaWithJavac
```

Expected: tests and Java compile pass.

- [ ] **Step 5: Commit**

```bash
git add android src/features/sync scripts/sync-notifier.test.ts package.json
git commit -m "feat(sync): add Android sync notifications"
```

---

## Task 14: Add CI, deployment assets, docs, and end-to-end verification

**Files:**
- Create: `.github/workflows/cloud-sync-ci.yml`
- Create: `cloud/Dockerfile`
- Create: `cloud/compose.yml`
- Create: `cloud/.env.example`
- Create: `docs/cloud-deploy.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/architecture.md`
- Modify: `AGENTS.md` if implementation details changed from Task 1 wording
- Modify: `README.md` only to document optional account/cloud capability; do not make cloud a prerequisite for installation

**CI requirements:**

- Node version follows repo contributor requirement.
- PostgreSQL service container.
- Build contracts.
- Run cloud migration explicitly.
- Run cloud tests against real PostgreSQL.
- Run root sync/account tests.
- Run `npm run lint` and `npm run build`.
- Keep existing Android release workflows unchanged.

- [ ] **Step 1: Add failing CI-equivalent local verification script/commands to docs**

Before adding workflow, run the intended command sequence locally and record any missing script as failure.

- [ ] **Step 2: Add CI workflow**

Workflow sequence:

```text
checkout
 -> setup Node
 -> npm ci
 -> postgres health
 -> npm run build:contracts
 -> npm run db:migrate --workspace cloud
 -> npm run test:cloud
 -> account/sync client tests
 -> npm run lint
 -> npm run build
```

Use dummy test-only auth/encryption/SMTP values; never use production OAuth secrets in pull-request CI.

- [ ] **Step 3: Add Dockerfile/Compose**

Compose contains only `newsnook-api` and `postgres`. API does not auto-migrate on container start. Document separate migration command before deployment.

- [ ] **Step 4: Add `.env.example` with names, never real values**

Required names:

```text
DATABASE_URL
BETTER_AUTH_URL
BETTER_AUTH_SECRET
NEWSNOOK_DATA_ENCRYPTION_KEY
CLIENT_ORIGINS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

- [ ] **Step 5: Write deployment and backup runbook**

`docs/cloud-deploy.md` covers:

```text
backup
 -> explicit migration
 -> deploy API
 -> /health/live
 -> /health/ready
 -> smoke auth
 -> smoke sync
```

Document daily PostgreSQL dump, off-host/object-storage retention, restore drill, and keeping data-encryption key separate from DB backup.

- [ ] **Step 6: Run the full verification gate**

```bash
npm ci
npm run build:contracts
npm run test:cloud-contracts
npm run test:sync-projection
npm run test:sync-engine
npm run test:account-auth
npm run test:secure-secret-hydration
npm run test:cloud-sync-runtime
npm run test:account-sync-ui
npm run test:sync-notifier
npm run test:product-tour
npm run test:config-backup
npm run test:logger
npm run test:webview-css-compat
npm run test:cloud
npm run lint
npm run build
cd android && ./gradlew :app:compileCloudDebugJavaWithJavac :app:compileLocalDebugJavaWithJavac
```

Expected: every command exits 0.

- [ ] **Step 7: Manual staging / real-device acceptance**

Perform and record:

1. Web email register -> verification -> login -> cookie session -> sync.
2. Web Google and GitHub login.
3. Android email/password -> secure session survives process kill.
4. Android Google/GitHub -> system browser -> `newsnook://auth/callback` -> session restored.
5. Existing local data + empty cloud -> each of three first-sync choices behaves as labeled.
6. Two devices offline edit different settings -> reconnect -> converge automatically.
7. Device A deletes source while B edits it -> conflict shown, other entities still sync.
8. Android offline edit -> kill app -> restart offline -> reconnect -> Outbox reconstructed and synced.
9. Revoke device from another device -> revoked device retains local content but cloud sync stops.
10. Sync Secret -> second Android device receives it; PostgreSQL inspection shows ciphertext only; logs contain no Secret.
11. Cloud API/PostgreSQL stopped -> NewsNook still reads local feeds/caches and local settings remain editable.
12. Android WebView compatibility device/version still opens the app and the account screen; no modern-browser-only syntax regression.

- [ ] **Step 8: Update docs to match shipped behavior**

User guide must clearly distinguish:

```text
without login: full local reader
with login: optional config/subscription/secret sync
not synced: article bodies/cache/read/favorites/history/progress
```

- [ ] **Step 9: Commit**

```bash
git add .github cloud docs AGENTS.md README.md
git commit -m "docs(sync): add cloud deployment and verification"
```

---

## Completion Criteria

Implementation is complete only when all of the following are true:

- Account/cloud is optional and local reading works with the cloud fully unavailable.
- Email/password, Google and GitHub auth work on Web and Android.
- Android long-lived Session and synced Secret plaintext are Keystore-backed, not normal Preferences/localStorage.
- First login always asks the user how to treat local/cloud data when both sides have data.
- Normal sync uses projection reconciliation + Outbox + server revision + tombstones and survives app/network/process failures.
- Same-user concurrent pushes are serialized by PostgreSQL and idempotent retries do not duplicate revisions.
- High-risk conflicts are visible and resolvable without blocking unrelated sync.
- Normal successful background sync does not spam Android notifications.
- Cloud database stores Secret ciphertext only and application logs contain no credentials.
- Real PostgreSQL integration/concurrency tests, root regression tests, builds, lint and both Android Java variants pass.
- Architecture/user/deployment documentation no longer claims that optional cloud capability is forbidden, while still documenting local-first as a hard product rule.
