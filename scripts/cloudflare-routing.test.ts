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
