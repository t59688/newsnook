import assert from 'node:assert/strict'

import type { PaginationPattern } from '../src/features/frameworkDetect/types'
import {
  frameworkCategoryPageUrl,
  frameworkPageUrl,
  frameworkSearchUrl,
} from '../src/features/frameworkDetect/buildPageUrl'
import { detectFramework } from '../src/features/frameworkDetect/detect'
import {
  pagingStrategyOf,
  offsetPageRequest,
  type NewsSource,
} from '../src/sources/registry'

console.log('Testing frameworkPageUrl...')

// query-param: page 0 → no param; page 1 → ?paged=2
const qp: PaginationPattern = { kind: 'query-param', param: 'paged' }
assert.equal(
  frameworkPageUrl('https://example.com/', 0, qp),
  'https://example.com/',
)
assert.equal(
  frameworkPageUrl('https://example.com/', 1, qp),
  'https://example.com/?paged=2',
)
assert.equal(
  frameworkPageUrl('https://example.com/?paged=5', 3, qp),
  'https://example.com/?paged=4',
)

// path-segment
const ps: PaginationPattern = {
  kind: 'path-segment',
  template: 'https://example.com/vod/type/id/1/page/{page}.html',
}
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 0, ps),
  'https://example.com/vod/type/id/1.html',
)
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 1, ps),
  'https://example.com/vod/type/id/1/page/2.html',
)
assert.equal(
  frameworkPageUrl('https://example.com/vod/type/id/1.html', 4, ps),
  'https://example.com/vod/type/id/1/page/5.html',
)

// next-link: always returns baseUrl
const nl: PaginationPattern = { kind: 'next-link' }
assert.equal(
  frameworkPageUrl('https://example.com/blog', 5, nl),
  'https://example.com/blog',
)

console.log('✓ frameworkPageUrl tests passed')

// --- MacCMS ---
console.log('Testing MacCMS detection...')
const maccmsHtml = `<html><head><title>Test</title></head><body>
<script>var maccms={"path":"","mid":"","url":"example.com"};</script>
<ul>
<li><a href="/index.php/vod/type/id/1.html">最新资讯</a></li>
<li><a href="/index.php/vod/type/id/2.html">影视剧集</a></li>
<li><a href="/index.php/vod/type/id/4.html">综艺节目</a></li>
</ul>
</body></html>`

const maccms = detectFramework(maccmsHtml, 'https://example.com/index.php')
assert.ok(maccms, 'should detect MacCMS')
assert.equal(maccms!.framework, 'maccms')
assert.equal(maccms!.themeVariant, 'classic')
assert.equal(maccms!.paginationPattern.kind, 'path-segment')
assert.ok(maccms!.categories && maccms!.categories.length >= 3, 'should find categories')
assert.ok(maccms!.searchTemplate?.includes('{query}'), 'should have search template')
assert.ok(maccms!.sortOptions?.some((option) => option.key === 'hits'), 'should expose sort options')
console.log('✓ MacCMS detection passed')

const wnthemeHtml = `<html><body>
<script>var maccms={"mid":"1"};var wntheme={};</script>
<a href="/vodtype/1/">最新资讯</a>
</body></html>`
const wntheme = detectFramework(wnthemeHtml, 'https://example.com/')
assert.ok(wntheme, 'should detect wntheme variant')
assert.equal(wntheme!.framework, 'maccms')
assert.equal(wntheme!.themeVariant, 'wntheme')
assert.ok(wntheme!.categories?.some((item) => item.url.includes('/vodtype/1/')))
console.log('✓ MacCMS wntheme variant passed')

const stuiHtml = `<html><body>
<script>var maccms={"mid":"1"};</script>
<link rel="stylesheet" href="/template/stui_1/css/stui.css">
<a href="/vodtype/3/">综艺节目</a>
</body></html>`
const stui = detectFramework(stuiHtml, 'https://example.com/')
assert.ok(stui, 'should detect stui variant')
assert.equal(stui!.framework, 'maccms')
assert.equal(stui!.themeVariant, 'stui')
console.log('✓ MacCMS stui variant passed')

console.log('Testing MacCMS const + ds3 rewrite theme...')
const ds3Html = `<html><head>
<link href="/static/ds3/css/common.css" rel="stylesheet">
</head><body>
<script>const maccms={"path":"","url":"huarenok.com"};</script>
<a href="/vodshow/1.html">电影</a>
<a href="/vodtype/2.html">电视剧</a>
<a href="/vodtype/3.html">综艺</a>
<form action="/vodsearch.html"><input name="wd"></form>
</body></html>`
const ds3 = detectFramework(ds3Html, 'https://huarenok.com/')
assert.ok(ds3, 'should detect MacCMS from const maccms')
assert.equal(ds3!.framework, 'maccms')
assert.equal(ds3!.themeVariant, 'ds3')
assert.ok(ds3!.categories?.some((item) => item.url.endsWith('/vodshow/1.html')))
assert.ok(ds3!.categories?.some((item) => item.url.endsWith('/vodtype/2.html')))
assert.equal(ds3!.searchTemplate, 'https://huarenok.com/vodsearch.html?wd={query}')
assert.equal(
  frameworkCategoryPageUrl('https://huarenok.com/vodtype/2.html', 1, ds3!),
  'https://huarenok.com/vodtype/2-2.html',
)
console.log('✓ MacCMS const/ds3 detection passed')

// --- 努努影院 nnyy ---
console.log('Testing nnyy detection...')
const nnyyHtml = `<html><head>
<link type="text/css" rel="stylesheet" href="/static/css/movie.css?v=2" />
<title>努努影院</title>
</head><body class="searchon m-nav-full index">
<form method="get" action="/so" class="searchform"><input name="q"></form>
<div class="nav"><ul>
<li><a href="/">首页</a></li>
<li><a href="/dianying/">电影</a></li>
<li><a href="/dianshiju/">电视剧</a></li>
<li><a href="/zongyi/">综艺</a></li>
<li><a href="/dongman/">动漫</a></li>
</ul></div>
<div class="lists lists-thumb-top"><a href="/dianying/20252607.html"><img alt="窥欲者"></a></div>
</body></html>`
const nnyy = detectFramework(nnyyHtml, 'https://nnyy.in/')
assert.ok(nnyy, 'should detect nnyy')
assert.equal(nnyy!.framework, 'nnyy')
assert.equal(nnyy!.paginationPattern.kind, 'query-param')
assert.equal(nnyy!.searchTemplate, 'https://nnyy.in/so?q={query}')
assert.ok(nnyy!.categories?.some((item) => item.url.endsWith('/dianying/')))
assert.equal(
  frameworkCategoryPageUrl('https://nnyy.in/dianying/', 1, nnyy!),
  'https://nnyy.in/dianying/?page=2',
)
console.log('✓ nnyy detection passed')

console.log('Testing MacCMS deep fingerprints without maccms variable...')
const macRenamedHtml = `<html><body>
<script>MacPlayer.Show(); var app_config={"path":"/"};</script>
<script src="/static/player/dplayer.js"></script>
<a href="/vodshow/1-----------.html">电影</a>
<a href="/voddetail/1234.html">某片</a>
<a href="/index.php/ajax/suggest?mid=1&wd=test">suggest</a>
</body></html>`
const macRenamed = detectFramework(macRenamedHtml, 'https://renamed.example.com/')
assert.ok(macRenamed, 'should detect MacCMS after renaming maccms')
assert.equal(macRenamed!.framework, 'maccms')
assert.ok(macRenamed!.searchTemplate?.includes('{query}'))
console.log('✓ MacCMS renamed-variable fingerprints passed')

const conchThemeHtml = `<html><body>
<ul class="hl-vod-list"></ul>
<div class="hl-tabs"></div>
<a href="/vod/detail/id/88.html">详情</a>
<a href="/vod/type/id/1.html">电影</a>
<a href="/vod/type/id/2.html">电视剧</a>
<script src="/index.php/ajax/hits?mid=1&id=88&type=update"></script>
</body></html>`
const conch = detectFramework(conchThemeHtml, 'https://conch.example.com/')
assert.ok(conch, 'should detect MacCMS via Conch + ajax/hits')
assert.equal(conch!.framework, 'maccms')
assert.equal(conch!.themeVariant, 'conch')
assert.ok(conch!.categories?.some((item) => item.url.includes('/vod/type/id/1.html')))
console.log('✓ MacCMS Conch theme fingerprints passed')

const vfedThemeHtml = `<html><body>
<nav class="fed-pops-navbar"></nav>
<script src="/template/vfed/js/vfed.min.js"></script>
<a href="/vodtype/1.html">电影</a>
<a href="/vodplay/12-1-1.html">播放</a>
<script>MacPlayer.PlayUrl="https://cdn.example/a.m3u8";</script>
</body></html>`
const vfed = detectFramework(vfedThemeHtml, 'https://vfed.example.com/')
assert.ok(vfed, 'should detect MacCMS via vfed + MacPlayer')
assert.equal(vfed!.framework, 'maccms')
assert.equal(vfed!.themeVariant, 'vfed')
console.log('✓ MacCMS vfed theme fingerprints passed')

const mxproHtml = `<html><body>
<div class="mxpro-vod"></div>
<a href="/vodshow/2--------2---.html">分页</a>
<script src="/static/js/home.js"></script>
<script>MacPlayer.Flag="play";</script>
</body></html>`
const mxpro = detectFramework(mxproHtml, 'https://mxpro.example.com/')
assert.ok(mxpro, 'should detect MacCMS via MXPro')
assert.equal(mxpro!.framework, 'maccms')
assert.equal(mxpro!.themeVariant, 'mxpro')
console.log('✓ MacCMS MXPro theme fingerprints passed')

const macV8Html = `<html><body>
<a href="index.php?m=vod-type-id-1">电影</a>
<a href="index.php?m=vod-detail-id-99">详情</a>
<script src="/static/js/home.js"></script>
<script>MacPlayer.Show();</script>
</body></html>`
const macV8 = detectFramework(macV8Html, 'https://v8.example.com/')
assert.ok(macV8, 'should detect MacCMS v8 query routes')
assert.equal(macV8!.framework, 'maccms')
console.log('✓ MacCMS v8 fingerprints passed')

const notMacFromVodWord = `<html><body><p>我们讨论 voddetail 这个词</p></body></html>`
assert.equal(
  detectFramework(notMacFromVodWord, 'https://blog.example.com/post'),
  null,
  'a single vod word must not classify as MacCMS',
)
console.log('✓ MacCMS false-positive guard passed')

console.log('Testing SeaCMS deep fingerprints...')
const seacmsDeepHtml = `<html><body>
<script src="/js/common.js"></script>
<script src="/js/play.js"></script>
<script>seajs.use("player");</script>
<ul id="play_1"></ul>
<a href="/include/ajax.php?action=hit&id=12">hit</a>
<a href="/type/1.html">电影</a>
</body></html>`
const seacmsDeep = detectFramework(seacmsDeepHtml, 'https://sea-deep.example.com/')
assert.ok(seacmsDeep, 'should detect SeaCMS without Powered-by banner')
assert.equal(seacmsDeep!.framework, 'seacms')
console.log('✓ SeaCMS deep fingerprints passed')

console.log('Testing FeiFeiCMS deep fingerprints...')
const ffDeepHtml = `<html><body>
<script>var Root = "/"; var SitePath = "/"; var ff_player = {};</script>
<a href="/vod-read-id-1234.html">详情</a>
<a href="/vod-show-id-1.html">电影</a>
<a href="/vod-play-id-1234-sid-1-nid-1.html">播放</a>
</body></html>`
const ffDeep = detectFramework(ffDeepHtml, 'https://ff-deep.example.com/')
assert.ok(ffDeep, 'should detect FeiFeiCMS via ff_player and vod-read routes')
assert.equal(ffDeep!.framework, 'fyfcms')
console.log('✓ FeiFeiCMS deep fingerprints passed')

// --- WordPress ---
console.log('Testing WordPress detection...')
const wpHtml = `<html><head>
<meta name="generator" content="WordPress 6.5" />
</head><body><p>Hello</p></body></html>`

const wp = detectFramework(wpHtml, 'https://blog.example.com/')
assert.ok(wp, 'should detect WordPress')
assert.equal(wp!.framework, 'wordpress')
assert.ok(wp!.searchTemplate?.includes('{query}'), 'should have search template')
console.log('✓ WordPress detection passed')

// wp-content fallback
const wpHtml2 = `<html><head></head><body>
<link rel="stylesheet" href="/wp-content/themes/flavor/style.css">
</body></html>`
const wp2 = detectFramework(wpHtml2, 'https://blog2.example.com/')
assert.ok(wp2, 'should detect WordPress via wp-content')
assert.equal(wp2!.framework, 'wordpress')
console.log('✓ WordPress wp-content fallback passed')

// --- Hugo ---
console.log('Testing Hugo detection...')
const hugoHtml = `<html><head>
<meta name="generator" content="Hugo 0.128.0">
</head><body>
<nav><a href="/categories/">Categories</a><a href="/tags/">Tags</a></nav>
</body></html>`

const hugo = detectFramework(hugoHtml, 'https://hugo.example.com/')
assert.ok(hugo, 'should detect Hugo')
assert.equal(hugo!.framework, 'hugo')
assert.equal(hugo!.paginationPattern.kind, 'path-segment')
assert.ok(hugo!.categories && hugo!.categories.length >= 1, 'should find categories/tags links')
assert.equal(hugo!.searchTemplate, undefined, 'Hugo has no search')
console.log('✓ Hugo detection passed')

// --- Hexo ---
console.log('Testing Hexo detection...')
const hexoHtml = `<html><head>
<meta name="generator" content="Hexo 7.0.0">
</head><body>
<nav><a href="/categories/">分类</a></nav>
</body></html>`

const hexo = detectFramework(hexoHtml, 'https://hexo.example.com/')
assert.ok(hexo, 'should detect Hexo')
assert.equal(hexo!.framework, 'hexo')
assert.equal(hexo!.paginationPattern.kind, 'path-segment')
console.log('✓ Hexo detection passed')

// --- Ghost ---
console.log('Testing Ghost detection...')
const ghostHtml = `<html><head>
<meta name="generator" content="Ghost 5.87">
</head><body></body></html>`

const ghost = detectFramework(ghostHtml, 'https://ghost.example.com/')
assert.ok(ghost, 'should detect Ghost')
assert.equal(ghost!.framework, 'ghost')
assert.equal(ghost!.paginationPattern.kind, 'path-segment')
console.log('✓ Ghost detection passed')

// --- Generic rel=next ---
console.log('Testing generic rel=next detection...')
const nextHtml = `<html><head>
<link rel="next" href="https://other.com/articles?page=2">
</head><body></body></html>`

const generic = detectFramework(nextHtml, 'https://other.com/articles')
assert.ok(generic, 'should detect generic next-link')
assert.equal(generic!.framework, 'generic')
assert.equal(generic!.paginationPattern.kind, 'next-link')
console.log('✓ Generic rel=next detection passed')

// --- SeaCMS ---
console.log('Testing SeaCMS detection...')
const seacmsHtml = `<html><head><title>Test</title></head><body>
<div>Powered by SeaCMS</div>
<link rel="stylesheet" href="/template/default/css/app.css">
<script src="/js/player.js"></script>
<nav>
<a href="/type/1.html">最新资讯</a>
<a href="/type/2.html">影视剧集</a>
<a href="/type/3.html">综艺节目</a>
</nav>
</body></html>`

const seacms = detectFramework(seacmsHtml, 'https://sea.example.com/')
assert.ok(seacms, 'should detect SeaCMS')
assert.equal(seacms!.framework, 'seacms')
assert.equal(seacms!.themeVariant, 'default')
assert.equal(seacms!.paginationPattern.kind, 'path-segment')
assert.ok(seacms!.categories && seacms!.categories.length >= 3, 'should find SeaCMS categories')
assert.ok(seacms!.searchTemplate?.includes('search.php'), 'should have search template')
assert.ok(seacms!.sortOptions?.some((option) => option.key === 'hits'), 'should expose SeaCMS sort options')
console.log('✓ SeaCMS detection passed')

const seacmsVfedHtml = `<html><body>
<div>Powered by SeaCMS</div>
<div class="fed-navs"></div>
<script src="/template/vfed/js/app.js"></script>
<a href="/type/8.html">纪录片</a>
</body></html>`
const seacmsVfed = detectFramework(seacmsVfedHtml, 'https://sea.example.com/')
assert.ok(seacmsVfed, 'should detect SeaCMS vfed variant')
assert.equal(seacmsVfed!.framework, 'seacms')
assert.equal(seacmsVfed!.themeVariant, 'vfed')
console.log('✓ SeaCMS vfed variant passed')

// --- FYFCMS ---
console.log('Testing FYFCMS detection...')
const fyfcmsHtml = `<html><head><title>Test</title></head><body>
<link rel="stylesheet" href="/template/feifeicms/default/css/style.css">
<nav>
<a href="/index.php?s=/vod-show-id-1.html">最新资讯</a>
<a href="/index.php?s=/vod-show-id-2.html">影视剧集</a>
</nav>
</body></html>`

const fyfcms = detectFramework(fyfcmsHtml, 'https://fyf.example.com/')
assert.ok(fyfcms, 'should detect FYFCMS')
assert.equal(fyfcms!.framework, 'fyfcms')
assert.equal(fyfcms!.themeVariant, 'default')
assert.ok(fyfcms!.categories && fyfcms!.categories.length >= 2, 'should find FYFCMS categories')
assert.ok(fyfcms!.searchTemplate?.includes('vod-search-wd-'), 'should have search template')
assert.ok(fyfcms!.sortOptions?.some((option) => option.key === 'score'), 'should expose FYFCMS sort options')
console.log('✓ FYFCMS detection passed')

// --- JEECMS ---
console.log('Testing JEECMS detection...')
const jeecmsHtml = `<html><head><title>Test</title></head><body>
<div>Powered by JEECMS</div>
<nav>
<a href="/channel/1.jhtml">最新资讯</a>
<a href="/channel/2.jhtml">影视剧集</a>
</nav>
</body></html>`

const jeecms = detectFramework(jeecmsHtml, 'https://jee.example.com/')
assert.ok(jeecms, 'should detect JEECMS')
assert.equal(jeecms!.framework, 'jeecms')
assert.equal(jeecms!.themeVariant, undefined)
assert.equal(jeecms!.paginationPattern.kind, 'query-param')
assert.ok(jeecms!.categories && jeecms!.categories.length >= 2, 'should find JEECMS categories')
assert.ok(jeecms!.searchTemplate?.includes('search.jspx'), 'should have search template')
console.log('✓ JEECMS detection passed')

const jeecmsStaticHtml = `<html><body>
<div>Powered by JEECMS</div>
<link rel="stylesheet" href="/r/cms/www/default/style.css">
<a href="/channel/9.jhtml">地方频道</a>
</body></html>`
const jeecmsStatic = detectFramework(jeecmsStaticHtml, 'https://jee.example.com/')
assert.ok(jeecmsStatic, 'should detect JEECMS static variant')
assert.equal(jeecmsStatic!.themeVariant, 'cms-static')
console.log('✓ JEECMS static variant passed')

// --- ZanPian ---
console.log('Testing ZanPian detection...')
const zanpianHtml = `<html><head><title>Test</title></head><body>
<script>var zanpian={"ver":"3.0"};</script>
<nav>
<a href="/vodtype/1/">最新资讯</a>
<a href="/vodtype/2/">影视剧集</a>
</nav>
</body></html>`

const zanpian = detectFramework(zanpianHtml, 'https://zp.example.com/')
assert.ok(zanpian, 'should detect ZanPian')
assert.equal(zanpian!.framework, 'zanpian')
assert.equal(zanpian!.themeVariant, undefined)
assert.ok(zanpian!.categories && zanpian!.categories.length >= 2, 'should find ZanPian categories')
assert.ok(zanpian!.searchTemplate?.includes('{query}'), 'should have search template')
assert.ok(zanpian!.sortOptions?.some((option) => option.key === 'score'), 'should expose sort options')
console.log('✓ ZanPian detection passed')

const zanpianStuiHtml = `<html><body>
<script>var zanpian={"ver":"3.0"};</script>
<link rel="stylesheet" href="/template/stui/css/stui.css">
<a href="/vodtype/2/">影视剧集</a>
</body></html>`
const zanpianStui = detectFramework(zanpianStuiHtml, 'https://zp.example.com/')
assert.ok(zanpianStui, 'should detect ZanPian stui variant')
assert.equal(zanpianStui!.themeVariant, 'stui')
console.log('✓ ZanPian stui variant passed')

// --- No framework ---
console.log('Testing no-framework fallback...')
const plainHtml = `<html><head><title>Plain</title></head><body><p>Hello</p></body></html>`
const none = detectFramework(plainHtml, 'https://plain.example.com/')
assert.equal(none, null, 'should return null for unrecognized HTML')
console.log('✓ No-framework fallback passed')

console.log('Testing pagination integration...')

const maccmsSource: NewsSource = {
  id: 'custom_test_mac',
  name: 'Test MacCMS',
  label: 'Test',
  group: 'custom',
  kind: 'web-catalog',
  url: 'https://example.com/index.php/vod/type/id/1.html',
  enabled: true,
  isCustom: true,
  frameworkHint: {
    framework: 'maccms',
    paginationPattern: {
      kind: 'path-segment',
      template: 'https://example.com/index.php/vod/type/id/1/page/{page}.html',
    },
  },
}

// web-catalog with frameworkHint → upstream-offset
assert.equal(pagingStrategyOf(maccmsSource), 'upstream-offset')

// page 0 → base URL; page 1 → /page/2.html
assert.equal(
  offsetPageRequest(maccmsSource, 0).url,
  'https://example.com/index.php/vod/type/id/1.html',
)
assert.equal(
  offsetPageRequest(maccmsSource, 1).url,
  'https://example.com/index.php/vod/type/id/1/page/2.html',
)

assert.equal(
  frameworkCategoryPageUrl(
    'https://example.com/index.php/vod/type/id/1.html',
    0,
    maccmsSource.frameworkHint!,
    'hits',
  ),
  'https://example.com/index.php/vod/show/id/1/by/hits/order/desc.html',
)
assert.equal(
  frameworkCategoryPageUrl(
    'https://example.com/index.php/vod/type/id/1.html',
    2,
    maccmsSource.frameworkHint!,
    'hits_week',
  ),
  'https://example.com/index.php/vod/show/id/1/by/hits_week/order/desc/page/3.html',
)

const zanpianHint = {
  framework: 'zanpian' as const,
  paginationPattern: {
    kind: 'path-segment' as const,
    template: 'https://zp.example.com/vodtype/1/page/{page}.html',
  },
}
assert.equal(
  frameworkCategoryPageUrl(
    'https://zp.example.com/vodtype/9/',
    1,
    zanpianHint,
    'score',
  ),
  'https://zp.example.com/index.php/vod/show/id/9/by/score/order/desc/page/2.html',
)
assert.equal(
  frameworkCategoryPageUrl(
    'https://sea.example.com/type/9.html',
    1,
    { framework: 'seacms', paginationPattern: { kind: 'path-segment', template: '' } },
    'hits',
  ),
  'https://sea.example.com/type/9-2.html?order=hit',
)
assert.equal(
  frameworkCategoryPageUrl(
    'https://fyf.example.com/index.php?s=/vod-show-id-9.html',
    0,
    { framework: 'fyfcms', paginationPattern: { kind: 'path-segment', template: '' } },
    'score',
  ),
  'https://fyf.example.com/index.php?s=/vod-show-id-9-by-score-order-desc.html',
)
assert.equal(
  frameworkSearchUrl(
    { framework: 'maccms', paginationPattern: { kind: 'path-segment', template: '' } },
    'https://example.com/index.php/vod/search.html?wd={query}',
    'test keyword',
    'hits_week',
  ),
  'https://example.com/index.php/vod/search.html?wd=test+keyword&by=hits_week&order=desc',
)
assert.equal(
  frameworkSearchUrl(
    { framework: 'seacms', paginationPattern: { kind: 'path-segment', template: '' } },
    'https://sea.example.com/search.php?searchword={query}',
    'test keyword',
    'hits',
  ),
  'https://sea.example.com/search.php?searchword=test+keyword&order=hit',
)
assert.equal(
  frameworkSearchUrl(
    { framework: 'fyfcms', paginationPattern: { kind: 'path-segment', template: '' } },
    'https://fyf.example.com/index.php?s=/vod-search-wd-{query}.html',
    'test keyword',
    'score',
  ),
  'https://fyf.example.com/index.php?s=/vod-search-wd-test%20keyword-by-score-order-desc.html',
)

// web-catalog WITHOUT frameworkHint, no page param → client-catalog (unchanged)
const plainCatalogSource: NewsSource = {
  id: 'custom_test_plain',
  name: 'Plain Catalog',
  label: 'Plain',
  group: 'custom',
  kind: 'web-catalog',
  url: 'https://example.com/articles',
  enabled: true,
  isCustom: true,
}
assert.equal(pagingStrategyOf(plainCatalogSource), 'client-catalog')

console.log('✓ Pagination integration tests passed')
