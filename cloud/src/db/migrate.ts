/**
 * 显式迁移：部署流程里单独跑一次，API 进程启动时**不会**自动迁移。
 *
 * 用 PostgreSQL advisory lock 串行化，避免同一次发布里多个实例并发执行同一份 SQL。
 * 这不是分布式锁基础设施，只是同一个数据库连接上的会话锁。
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool, type PoolClient } from 'pg'

const MIGRATION_LOCK_ID = 8_270_226

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url))

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir)
  return entries.filter((name) => name.endsWith('.sql')).sort()
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

export async function runMigrations(
  pool: Pool,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const files = await listMigrationFiles(dir)
  const applied: string[] = []
  const skipped: string[] = []

  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await ensureMigrationsTable(client)

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations')
    const done = new Set(rows.map((row) => row.name))

    for (const name of files) {
      if (done.has(name)) {
        skipped.push(name)
        continue
      }
      const sql = await readFile(path.join(dir, name), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        applied.push(name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${(error as Error).message}`, { cause: error })
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined)
    client.release()
  }

  return { applied, skipped }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL (or TEST_DATABASE_URL) is required\n')
    process.exitCode = 1
    return
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const result = await runMigrations(pool)
    process.stdout.write(
      `migrations applied: ${result.applied.length ? result.applied.join(', ') : '(none)'}\n`,
    )
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${(error as Error).stack ?? String(error)}\n`)
    process.exitCode = 1
  })
}
