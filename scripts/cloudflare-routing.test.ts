import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

console.log('--- 测试: Cloudflare 路由配置不应重复声明 /a/* SPA 回退 ---')

const redirectsPath = new URL('../public/_redirects', import.meta.url)

if (existsSync(redirectsPath)) {
  const redirects = readFileSync(redirectsPath, 'utf8')
  assert.doesNotMatch(
    redirects,
    /^\/a\/\*\s+\/index\.html\s+200$/m,
    'wrangler assets 已启用 single-page-application，_redirects 里不应再声明 /a/* → /index.html',
  )
}

console.log('✓ Cloudflare 路由配置测试通过')

console.log('--- 测试: wrangler.jsonc 必须让 /a/* 与 /api/* 先进 worker ---')

const wranglerRaw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
// JSONC：剥掉行注释再解析（配置里没有块注释与字符串内 // 的场景）
const wrangler = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, '')) as {
  main?: string
  assets?: {
    directory?: string
    binding?: string
    not_found_handling?: string
    run_worker_first?: string[]
  }
}

assert.equal(wrangler.main, 'functions/worker.ts', '生产 worker 入口应是 functions/worker.ts')
assert.equal(
  wrangler.assets?.not_found_handling,
  'single-page-application',
  '深链刷新依赖 SPA 回退',
)

const runFirst = wrangler.assets?.run_worker_first
assert.ok(Array.isArray(runFirst), 'run_worker_first 必须是显式的路由数组')
assert.ok(
  runFirst.includes('/a/*'),
  '/a/* 必须先进 worker，否则社交爬虫只能抓到通用 index.html，分享链接退化成纯文本',
)
assert.ok(runFirst.includes('/api/*'), '/api/* 边缘代理必须先进 worker')

console.log('✓ wrangler 显式路由测试通过')
