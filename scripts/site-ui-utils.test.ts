import assert from 'node:assert/strict'
import {
  formatSiteDisplayName,
  formatSiteBrandName,
  getSiteCleanDomain,
  getSiteFrameworkInfo,
  parseArticlePosterMeta,
  getSiteAvatarMeta,
} from '../src/features/siteCatalog/uiUtils.ts'

// 1. 域名清洗
assert.equal(getSiteCleanDomain('https://www.xiangguys.com/'), 'xiangguys.com')
assert.equal(getSiteCleanDomain('https://huarenok.com'), 'huarenok.com')
assert.equal(getSiteCleanDomain('http://www.test.org/news/'), 'test.org')

// 2. 站点名称格式化（规避 www. 和 4位截断碎片）
assert.equal(
  formatSiteDisplayName({
    name: 'www.xiangguys.com',
    label: 'www.',
    url: 'https://www.xiangguys.com/',
  }),
  'xiangguys.com'
)

assert.equal(
  formatSiteDisplayName({
    name: 'huarenok.com',
    label: 'huar',
    url: 'https://huarenok.com',
  }),
  'huarenok.com'
)

assert.equal(
  formatSiteDisplayName({
    name: 'www.example.com',
    label: '目录',
    url: 'https://www.example.com',
  }),
  'example.com'
)

assert.equal(
  formatSiteDisplayName({
    name: '香菇影视',
    label: '香菇影视',
    url: 'https://www.xiangguys.com/',
  }),
  '香菇影视'
)

// 3. 站点品牌名提炼（去除 .com 并首字母大写）
assert.equal(
  formatSiteBrandName({
    name: 'huarenok.com',
    label: 'huar',
    url: 'https://huarenok.com',
  }),
  'Huarenok'
)
assert.equal(
  formatSiteBrandName({
    name: 'www.xiangguys.com',
    label: 'www.',
    url: 'https://www.xiangguys.com/',
  }),
  'Xiangguys'
)
assert.equal(
  formatSiteBrandName({
    name: '香菇影视',
    label: '香菇影视',
    url: 'https://www.xiangguys.com/',
  }),
  '香菇影视'
)

// 4. 框架与徽章信息
assert.equal(getSiteFrameworkInfo('maccms').isVideo, true)
assert.equal(getSiteFrameworkInfo('maccms').name, '苹果CMS')
assert.equal(getSiteFrameworkInfo('wordpress').isVideo, false)
assert.equal(getSiteFrameworkInfo('generic').categoryBadge, '目录')

// 5. 海报元信息解析
const meta1 = parseArticlePosterMeta('机密重案之致命诱惑 機密重案之致命誘惑 (1994)')
assert.equal(meta1.year, '1994')
assert.ok(meta1.cleanTitle.includes('机密重案之致命诱惑'))

const meta2 = parseArticlePosterMeta('女忍者忍法帖II 4K')
assert.equal(meta2.badge, '4K')

const meta3 = parseArticlePosterMeta('脱口秀和Ta的朋友们第三季')
assert.equal(meta3.badge, '第三季')

// 6. 头像元信息生成
const avatar = getSiteAvatarMeta('xiangguys.com')
assert.equal(avatar.letter, 'X')
assert.ok(avatar.gradientClass.length > 0)

console.log('site UI utils tests passed successfully!')
