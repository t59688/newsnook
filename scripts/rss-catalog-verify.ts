import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { CATALOG_BASE, parseCatalog, parseManifest } from '../src/features/rssCatalog/schema'

const argument = process.argv.indexOf('--manifest')
if (argument < 0 || !process.argv[argument + 1]) throw new Error('需要 --manifest 指定本次发布清单')
const expected = parseManifest(JSON.parse(await readFile(process.argv[argument + 1], 'utf8'))).catalog
const origin = 'https://localhost'
const deadline = Date.now() + 90_000
let failure: unknown
while (Date.now() < deadline) {
  try {
    const get = (url: string) => fetch(url, { headers: { Origin: origin, 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(Math.min(15_000, Math.max(1, deadline - Date.now()))) })
    const response = await get(CATALOG_BASE + 'manifest.json')
    if (!response.ok) throw new Error(`公开清单 HTTP ${response.status}`)
    if (!['*', origin].includes(response.headers.get('access-control-allow-origin') ?? '')) throw new Error('公开清单缺少 WebView CORS 许可')
    const actual = parseManifest(await response.json()).catalog
    if (actual.version !== expected.version || actual.sha256 !== expected.sha256 || actual.size !== expected.size || actual.feedCount !== expected.feedCount || actual.generatedAt !== expected.generatedAt) throw new Error('公开清单尚未切换到本次发布')
    const snapshot = await get(new URL(actual.url, CATALOG_BASE).href)
    if (!snapshot.ok) throw new Error(`公开快照 HTTP ${snapshot.status}`)
    if (!['*', origin].includes(snapshot.headers.get('access-control-allow-origin') ?? '')) throw new Error('公开快照缺少 WebView CORS 许可')
    const bytes = Buffer.from(await snapshot.arrayBuffer())
    if (bytes.length !== actual.size || createHash('sha256').update(bytes).digest('hex') !== actual.sha256) throw new Error('公开快照完整性校验失败')
    const catalog = parseCatalog(JSON.parse(bytes.toString('utf8')))
    if (catalog.feeds.length !== actual.feedCount || catalog.generatedAt !== actual.generatedAt) throw new Error('公开快照元数据不匹配')
    console.log(JSON.stringify({ version: actual.version, feedCount: actual.feedCount, size: actual.size, sha256: actual.sha256, cors: 'verified', manifestCache: response.headers.get('cache-control'), snapshotCache: snapshot.headers.get('cache-control') }))
    process.exit(0)
  } catch (error) { failure = error }
  await new Promise((resolve) => setTimeout(resolve, Math.min(2000, Math.max(0, deadline - Date.now()))))
}
throw failure instanceof Error ? failure : new Error('公开目录发布验证失败')
