/**
 * Secret 静态加密与库表约束：AES-256-GCM 往返、随机 nonce、AAD 绑定、
 * 数据库里不存在明文，以及同步表的唯一约束/索引确实建出来了。
 */
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { Pool } from 'pg'

import {
  SECRET_KEY_VERSION,
  SecretDecryptionError,
  ciphertextEquals,
  createSecretCipher,
} from '../src/crypto/secrets.js'
import { ConfigError } from '../src/config.js'
import { TEST_DATABASE_URL, ensureMigrated, skipWithoutDatabase, testConfig } from './helpers.js'

const cipher = createSecretCipher(testConfig().dataEncryptionKey)

describe('secret encryption', () => {
  it('round-trips a value', () => {
    const secret = cipher.encrypt({
      userId: 'user-1',
      secretKey: 'translation.openai.apiKey',
      value: 'sk-test-value',
    })
    assert.equal(secret.keyVersion, SECRET_KEY_VERSION)
    assert.equal(secret.nonce.length, 12)

    const plain = cipher.decrypt({
      userId: 'user-1',
      secretKey: 'translation.openai.apiKey',
      secret,
    })
    assert.equal(plain, 'sk-test-value')
  })

  it('never produces the same ciphertext twice', () => {
    const params = { userId: 'user-1', secretKey: 'proxy.url', value: 'socks5://127.0.0.1:1080' }
    const a = cipher.encrypt(params)
    const b = cipher.encrypt(params)
    assert.equal(ciphertextEquals(a.nonce, b.nonce), false, 'nonce 每次随机')
    assert.equal(ciphertextEquals(a.ciphertext, b.ciphertext), false)
  })

  it('refuses to decrypt with a different user or key (AAD binding)', () => {
    const secret = cipher.encrypt({
      userId: 'user-1',
      secretKey: 'proxy.url',
      value: 'socks5://127.0.0.1:1080',
    })

    assert.throws(
      () => cipher.decrypt({ userId: 'user-2', secretKey: 'proxy.url', secret }),
      SecretDecryptionError,
    )
    assert.throws(
      () => cipher.decrypt({ userId: 'user-1', secretKey: 'translation.deepl.apiKey', secret }),
      SecretDecryptionError,
    )
  })

  it('detects tampered ciphertext', () => {
    const secret = cipher.encrypt({ userId: 'u', secretKey: 'k', value: 'value' })
    const tampered = Buffer.from(secret.ciphertext)
    tampered[0] = tampered[0]! ^ 0xff
    assert.throws(
      () => cipher.decrypt({ userId: 'u', secretKey: 'k', secret: { ...secret, ciphertext: tampered } }),
      SecretDecryptionError,
    )
  })

  it('rejects an unknown key version', () => {
    const secret = cipher.encrypt({ userId: 'u', secretKey: 'k', value: 'value' })
    assert.throws(
      () => cipher.decrypt({ userId: 'u', secretKey: 'k', secret: { ...secret, keyVersion: 99 } }),
      SecretDecryptionError,
    )
  })

  it('rejects a master key that is not 32 bytes', () => {
    assert.throws(() => createSecretCipher(Buffer.alloc(8, 1).toString('base64')), ConfigError)
  })

  it('does not leak the plaintext through the error message', () => {
    const secret = cipher.encrypt({ userId: 'u', secretKey: 'k', value: 'super-secret-value' })
    try {
      cipher.decrypt({ userId: 'other', secretKey: 'k', secret })
      assert.fail('should have thrown')
    } catch (error) {
      assert.ok(!String(error).includes('super-secret-value'))
    }
  })
})

describe('sync schema', { skip: skipWithoutDatabase }, () => {
  let pool: Pool

  before(async () => {
    await ensureMigrated()
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 })
  })

  after(async () => {
    await pool?.end()
  })

  it('stores secrets as ciphertext only, with no plaintext column', async () => {
    const { rows } = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'user_secrets' ORDER BY column_name`,
    )
    const columns = rows.map((row) => row.column_name)
    assert.ok(columns.includes('ciphertext'))
    assert.ok(columns.includes('nonce'))
    assert.ok(columns.includes('key_version'))
    assert.ok(!columns.includes('value'), '不存在明文列')
    assert.ok(!columns.includes('plaintext'))
    assert.equal(
      rows.find((row) => row.column_name === 'ciphertext')?.data_type,
      'bytea',
      '密文以字节串保存',
    )
  })

  it('serializes an encrypted secret into the row without plaintext', async () => {
    const userId = `schema-test-${Date.now()}`
    const value = 'sk-plaintext-should-never-appear'
    const secret = cipher.encrypt({ userId, secretKey: 'translation.openai.apiKey', value })

    await pool.query(
      `INSERT INTO user_secrets (user_id, entity_id, ciphertext, nonce, key_version, revision)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [userId, 'translation.openai.apiKey', secret.ciphertext, secret.nonce, secret.keyVersion],
    )

    const { rows } = await pool.query<{ dump: string }>(
      `SELECT encode(ciphertext, 'escape') || '|' || encode(nonce, 'escape') AS dump
         FROM user_secrets WHERE user_id = $1`,
      [userId],
    )
    assert.ok(rows[0])
    assert.ok(!rows[0].dump.includes(value), '整行序列化后也搜不到明文')

    await pool.query('DELETE FROM user_secrets WHERE user_id = $1', [userId])
  })

  it('enforces (user_id, entity_id) uniqueness on every entity table', async () => {
    for (const table of ['subscriptions', 'categories', 'user_settings', 'user_secrets']) {
      const { rows } = await pool.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = $1`,
        [table],
      )
      assert.ok(
        rows.some(
          (row) =>
            row.indexdef.includes('UNIQUE') &&
            row.indexdef.includes('user_id') &&
            row.indexdef.includes('entity_id'),
        ),
        `${table} 需要 (user_id, entity_id) 唯一约束`,
      )
      assert.ok(
        rows.some((row) => row.indexdef.includes('revision')),
        `${table} 需要按 revision 拉取的索引`,
      )
    }
  })

  it('keeps a sort_rank column on ordered entities', async () => {
    for (const table of ['subscriptions', 'categories']) {
      const { rows } = await pool.query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'sort_rank'`,
        [table],
      )
      assert.equal(rows.length, 1, `${table}.sort_rank 必须存在`)
      assert.equal(rows[0]?.is_nullable, 'NO')
    }
  })

  it('keeps a normalized_url column for custom-source dedupe', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'subscriptions' AND column_name = 'normalized_url'`,
    )
    assert.equal(rows.length, 1)
  })

  it('is idempotent when applied twice', async () => {
    await ensureMigrated()
    const { rows } = await pool.query<{ total: string }>(
      "SELECT count(*)::text AS total FROM schema_migrations WHERE name = '001_cloud.sql'",
    )
    assert.equal(rows[0]?.total, '1')
  })
})
