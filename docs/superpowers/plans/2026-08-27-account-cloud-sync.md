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
- 日常 remote pull 不 reload App；只有首次整包基线切换完成后允许受控 reload。
- 客户端 `src/` 新日志必须走 `lib/logger.ts`，不得直接 `console.*`。
- 旧 Android WebView 69 继续可运行；同步客户端不依赖 Service Worker、Background Sync API 或现代浏览器专属语法。
- 业务 API 从 Better Auth Session 推导 `userId`，从不信任 payload 里的 user id。
- 所有错误响应带 Fastify `request.id`，客户端可展示短错误编号；日志可按 request id 关联，但不得记录 Token/Secret。
- 所有新网络 payload 必须在边界做 schema validation；push 必须有 mutation 数量与 body size 上限。
- 实现期间持续运行旧测试，不通过删除或弱化旧测试换取绿色 CI。

## Repo-specific refinement

现有 NewsNook 已经有稳定 domain id：内置信源 id、分类 id、自定义信源 id 都可以离线确定。实现时不再给每条业务记录增加第二套 UUID 映射：

```text
subscription.entityId = existing source id
category.entityId     = existing category id
setting.entityId      = stable setting key
secret.entityId       = stable secret key
```

只有同步专用对象使用 UUID：`deviceId`、`mutationId`、`conflictId`。这样保持 OPML、Preferences 与现有 source/category 语义不变。

## Target File Structure

```text
packages/contracts/src/{index,errors,auth,sync}.ts
cloud/
  migrations/001_cloud.sql
  src/{app,server,config,auth,mail}.ts
  src/db/{pools,migrate}.ts
  src/crypto/secrets.ts
  src/plugins/authSession.ts
  src/routes/{health,mobileAuth,devices,sync}.ts
  src/sync/{repository,conflicts,service}.ts
  tests/*
src/features/account/*
src/features/sync/*
src/screens/settings/AccountSyncScreen.tsx
src/components/SyncToast.tsx
android/app/src/main/java/com/aizeek/newsnook/{SecureStorePlugin,SyncNotificationPlugin}.java
scripts/*sync*.test.ts
.github/workflows/cloud-sync-ci.yml
docs/cloud-deploy.md
```

---

### Task 1: Update the product boundary and add shared contracts

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `package.json`, `package-lock.json`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`, `errors.ts`, `auth.ts`, `sync.ts`
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
```

- [ ] **Step 1: Write the failing contract test**

Create `scripts/cloud-sync-contracts.test.ts`:

```ts
import assert from 'node:assert/strict'
import {
  SYNC_PROTOCOL_VERSION,
  syncPushRequestSchema,
  syncPullResponseSchema,
} from '@newsnook/contracts'

assert.equal(SYNC_PROTOCOL_VERSION, 1)
assert.equal(syncPushRequestSchema.safeParse({
  protocolVersion: 1,
  deviceId: '8d6f3192-9f48-4cfb-8601-791d28f5513d',
  mutations: [],
}).success, true)
assert.equal(syncPushRequestSchema.safeParse({
  protocolVersion: 2,
  deviceId: 'bad',
  mutations: [],
}).success, false)
assert.equal(syncPullResponseSchema.safeParse({
  records: [], cursor: 0, currentRevision: 0, hasMore: false,
}).success, true)
```

- [ ] **Step 2: Verify red**

Run: `npm run test:cloud-contracts`

Expected: fails because the package/script does not exist.

- [ ] **Step 3: Add the minimal workspace and protocol package**

Root `package.json` gains workspaces `cloud` and `packages/contracts`; contracts package exports Zod schemas and stable error codes:

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

All error responses use:

```ts
export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  requestId: string
}
```

- [ ] **Step 4: Replace the obsolete Backendless hard rule**

Update `AGENTS.md` and `docs/architecture.md` to say cloud/account is optional but core reading remains local-first. Add `cloud/` and `packages/contracts/` to the architecture map. Do not weaken the rule that feed/body fetching remains client/upstream-oriented.

- [ ] **Step 5: Green**

```bash
npm install
npm run test:cloud-contracts
npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md docs/architecture.md package.json package-lock.json packages/contracts scripts/cloud-sync-contracts.test.ts
git commit -m "feat(sync): add shared cloud protocol contracts"
```

---

### Task 2: Scaffold Fastify, config, logging, health checks, and explicit migration runner

**Files:**
- Create: `cloud/package.json`, `cloud/tsconfig.json`
- Create: `cloud/src/config.ts`, `app.ts`, `server.ts`
- Create: `cloud/src/db/pools.ts`, `migrate.ts`
- Create: `cloud/src/routes/health.ts`
- Create: `cloud/tests/health.test.ts`
- Modify: root `package.json`, `package-lock.json`

**Produces:**

```ts
export interface CloudConfig {
  port: number
  databaseUrl: string
  betterAuthUrl: string
  clientOrigins: string[]
  betterAuthSecret: string
  dataEncryptionKey: string
}

export async function buildApp(options?: {
  pool?: Pool
  authPool?: Pool
  config?: CloudConfig
}): Promise<FastifyInstance>
```

- [ ] **Step 1: Write failing health tests**

Test `/health/live` without DB, `/health/ready` 200 when `SELECT 1` works, and 503 when injected pool rejects.

- [ ] **Step 2: Verify red**

Run: `npm run test:cloud -- --test-name-pattern health`

- [ ] **Step 3: Add cloud package**

Scripts:

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/server.js",
  "test": "tsx --test tests/**/*.test.ts",
  "db:migrate": "tsx src/db/migrate.ts"
}
```

Dependencies: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `pg`, `zod`, `@newsnook/contracts`; dev dependencies include `tsx`, TypeScript and types.

- [ ] **Step 4: Implement strict environment parsing and two pools**

Reject missing/short security secrets. Parse explicit origin allowlist. Use `appPool` for NewsNook tables and `authPool` with `search_path=auth` for Better Auth tables. No route creates its own pool.

- [ ] **Step 5: Implement Fastify app/server split**

`app.ts` owns CORS, body limit, rate limiting, health routes and structured Pino logs. `server.ts` only loads config, listens and closes on SIGTERM/SIGINT. Add error handler that returns stable code + `request.id`; sync log entries later reuse `requestId,userId,deviceId,fromRevision,toRevision,durationMs`.

- [ ] **Step 6: Green**

```bash
npm run test:cloud
npm run build --workspace cloud
```

- [ ] **Step 7: Commit**

```bash
git add cloud package.json package-lock.json
git commit -m "feat(cloud): scaffold Fastify service"
```

---

### Task 3: Integrate Better Auth for email/password, Google/GitHub, recovery, linking, and Android bearer handoff

**Files:**
- Create: `cloud/src/mail.ts`, `cloud/src/auth.ts`, `cloud/src/plugins/authSession.ts`
- Create: `cloud/src/routes/mobileAuth.ts`
- Create: `cloud/tests/auth.test.ts`
- Modify: `cloud/src/app.ts`, `cloud/src/config.ts`, `cloud/package.json`, lockfile

**Auth policy:** Better Auth owns password hashing, email verification, reset tokens, OAuth callback and account records. Configure:

```ts
account: {
  accountLinking: { disableImplicitLinking: true },
}
```

Plugins:

```ts
bearer()
oneTimeToken({ expiresIn: 3, storeToken: 'hashed', disableClientRequest: true })
```

- [ ] **Step 1: Write failing auth tests**

Cover:

1. unauthenticated `/api/v1/me` -> `401 AUTH_REQUIRED` + requestId;
2. sign-up sends verification mail and verified email can sign in;
3. unverified email is rejected when verification is required;
4. forgot-password emits reset mail and reset token changes credential;
5. same-email OAuth identity is not silently linked;
6. authenticated explicit account-link flow is accepted;
7. generated mobile OTT is single-use and expires;
8. mobile exchange never places long-lived Session token in redirect URL.

- [ ] **Step 2: Configure Better Auth**

Use `authPool`; enable email/password, required email verification, password reset, Google and GitHub providers, strict trusted origins. `mail.ts` provides injectable transport: in-memory capture for tests, SMTP in production.

- [ ] **Step 3: Mount Better Auth through its Fastify-compatible handler**

Forward `GET/POST /api/auth/*` to `auth.handler`, preserving response headers/cookies. Do not reimplement OAuth callbacks.

- [ ] **Step 4: Add reusable authenticated request middleware**

Call `auth.api.getSession({ headers })`; attach trusted session/user server-side only. Client-supplied user id is ignored.

- [ ] **Step 5: Implement Android OAuth handoff without exposing the Session in a deep link**

```text
App -> social signIn(disableRedirect=true)
 -> system browser
 -> provider + Better Auth callback
 -> /api/v1/auth/mobile/complete (browser cookie required)
 -> generateOneTimeToken(current session)
 -> 302 newsnook://auth/callback?ott=<single-use token>
 -> App POST /api/v1/auth/mobile/exchange
 -> verifyOneTimeToken
 -> return verified.session.token from Better Auth's documented Session shape
 -> native secure store
```

Compilation/type tests must use the documented public `session.token` field; do not query Better Auth internal tables to recover a token. The completion route has a fixed `newsnook://auth/callback` target and accepts no arbitrary redirect URL.

- [ ] **Step 6: Support Android email/password bearer capture**

Bearer plugin exposes `set-auth-token` after successful sign-in. Android captures it and later sends `Authorization: Bearer`; Web continues using cookies. CORS exposes only required response headers.

- [ ] **Step 7: Green**

```bash
npm run test:cloud
npm run build --workspace cloud
```

- [ ] **Step 8: Commit**

```bash
git add cloud package-lock.json
git commit -m "feat(auth): add Better Auth and mobile session bridge"
```

---

### Task 4: Add sync schema and encrypted Secret repository

**Files:**
- Create: `cloud/migrations/001_cloud.sql`
- Create: `cloud/src/crypto/secrets.ts`
- Create: `cloud/tests/secrets.test.ts`
- Modify: `cloud/src/db/migrate.ts`

**Business tables:** `devices`, `sync_heads`, `sync_mutations`, `subscriptions`, `categories`, `user_settings`, `user_secrets`, `sync_conflicts`.

Use Better Auth user id as opaque `text`; do not FK business schema to Better Auth internals.

- [ ] **Step 1: Write failing encryption/schema tests**

Assert AES-GCM round trip, random nonce, AAD mismatch failure, DB serialization contains no plaintext, and schema has required unique/index constraints.

- [ ] **Step 2: Write the migration**

Minimum core:

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

`subscriptions` and `categories` must explicitly store `sort_rank text NOT NULL`; all four entity tables have `(user_id,entity_id)` uniqueness, `revision bigint`, `updated_at`, `deleted_at`. Subscription also stores `normalized_url` for custom-source dedupe. `user_secrets` stores ciphertext/nonce/key_version only. `sync_conflicts` never stores Secret plaintext.

- [ ] **Step 3: Implement AES-256-GCM**

Decode `NEWSNOOK_DATA_ENCRYPTION_KEY` to exactly 32 bytes once. Use random 12-byte nonce and AAD `${userId}:${secretKey}`. Store `key_version=1`.

- [ ] **Step 4: Green against real disposable PostgreSQL**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/newsnook_test npm run db:migrate --workspace cloud
npm run test:cloud -- --test-name-pattern secret
```

- [ ] **Step 5: Commit**

```bash
git add cloud/migrations cloud/src/crypto cloud/src/db cloud/tests/secrets.test.ts
git commit -m "feat(sync): add cloud schema and secret encryption"
```

---

### Task 5: Implement transactional push, revisions, idempotency, conflicts, and structured sync logs

**Files:**
- Create: `cloud/src/sync/conflicts.ts`, `repository.ts`, `service.ts`
- Create: `cloud/tests/sync.integration.test.ts`

**Conflict policy:**

```text
setting stale write                    -> accept; server commit order wins
secret stale write                     -> accept; server commit order wins
subscription upsert vs newer live row  -> accept
subscription upsert vs tombstone       -> conflict
subscription delete vs newer row       -> conflict
category stale mutation                -> conflict
```

- [ ] **Step 1: Write failing real-Postgres tests**

Cover strictly increasing revisions, same-user concurrent push, different-user independence, mutation replay idempotency, 3 accepted + 1 conflict batch, and full transaction rollback on injected failure.

- [ ] **Step 2: Implement per-user transaction lock**

```ts
await client.query('BEGIN')
await client.query(
  'INSERT INTO sync_heads (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
  [userId],
)
const head = await client.query(
  'SELECT current_revision FROM sync_heads WHERE user_id=$1 FOR UPDATE',
  [userId],
)
```

Allocate a new revision only for a newly accepted entity change.

- [ ] **Step 3: Persist idempotency result in the same transaction**

Retrying `(user_id,mutation_id)` returns stored result without re-running conflict classification or encryption.

- [ ] **Step 4: Implement Secret branch and safe logs**

Validate → encrypt → write. Logs record `secretKey` name only, never value. Every push emits one structured summary with requestId, userId, deviceId, mutation/accepted/conflict counts, from/to revision and duration.

- [ ] **Step 5: Run concurrency test five times**

```bash
for i in 1 2 3 4 5; do npm run test:cloud -- --test-name-pattern sync; done
```

- [ ] **Step 6: Commit**

```bash
git add cloud/src/sync cloud/tests/sync.integration.test.ts
git commit -m "feat(sync): add transactional push engine"
```

---

### Task 6: Add pull, bootstrap, devices, conflict resolution, and protected HTTP routes

**Files:**
- Create: `cloud/src/routes/devices.ts`, `cloud/src/routes/sync.ts`
- Modify: `cloud/src/sync/repository.ts`, `service.ts`, `cloud/src/app.ts`
- Modify: `cloud/tests/sync.integration.test.ts`

**Routes:**

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

Verify cross-user access rejection, revoked-device rejection, tombstone pull, bounded pagination, bootstrap replace tombstones missing rows, `accept_local` creates revision, `accept_server` only resolves conflict, bootstrap summary exposes counts/revision but not Secret values, and every error body includes requestId.

- [ ] **Step 2: Implement device registration/update**

First authenticated cloud call upserts `(deviceId,userId)` with platform/appVersion/lastSeen. Reject a device id already owned by another user.

- [ ] **Step 3: Implement delta pull**

Fetch current rows from all four entity tables where `revision > since`, merge/sort by revision. Page size max 500. On non-final page cursor = last returned revision; final page may advance to `currentRevision`.

- [ ] **Step 4: Implement `bootstrap/replace` as one transaction**

Lock head, create tombstones for old records missing from submitted snapshot, upsert submitted state, allocate revisions, commit once. Never `DELETE everything`.

- [ ] **Step 5: Add request validation/limits and conflict resolution**

All handlers consume contract Zod schemas; entity/device/conflict ownership is verified server-side.

- [ ] **Step 6: Green**

```bash
npm run test:cloud
npm run build --workspace cloud
```

- [ ] **Step 7: Commit**

```bash
git add cloud/src/routes cloud/src/sync cloud/src/app.ts cloud/tests
git commit -m "feat(sync): expose cloud sync APIs"
```

---

### Task 7: Build client projection, shadow/outbox state, and crash-safe reconciliation

**Files:**
- Create: `src/features/sync/types.ts`, `projection.ts`, `state.ts`, `reconcile.ts`
- Create: `scripts/sync-projection.test.ts`
- Modify: `src/lib/storage.ts`, `package.json`

**Projection rules:**

```text
subscription:
  built-in source id + enabled + rank
  custom source id + metadata + enabled + rank

category:
  built-in category id + visibility + rank + explicit source override/null
  custom category id + metadata + source ids + visibility + rank

setting:
  typography/theme/scheme/customScheme
  translation non-secret fields
  proxy mode/bypass/proxy-domain fields
  autoRefreshOnCategorySwitch/recommendEnabled
  presets

secret:
  translation.<provider>.apiKey
  proxy.url

never projected:
  einkMode/wifiOnlyAutoLoadMedia/prestore
  later/read/history/reading-pos/cache
```

- [ ] **Step 1: Write failing projection tests**

Round-trip custom source/category, stable ids, Secret separation, device-local exclusion, rank stability, and “changing local-only setting generates zero mutations.”

- [ ] **Step 2: Add persisted sync state**

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

Persist as `newsnook:sync-state:v1`; add required sync-state/journal/onboarding keys to native bootstrap mirror. Do not place Session or Secret plaintext in these structures.

- [ ] **Step 3: Implement projection reconciliation**

`reconcileProjection(current,shadow,outbox)` creates missing mutations from normalized fingerprints. If app dies after a local write but before Outbox persistence, next startup rebuilds the mutation from current projection vs shadow.

A mutation retains the exact fingerprint/payload it represents; server ack advances shadow to that fingerprint, not blindly to the newest live UI state.

- [ ] **Step 4: Hash Secret fingerprints only**

Use SHA-256 to detect changes; persist hash only, not plaintext.

- [ ] **Step 5: Green/regression**

```bash
npm run test:sync-projection
npm run test:config-backup
npm run test:custom-sources
npm run test:category-order
```

- [ ] **Step 6: Commit**

```bash
git add src/features/sync src/lib/storage.ts scripts/sync-projection.test.ts package.json
git commit -m "feat(sync): add local projection and reconciliation"
```

---

### Task 8: Add apply journal, merge rules, retry policy, and SyncEngine

**Files:**
- Create: `src/features/sync/merge.ts`, `SyncEngine.ts`
- Create: `scripts/sync-engine.test.ts`
- Modify: `src/features/sync/state.ts`, `package.json`

**Interface:**

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

- [ ] **Step 1: Write failing engine tests**

Cover normal push/pull, lost HTTP response, edit-while-push-in-flight, no sync echo, apply-journal crash replay, 401 pause, 429 Retry-After, 5xx exponential backoff+jitter, manual bypass of retry timer, and single-flight trigger coalescing.

- [ ] **Step 2: Implement journal ordering**

```text
persist journal(records,targetCursor)
 -> apply records
 -> update shadow + cursor
 -> persist sync state
 -> clear journal
```

Cold startup replays any journal before new pull.

- [ ] **Step 3: Implement bounded backoff**

1s,2s,4s,8s,16s… capped at 5 minutes with jitter. Offline pauses retries. Manual sync triggers immediately.

- [ ] **Step 4: Green**

```bash
npm run test:sync-engine
npm run test:webview-css-compat
```

- [ ] **Step 5: Commit**

```bash
git add src/features/sync scripts/sync-engine.test.ts package.json
git commit -m "feat(sync): add resilient client sync engine"
```

---

### Task 9: Add Web/Android account adapters and Keystore-backed secure storage

**Files:**
- Create: `src/features/account/{types,native,secureStore,authClient,mobileCallback}.ts`
- Create: `android/app/src/main/java/com/aizeek/newsnook/SecureStorePlugin.java`
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MainActivity.java`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Create: `scripts/account-auth.test.ts`
- Modify: `package.json`, lockfile

- [ ] **Step 1: Write failing auth-adapter tests**

Parse only `newsnook://auth/callback?ott=...`; do not confuse `newsnook://a/...`. Web adapter must never write Session token into localStorage. Native adapter reports authenticated only after SecureStore has a valid token.

- [ ] **Step 2: Implement `SecureStorePlugin`**

Use Android Keystore (`AndroidKeyStore`) AES key via `KeyGenParameterSpec`, `PURPOSE_ENCRYPT|PURPOSE_DECRYPT`, GCM/no-padding. Private SharedPreferences stores only `{iv,ciphertext}`. API:

```ts
set({key,value}): Promise<void>
get({key}): Promise<{value:string|null}>
remove({key}): Promise<void>
```

Do not use deprecated `EncryptedSharedPreferences`.

- [ ] **Step 3: Register plugin and auth deep link**

Register in `MainActivity`; add dedicated `newsnook://auth/*` intent filter without changing existing share deep links.

- [ ] **Step 4: Implement Web and Android auth clients**

Web uses Better Auth Cookie Session. Android captures bearer token after email/password and uses system browser + OTT exchange for social login. Long-lived bearer token goes only to SecureStore.

- [ ] **Step 5: Green**

```bash
npm run test:account-auth
npm run test:app-deep-link
npm run build
cd android && ./gradlew :app:compileCloudDebugJavaWithJavac
```

- [ ] **Step 6: Commit**

```bash
git add src/features/account android scripts/account-auth.test.ts package.json package-lock.json
git commit -m "feat(auth): add client adapters and secure Android session store"
```

---

### Task 10: Move synced Secret runtime values behind SecretStore and hydrate before App mount

**Files:**
- Modify: `src/BootstrapRoot.tsx`, `src/hooks/usePreferences.ts`
- Modify: `src/features/account/secureStore.ts`, `src/features/sync/projection.ts`
- Modify: `src/sources/preferences/normalize.ts` only if needed
- Create: `scripts/secure-secret-hydration.test.ts`
- Modify: `package.json`

**Invariant:** On Android, synced Secret plaintext must not remain in ordinary `newsnook:preferences` / Capacitor Preferences.

- [ ] **Step 1: Write failing migration/hydration tests**

Given legacy native prefs with an OpenAI API key and proxy URL: migrate to secure store, rewrite persisted normal prefs with blanks, hydrate runtime values before App mount, keep subsequent ordinary persistence secret-free. Web remains backward-compatible.

- [ ] **Step 2: Extend bootstrap ordering**

```text
hydrateNativeStorage()
 -> migrateLegacyNativeSecretsOnce()
 -> hydrateRuntimeSecrets()
 -> apply theme/native chrome
 -> mount App
```

- [ ] **Step 3: Keep runtime `Preferences` API stable**

On native, sanitize before `savePreferences`; runtime translation/proxy still receives hydrated Secret values. Do not refactor all callers.

- [ ] **Step 4: Green/regression**

```bash
npm run test:secure-secret-hydration
npm run test:translation
npm run test:proxy
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/BootstrapRoot.tsx src/hooks/usePreferences.ts src/features/account src/features/sync/projection.ts src/sources/preferences/normalize.ts scripts/secure-secret-hydration.test.ts package.json
git commit -m "feat(auth): secure synchronized secrets on Android"
```

---

### Task 11: Wire live runtime adapters and automatic sync triggers

**Files:**
- Modify: `src/hooks/usePreferences.ts`, `src/hooks/usePresets.ts`
- Create: `src/features/sync/useCloudSync.ts`
- Modify: `src/App.tsx`, `src/lib/logger.ts`, `scripts/logger.test.ts`
- Create: `scripts/cloud-sync-runtime.test.ts`
- Modify: `package.json`

**Controlled APIs:**

```ts
PreferencesApi.replaceFromSync(next: Preferences): void
UsePresetsApi.replaceFromSync(next: PresetsState): void
```

- [ ] **Step 1: Write failing runtime tests**

Remote application updates prefs/enabled ids/presets without reload and without echo; device-local settings survive remote apply.

- [ ] **Step 2: Add `account` and `sync` log namespaces**

Update logger tests. Never log auth token or Secret payload.

- [ ] **Step 3: Add remote replace entry points**

Normalize remote state and use suppression scoped only around cloud dirty detection; normal local persistence still runs.

- [ ] **Step 4: Implement `useCloudSync` triggers**

Trigger on restored authenticated startup, debounced local projection change, foreground, network offline→online, and manual sync. No polling/WebSocket.

- [ ] **Step 5: Green**

```bash
npm run test:cloud-sync-runtime
npm run test:logger
npm run test:product-tour
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks src/features/sync src/App.tsx src/lib/logger.ts scripts package.json
git commit -m "feat(sync): connect sync engine to NewsNook runtime"
```

---

### Task 12: Add account/sync UI, first-run guidance, first-sync chooser, account management, and conflict UI

**Files:**
- Create: `src/screens/settings/AccountSyncScreen.tsx`
- Create: `src/features/account/{useAccount,SyncOnboardingPrompt}.tsx`
- Create: `src/components/SyncToast.tsx`
- Create: `src/features/sync/notifier.ts`
- Modify: `src/screens/MeScreen.tsx`, `src/App.tsx`
- Modify: `src/features/productTour/steps.ts`
- Modify: `src/lib/storage.ts`, `src/lib/backup.ts`
- Create: `scripts/account-sync-ui.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing UI/presenter tests**

Assert not-logged-in caption, syncing/success/conflict statuses, product-tour wording “无需账号也能使用”, normal success no system notification, and account screen exposes expected actions by state.

- [ ] **Step 2: Add a separate one-time sync onboarding prompt**

Do not turn driver.js tour into auth wizard. After existing onboarding no longer blocks, show once:

```text
跨设备同步你的 NewsNook
[登录并开启同步]
[稍后再说]
```

Both actions mark `newsnook:sync-onboarding-seen`; login opens Account & Sync.

- [ ] **Step 3: Add Account & Sync route and screen**

Add `{name:'account-sync'}` to `SettingsRoute`, row in `MeScreen`, normal back-stack behavior. Screen states:

```text
anonymous -> sign in/register/forgot password
first sync pending -> local/cloud counts + three choices
authenticated -> last sync, sync now, conflicts, devices, linked methods, sign out
```

- [ ] **Step 4: Implement explicit account linking**

When already authenticated, “绑定 Google / GitHub” uses Better Auth's authenticated linking API (`linkSocial`/documented equivalent). Same-email unauthenticated OAuth remains blocked by `disableImplicitLinking`; never silently merge two users.

- [ ] **Step 5: Implement device list/revoke UI**

List current and other devices with platform/lastSeen. Revoking another device calls server revoke route. Revoking/current-session sign-out clears only that device's cloud credential and stops sync; uploaded user data remains.

- [ ] **Step 6: Implement sign out**

Web calls Better Auth sign-out and clears sync session state; Android additionally removes `account.session` SecureStore entry. Keep local subscriptions/config/Secret runtime data; do not reset NewsNook.

- [ ] **Step 7: Reuse backup machinery for pre-bootstrap safety snapshot**

Capture only sync-relevant local sections before first baseline choice. Keep one timestamped “同步前配置” snapshot and expose recovery. Do not include later/read/history/reading position/cache.

- [ ] **Step 8: Implement three first-sync choices**

```text
使用本机 -> safety snapshot -> bootstrap/replace -> pull final -> mark complete
使用云端 -> safety snapshot -> pull from 0 -> apply -> mark complete
合并     -> safety snapshot -> reconcile/push -> pull -> show high-risk conflicts
```

- [ ] **Step 9: Implement conflict UI and sync Toast**

Only high-risk conflicts are shown; actions `accept_local` / `accept_server`. Secret values are never shown. Error toast includes short requestId/error number when present.

- [ ] **Step 10: Green/regression**

```bash
npm run test:account-sync-ui
npm run test:product-tour
npm run test:config-backup
npm run build
```

- [ ] **Step 11: Commit**

```bash
git add src/screens src/components src/features/account src/features/sync src/App.tsx src/lib/storage.ts src/lib/backup.ts scripts package.json
git commit -m "feat(sync): add account and sync user experience"
```

---

### Task 13: Add Android high-value sync notifications without spam

**Files:**
- Create: `android/app/src/main/java/com/aizeek/newsnook/SyncNotificationPlugin.java`
- Create: `src/features/sync/nativeNotification.ts`
- Modify: `android/app/src/main/java/com/aizeek/newsnook/MainActivity.java`
- Modify: `src/features/sync/notifier.ts`
- Create: `scripts/sync-notifier.test.ts`
- Modify: `package.json`

**Policy:**

```text
never system-notify: normal automatic success, every local edit, foreground sync
may system-notify: first cloud sync complete, repeated failure, actionable conflict
```

- [ ] **Step 1: Write failing notification policy tests**

`mapSyncEventToNotification(event,visibility)` returns null for routine success and stable models for the three allowed cases.

- [ ] **Step 2: Implement minimal native plugin**

Use `NotificationManager`/`NotificationCompat`, one `newsnook-sync` channel, stable ids so repeat failures update instead of stacking. Conflict notification opens app with intent data that routes to Account & Sync.

- [ ] **Step 3: Register and connect**

`POST_NOTIFICATIONS` is already in manifest. Do not request permission at cold start solely for sync; foreground always prefers in-app Toast.

- [ ] **Step 4: Green**

```bash
npm run test:sync-notifier
npm run build
cd android && ./gradlew :app:compileCloudDebugJavaWithJavac
```

- [ ] **Step 5: Commit**

```bash
git add android src/features/sync scripts/sync-notifier.test.ts package.json
git commit -m "feat(sync): add Android sync notifications"
```

---

### Task 14: Add CI, deploy assets, backup runbook, and end-to-end acceptance

**Files:**
- Create: `.github/workflows/cloud-sync-ci.yml`
- Create: `cloud/Dockerfile`, `cloud/compose.yml`, `cloud/.env.example`
- Create: `docs/cloud-deploy.md`
- Modify: `docs/user-guide.md`, `docs/architecture.md`, `AGENTS.md`, `README.md` as needed to match shipped optional-cloud behavior

- [ ] **Step 1: Add CI with real PostgreSQL**

Sequence:

```text
checkout -> Node -> npm ci -> postgres healthy
 -> build contracts -> explicit migration -> cloud tests
 -> client account/sync tests -> lint -> root build
```

Use test-only auth/encryption/SMTP values; no production OAuth secrets in PR CI.

- [ ] **Step 2: Add Dockerfile/Compose**

Compose contains only API + PostgreSQL. API startup never auto-runs migrations.

- [ ] **Step 3: Add `.env.example`**

Names only, no real values:

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

- [ ] **Step 4: Write deploy/backup runbook**

Document:

```text
backup -> explicit migration -> deploy -> /health/live -> /health/ready
 -> auth smoke -> sync smoke
```

Daily PostgreSQL backup, off-host/object storage retention, restore drill, and separate storage of data-encryption key are mandatory operational notes.

- [ ] **Step 5: Full verification gate**

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

Every command must exit 0.

- [ ] **Step 6: Manual staging / real-device acceptance**

Record all of these:

1. Web email register → verification → login → cookie session → sync.
2. Web password reset works and old password no longer signs in.
3. Web Google/GitHub login; authenticated user can explicitly bind another provider; same-email unauthenticated provider never silently merges.
4. Android email/password Session survives process kill in SecureStore.
5. Android Google/GitHub → system browser → `newsnook://auth/callback` → Session restored.
6. Existing local data + cloud state: all three first-sync choices behave exactly as labeled.
7. Two devices edit independent ordinary settings offline → reconnect → converge automatically.
8. A deletes source while B edits it → conflict appears; unrelated entities continue syncing.
9. Android offline edit → kill → restart offline → reconnect → reconciliation/outbox recovers mutation.
10. Revoke device from another device → revoked device keeps local data but cloud sync stops.
11. Sign out → local subscriptions/config remain; re-login re-enters first/normal sync according to saved account state.
12. Sync Secret → second Android receives it; PostgreSQL shows ciphertext only; logs contain no plaintext.
13. Stop API/PostgreSQL → NewsNook still reads local feeds/caches and local settings remain editable.
14. Error toast/request log correlation works via requestId without exposing secrets.
15. Old WebView compatibility device/version opens app/account screen without syntax regression.

- [ ] **Step 7: Update user and architecture docs**

Explicitly document:

```text
without login: full local reader
with login: optional config/subscription/secret sync
not synced: article bodies/cache/read/favorites/history/progress
```

- [ ] **Step 8: Commit**

```bash
git add .github cloud docs AGENTS.md README.md
git commit -m "docs(sync): add cloud deployment and verification"
```

---

## Completion Criteria

Implementation is complete only when:

- Account/cloud is optional and local reading works with cloud fully unavailable.
- Email/password registration, verification, reset, Google and GitHub auth work on Web and Android.
- Same-email accounts are never silently linked; authenticated explicit provider linking works.
- Android long-lived Session and synced Secret plaintext are Keystore-backed, not normal Preferences/localStorage.
- First login with both sides populated always asks how to treat local/cloud data.
- Normal sync uses projection reconciliation + Outbox + server revision + tombstones and survives app/network/process failures.
- Same-user concurrent pushes are serialized by PostgreSQL and idempotent retries never duplicate revisions.
- High-risk conflicts are visible/resolvable without blocking unrelated sync.
- Device list/revocation and sign-out preserve local content while stopping unauthorized sync.
- Normal successful background sync does not spam Android notifications.
- Cloud DB stores Secret ciphertext only and logs contain no credentials.
- Error reports have requestId correlation without sensitive payloads.
- Real PostgreSQL integration/concurrency tests, client regression tests, builds, lint and both Android Java variants pass.
- Architecture/user/deployment documentation permits optional cloud while retaining local-first as the hard product rule.
