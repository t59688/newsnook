/**
 * 通用目录引擎（Feed Reflow）测试。
 * npx tsx scripts/catalog-engine.test.ts
 */
import assert from 'node:assert/strict'

import { extractCatalog } from '../src/features/catalogEngine/engine'
import { extractHeuristicCardCatalog } from '../src/features/catalogEngine/extractors/heuristicCards'
import { extractJsonLdCatalog } from '../src/features/catalogEngine/extractors/jsonLd'
import {
  appendRelatedCatalogHtml,
  extractRelatedCatalog,
  relatedCatalogHtml,
} from '../src/features/catalogEngine/related'
import { extractWebCatalogDetailMeta } from '../src/features/catalogEngine/detailMeta'
import { buildCatalogPageUrl, catalogUsesOffsetPaging } from '../src/features/catalogEngine/pagination'
import { parseSourcePayload } from '../src/lib/parseFeed'
import { sanitizeArticleHtml } from '../src/lib/sanitize'
import { normalizeSourceKind, offsetPageRequest, pagingStrategyOf } from '../src/sources/registry'
import type { NewsSource } from '../src/sources/registry'

const JSON_LD_HTML = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "VideoObject",
        "name": "Alpha",
        "url": "https://video.example.com/watch/alpha",
        "thumbnailUrl": "https://video.example.com/a.jpg",
        "uploadDate": "2026-01-02T10:00:00Z"
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "VideoObject",
        "name": "Beta",
        "url": "https://video.example.com/watch/beta"
      }
    },
    {
      "@type": "ListItem",
      "position": 3,
      "item": {
        "@type": "VideoObject",
        "name": "Gamma",
        "url": "https://video.example.com/watch/gamma"
      }
    }
  ]
}
</script>
`

const HEURISTIC_HTML = `
<a href="https://clips.example.com/v/101"><img src="https://clips.example.com/t/101.jpg" alt="Clip one"></a>
<a href="https://clips.example.com/v/102"><img src="https://clips.example.com/t/102.jpg" alt="Clip two"></a>
<a href="https://clips.example.com/v/103"><img src="https://clips.example.com/t/103.jpg" alt="Clip three"></a>
<a href="https://clips.example.com/v/104"><img src="https://clips.example.com/t/104.jpg" alt="Clip four"></a>
<a href="https://clips.example.com/about">About</a>
`

const jsonLdItems = extractJsonLdCatalog(JSON_LD_HTML, 'https://video.example.com/list')
assert.equal(jsonLdItems.length, 3)
assert.equal(jsonLdItems[0]?.title, 'Alpha')
assert.ok(jsonLdItems[0]?.publishedAt)

const heuristicItems = extractHeuristicCardCatalog(
  HEURISTIC_HTML,
  'https://clips.example.com/latest',
)
assert.equal(heuristicItems.length, 4)

const layeredJson = extractCatalog(JSON_LD_HTML, 'https://video.example.com/list')
assert.equal(layeredJson.extractor, 'json-ld')
assert.equal(layeredJson.confidence, 'high')

const layeredHeuristic = extractCatalog(HEURISTIC_HTML, 'https://clips.example.com/latest')
assert.equal(layeredHeuristic.extractor, 'heuristic-cards')

assert.equal(normalizeSourceKind('web-video'), 'web-catalog')
assert.equal(normalizeSourceKind('web-catalog'), 'web-catalog')

const source: NewsSource = {
  id: 'custom_test',
  name: 'Clips',
  label: 'Clip',
  group: 'custom',
  kind: 'web-catalog',
  url: 'https://clips.example.com/latest?page=1',
  enabled: true,
  isCustom: true,
}

const articles = parseSourcePayload(source, HEURISTIC_HTML)
assert.equal(articles.length, 4)
assert.equal(articles[0]?.contentType, 'video')

assert.equal(pagingStrategyOf(source), 'upstream-offset')
assert.equal(buildCatalogPageUrl(source.url, 1), 'https://clips.example.com/latest?page=2')
assert.equal(offsetPageRequest(source, 1).url, 'https://clips.example.com/latest?page=2')
assert.equal(catalogUsesOffsetPaging('https://example.com/?page=2'), true)

console.log('Testing related catalog on CMS detail pages...')

const DETAIL_HTML = `
<html><body>
<article>
  <h1>Current Video</h1>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"VideoObject","name":"Current Video","url":"https://cms.example.com/vod/detail/id/1.html"}
  </script>
  <p>This is the current detail page. Related recommendations live in the guess-you-like block below.</p>
</article>
<div class="guesslike">
  <a href="/vod/detail/id/2.html"><img src="https://cms.example.com/t/2.jpg" alt="Related two"></a>
  <a href="/vod/detail/id/3.html"><img src="https://cms.example.com/t/3.jpg" alt="Related three"></a>
  <a href="/vod/detail/id/4.html"><img src="https://cms.example.com/t/4.jpg" alt="Related four"></a>
  <a href="/vod/detail/id/5.html"><img src="https://cms.example.com/t/5.jpg" alt="Related five"></a>
</div>
<nav>
  <a href="/vod/type/id/1.html">电影</a>
</nav>
</body></html>
`

const related = extractRelatedCatalog(
  DETAIL_HTML,
  'https://cms.example.com/vod/detail/id/1.html',
  { excludeUrls: ['https://cms.example.com/vod/type/id/1.html'] },
)
assert.equal(related.length, 4, 'detail page should keep guess-you-like cards')
assert.equal(
  related.some((item) => item.originUrl.includes('/vod/detail/id/1.html')),
  false,
  'current article must not appear in related',
)
assert.equal(
  related.some((item) => item.originUrl.includes('/vod/type/id/1.html')),
  false,
  'category nav must not appear in related',
)
assert.equal(related[0]?.title, 'Related two')

const withRelated = appendRelatedCatalogHtml('<p>正文</p>', related)
assert.match(withRelated, /相关内容/)
assert.match(withRelated, /data-reader-role="related"/)
assert.match(withRelated, /vod\/detail\/id\/2\.html/)
assert.match(withRelated, /Related two/)

const unchanged = appendRelatedCatalogHtml('<p>正文</p>', [])
assert.equal(unchanged, '<p>正文</p>')

const sanitizedRelated = sanitizeArticleHtml(withRelated)
assert.match(sanitizedRelated, /data-reader-role="related"/)
assert.match(sanitizedRelated, /data-reader-role="related-grid"/)
assert.match(sanitizedRelated, /data-reader-role="related-item"/)
assert.match(sanitizedRelated, /data-reader-role="related-media"/)
assert.match(sanitizedRelated, /data-reader-role="related-title"/)
assert.match(sanitizedRelated, /vod\/detail\/id\/2\.html/)

assert.match(sanitizedRelated, /data-related-title="Related two"/)

console.log('Testing MacCMS ds3 card title extraction...')
const DS3_CARD = `
<a href="https://huarenok.com/voddetail/201001.html">
  <div style="background-image: url('https://img.example.com/poster.jpg');"></div>
  <div class="slide-info-type"><span>votype_1type_name</span></div>
  <h3 class="slide-info-title">御廷谣 2026 32</h3>
  <p>孟晏辉原本是个不受宠的庶女，被送入宫中成为采女...</p>
</a>
<a href="https://huarenok.com/voddetail/201001.html">御廷谣 2026 32</a>
<a href="https://huarenok.com/voddetail/201103.html"><img src="https://img.example.com/9.jpg">热映推荐 04集全</a>
<a href="https://huarenok.com/voddetail/201103.html"><h3>九门</h3></a>
<a href="https://huarenok.com/voddetail/201673.html"><img src="https://img.example.com/h.jpg">热映推荐 21</a>
<a href="https://huarenok.com/voddetail/201673.html">花开锦绣</a>
<a href="https://huarenok.com/voddetail/201260.html"><img src="https://img.example.com/x.jpg"><h3>莫离</h3></a>
`
const ds3Items = extractHeuristicCardCatalog(DS3_CARD, 'https://huarenok.com/vodtype/2.html')
const yuting = ds3Items.find((item) => item.originUrl.includes('201001'))
assert.ok(yuting, 'should extract ds3 card')
assert.equal(yuting!.title, '御廷谣 2026 32')
assert.ok(!yuting!.title.includes('votype_'), 'title should not include template placeholder')
assert.equal(yuting!.image, 'https://img.example.com/poster.jpg')
const jiumen = ds3Items.find((item) => item.originUrl.includes('201103'))
assert.equal(jiumen?.title, '九门')
assert.equal(jiumen?.image, 'https://img.example.com/9.jpg')

console.log('Testing MacCMS lazy-load cover (src placeholder + data-src)...')
const LAZY_CARD = `
<a class="public-list-exp" href="/voddetail/201103.html" title="九门">
  <img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="九门封面图" data-src="https://static.example.com/piccdn/jiu_men.png" />
</a>
<a class="time-title" href="/voddetail/201103.html" title="九门">九门</a>
<a class="public-list-exp" href="/voddetail/201673.html" title="花开锦绣">
  <img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="https://static.example.com/piccdn/hua.png" />
</a>
<a class="time-title" href="/voddetail/201673.html">花开锦绣</a>
<a class="public-list-exp" href="/voddetail/201260.html" title="天才，女友">
  <img class="lazy" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" data-src="https://static.example.com/piccdn/tian.png" />
</a>
<a class="time-title" href="/voddetail/201260.html">天才，女友</a>
`
const lazyItems = extractHeuristicCardCatalog(LAZY_CARD, 'https://huarenok.com/voddetail/201001.html')
assert.equal(lazyItems.length >= 3, true, 'lazy cards should extract')
const lazyJiumen = lazyItems.find((item) => item.originUrl.includes('201103'))
assert.equal(lazyJiumen?.title, '九门')
assert.equal(lazyJiumen?.image, 'https://static.example.com/piccdn/jiu_men.png')
const lazyRelated = extractRelatedCatalog(LAZY_CARD, 'https://huarenok.com/voddetail/201001.html')
assert.equal(lazyRelated[0]?.image?.startsWith('https://'), true, 'related cards keep https covers')
assert.match(relatedCatalogHtml(lazyRelated), /referrerpolicy="no-referrer"/)

console.log('Testing nnyy detail meta + related cards...')
const NNYY_DETAIL = `<html><head><title>《窥欲者》全集在线观看 - 电影 - 努努影院</title></head><body>
<h1 class="product-title">窥欲者 Maninilip <span>(2025)</span></h1>
<div class="product-excerpt">剧情简介：<span>亚历克斯，一个年轻的摄影师，秘密记录他的邻居的性生活。</span></div>
<div class="lists list-like"><header><h3>猜你喜欢</h3></header><ul></ul></div>
</body></html>`
const nnyyMeta = extractWebCatalogDetailMeta(NNYY_DETAIL)
assert.equal(nnyyMeta.title, '窥欲者')
assert.match(nnyyMeta.synopsis || '', /亚历克斯/)

const NNYY_LISTING = `
<ul>
<li><a href="/dianying/20252607.html" class="thumbnail"><img data-src="/nnimg2/20252607.jpg" alt="窥欲者"></a><h2><a href="/dianying/20252607.html">窥欲者</a></h2></li>
<li><a href="/dianying/20249088.html" class="thumbnail"><img data-src="/nnimg2/20249088.jpg" alt="在里面"></a><h2><a href="/dianying/20249088.html">在里面</a></h2></li>
<li><a href="/dianying/202508746.html" class="thumbnail"><img data-src="/nnimg2/202508746.jpg" alt="麦迪的秘密"></a><h2><a href="/dianying/202508746.html">麦迪的秘密</a></h2></li>
</ul>`
const nnyyRelated = extractRelatedCatalog(NNYY_LISTING, 'https://nnyy.in/dianying/', {
  excludeUrls: ['https://nnyy.in/dianying/20252607.html'],
})
assert.equal(nnyyRelated.length, 2)
assert.ok(nnyyRelated.every((item) => /\/dianying\/\d+\.html$/.test(item.originUrl)))

console.log('catalog-engine tests passed')
