-- NewsNook Cloud V1 schema.
--
-- 两块内容：
--   1. auth schema —— Better Auth 自己维护的身份/会话表
--   2. public schema —— NewsNook 的同步域业务表
--
-- 业务表把 Better Auth 的 user id 当作不透明 text 使用，不跨 schema 建外键：
-- 认证实现将来可替换，同步数据不应因此被级联删除。

CREATE SCHEMA IF NOT EXISTS auth;

-- ---------------------------------------------------------------- Better Auth

CREATE TABLE IF NOT EXISTS auth."user" (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL DEFAULT false,
  image text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth."session" (
  id text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS session_user_id_idx ON auth."session" ("userId");

CREATE TABLE IF NOT EXISTS auth."account" (
  id text PRIMARY KEY,
  -- issuer 在部分 Better Auth 版本才写入，留可空以免跨版本插入失败
  issuer text,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES auth."user" (id) ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  scope text,
  password text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_user_id_idx ON auth."account" ("userId");
CREATE UNIQUE INDEX IF NOT EXISTS account_provider_account_idx
  ON auth."account" ("providerId", "accountId");

CREATE TABLE IF NOT EXISTS auth."verification" (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verification_identifier_idx ON auth."verification" (identifier);

-- ------------------------------------------------------------- NewsNook sync

-- 设备是访问主体，不是数据所有者：撤销设备只切断后续访问，不删它上传过的数据。
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  name text,
  platform text NOT NULL DEFAULT 'unknown',
  app_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices (user_id);

-- 每个用户一行；push 事务对这一行 FOR UPDATE 以串行化同一用户的写入。
CREATE TABLE IF NOT EXISTS sync_heads (
  user_id text PRIMARY KEY,
  current_revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 幂等：HTTP 响应丢失后客户端重发同一个 mutationId，直接返回原结果。
CREATE TABLE IF NOT EXISTS sync_mutations (
  user_id text NOT NULL,
  mutation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mutation_id)
);

CREATE INDEX IF NOT EXISTS sync_mutations_created_at_idx ON sync_mutations (created_at);

CREATE TABLE IF NOT EXISTS subscriptions (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  entity_id text NOT NULL,
  kind text NOT NULL DEFAULT 'builtin',
  enabled boolean NOT NULL DEFAULT true,
  sort_rank text NOT NULL,
  -- 自建源跨设备去重用；内置源为空
  normalized_url text,
  payload jsonb NOT NULL,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT subscriptions_user_entity_key UNIQUE (user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_user_revision_idx ON subscriptions (user_id, revision);
CREATE INDEX IF NOT EXISTS subscriptions_user_normalized_url_idx
  ON subscriptions (user_id, normalized_url)
  WHERE normalized_url IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS categories (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  entity_id text NOT NULL,
  kind text NOT NULL DEFAULT 'builtin',
  visible boolean NOT NULL DEFAULT true,
  sort_rank text NOT NULL,
  payload jsonb NOT NULL,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT categories_user_entity_key UNIQUE (user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS categories_user_revision_idx ON categories (user_id, revision);

CREATE TABLE IF NOT EXISTS user_settings (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT user_settings_user_entity_key UNIQUE (user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS user_settings_user_revision_idx ON user_settings (user_id, revision);

-- 只存密文：ciphertext/nonce/key_version，永远没有明文列。
CREATE TABLE IF NOT EXISTS user_secrets (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  entity_id text NOT NULL,
  ciphertext bytea,
  nonce bytea,
  key_version integer NOT NULL DEFAULT 1,
  revision bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT user_secrets_user_entity_key UNIQUE (user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS user_secrets_user_revision_idx ON user_secrets (user_id, revision);

-- 高风险冲突；Secret 的值不得进入这里的 JSON 快照。
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text NOT NULL,
  server_revision bigint NOT NULL,
  base_revision bigint,
  local_change jsonb,
  server_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS sync_conflicts_user_open_idx
  ON sync_conflicts (user_id, created_at)
  WHERE resolved_at IS NULL;
