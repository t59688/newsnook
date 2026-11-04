import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAX_CATALOG_BYTES, parseCatalog, parseManifest, type CatalogManifest } from '../src/features/rssCatalog/schema'

const hash = (body: string) => createHash('sha256').update(body).digest('hex')
interface Release { key: string; payload: string; manifest: CatalogManifest }
interface ObjectStore { put(key: string, body: string, cacheControl: string): Promise<void>; get(key: string): Promise<string> }
export function buildCatalogRelease(source: unknown, version: string): Release {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(version)) throw new Error('目录版本仅支持字母、数字、点、下划线与短横线')
  const catalog = parseCatalog(source)
  catalog.feeds.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const payload = JSON.stringify(catalog)
  const size = Buffer.byteLength(payload)
  if (size > MAX_CATALOG_BYTES) throw new Error('目录超过 8 MiB 发布上限')
  const sha256 = hash(payload)
  const key = `rss-catalog/v1/catalogs/sha256-${sha256}.json`
  const manifest = parseManifest({ manifestSchema: 1, catalog: { version, schemaVersion: 1, generatedAt: catalog.generatedAt, feedCount: catalog.feeds.length, size, sha256, url: '/' + key } })
  return { key, payload, manifest }
}
export async function publishCatalogRelease(release: Release, store: ObjectStore): Promise<void> {
  await store.put(release.key, release.payload, 'public,max-age=31536000,immutable')
  const readBack = await store.get(release.key)
  if (Buffer.byteLength(readBack) !== release.manifest.catalog.size || hash(readBack) !== release.manifest.catalog.sha256) throw new Error('R2 快照读回校验失败，未发布清单')
  await store.put('rss-catalog/v1/manifest.json', JSON.stringify(release.manifest), 'public,max-age=60')
}
async function main() {
  const args = process.argv.slice(2)
  const option = (name: string, fallback: string) => { const at = args.indexOf(name); if (at === -1) return fallback; if (!args[at + 1] || args[at + 1].startsWith('--')) throw new Error(`${name} 缺少参数`); return args[at + 1] }
  const input = resolve(option('--input', 'src/features/rssCatalog/seed.json'))
  const out = resolve(option('--out', 'node_modules/.cache/newsnook/rss-catalog'))
  const version = option('--version', new Date().toISOString().replace(/[:.]/g, '-'))
  const release = buildCatalogRelease(JSON.parse(await readFile(input, 'utf8')), version)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, `sha256-${release.manifest.catalog.sha256}.json`), release.payload)
  await writeFile(join(out, 'manifest.json'), JSON.stringify(release.manifest, null, 2) + '\n')
  console.log(`RSS 目录：${release.manifest.catalog.feedCount} 条，${release.manifest.catalog.size} 字节，SHA-256 ${release.manifest.catalog.sha256}`)
  if (!args.includes('--publish')) return
  const bucket = process.env.R2_BUCKET ?? 'newsnook-update'
  const account = process.env.R2_ACCOUNT_ID
  const endpoint = process.env.R2_ENDPOINT ?? (account ? `https://${account}.r2.cloudflarestorage.com` : '')
  if (!/^https:\/\/[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(endpoint) || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('R2 endpoint 或 bucket 未正确配置')
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) throw new Error('缺少 R2 发布凭证')
  const work = await mkdtemp(join(tmpdir(), 'newsnook-rss-'))
  const aws = (argv: string[]) => {
    const result = spawnSync('aws', [...argv, '--endpoint-url', endpoint, '--no-progress'], { encoding: 'utf8', shell: false, env: { ...process.env, AWS_DEFAULT_REGION: 'auto', AWS_REGION: 'auto', AWS_EC2_METADATA_DISABLED: 'true', AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required', AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required' } })
    if (result.error || result.status !== 0) throw new Error('AWS CLI 操作失败，请检查凭证和 R2 权限')
  }
  try {
    await publishCatalogRelease(release, {
      put: async (key, body, cacheControl) => {
        const file = join(work, 'upload.json')
        await writeFile(file, body)
        aws(['s3', 'cp', file, `s3://${bucket}/${key}`, '--content-type', 'application/json; charset=utf-8', '--cache-control', cacheControl])
      },
      get: async (key) => {
        const file = join(work, 'download.json')
        aws(['s3', 'cp', `s3://${bucket}/${key}`, file])
        return readFile(file, 'utf8')
      },
    })
  } finally { await rm(work, { recursive: true, force: true }) }
  console.log('R2 发布完成；历史快照已保留。')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'RSS 目录发布失败'); process.exitCode = 1 })
}
