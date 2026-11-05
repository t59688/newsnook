import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractCatalog } from '../src/features/catalogEngine/engine'
import { extractRelatedCatalog } from '../src/features/catalogEngine/related'
import { catalogItemsToArticles } from '../src/features/catalogEngine/toArticles'
import { observeMediaInHtml, buildMediaDescriptor } from '../src/features/mediaSniffer/core'
import { discoverMediaDescriptor } from '../src/features/mediaSniffer/service'
import { withQualityVariants } from '../src/features/mediaSniffer/liveCandidate'
import type { MediaDescriptor } from '../src/features/mediaSniffer/types'
import type { NewsSource } from '../src/sources/registry'

const page = 'https://video.example/data/current.html'
const source: NewsSource = { id:'custom_video_test', name:'Videos', label:'Videos', group:'custom', kind:'web-catalog', url:'https://video.example/', enabled:true, isCustom:true }
const descriptor = (overrides: Partial<MediaDescriptor>): MediaDescriptor => ({
  type:'hls', url:'https://cdn.example/master.m3u8', pageUrl:page, score:100,
  videoTracks:[], audioTracks:[], subtitles:[], drm:false, drmKeySystems:[], ...overrides,
})

test('playback controls never compete with actual related titles', () => {
  const controls = ['1080P','HD','高清','第1集','第2集','线路一'].map((label,i) => `<a href="/watch/${i+1}.html">${label}</a>`).join('')
  const related = [21,22,23].map(id => `<a href="/data/${id}.html"><img src="/covers/${id}.jpg" alt="Documentary episode ${id}"></a>`).join('')
  const items = extractRelatedCatalog(`<div class="playlist">${controls}</div><section class="related">${related}</section>`,page)
  assert.deepEqual(items.map(item => item.title), ['Documentary episode 21','Documentary episode 22','Documentary episode 23'])
})

test('thumbnail file links cannot become detail pages in semantic or heuristic catalogs', () => {
  const html = `<main>${[1,2,3].map(id=>`<article><a title="Film ${id}" href="/uploads/${id}.jpg"><img src="/uploads/${id}.jpg" alt="Film ${id}"></a><a href="/watch/${id}">Film ${id}</a><span class="duration">12:30</span></article>`).join('')}</main>`
  const items = extractCatalog(html,'https://video.example/latest').items
  assert.deepEqual(items.map(item=>item.originUrl), [1,2,3].map(id=>`https://video.example/watch/${id}`))
  assert.ok(items.every(item=>item.contentType==='video'))
  assert.equal(extractCatalog([1,2,3].map(id=>`<a href="/uploads/${id}.jpg"><img src="/uploads/${id}.jpg" alt="Film ${id}"></a>`).join(''),page).items.length,0)
})

test('catalog materialization rejects direct image assets from structured upstream data', () => {
  const items = catalogItemsToArticles(source,[{id:'bad',originUrl:'https://video.example/cover.jpg',title:'Poster'}, {id:'ok',originUrl:'https://video.example/watch/23',title:'Film'}],Date.now())
  assert.deepEqual(items.map(item=>item.title),['Film'])
})

test('current MacCMS object is read as data without selecting the next episode', () => {
  const url = 'https://cdn.example/current/master.m3u8?token=keep'
  const html = `<script>var player_aaaa={encrypt:2,url:'${Buffer.from(encodeURIComponent(url)).toString('base64')}',url_next:'https://cdn.example/next/master.m3u8',from:'高清线路'};</script>`
  const observations = observeMediaInHtml(html,page)
  assert.ok(observations.some(item=>item.url===url && item.sourceLabel==='高清线路'))
  assert.equal(observations.some(item=>item.url?.includes('/next/')),false)
})

test('primary player config wins over raw script strings and unrelated recommendations', () => {
  const html = `<script>new DPlayer({container:document.getElementById('player'),video:{url:'https://cdn.example/main.mp4',type:'auto'}}); var suggestions=[{url:'https://cdn.example/recommended.mp4'}];</script>`
  const observations = observeMediaInHtml(html,page)
  assert.ok(observations.some(item=>item.url==='https://cdn.example/main.mp4'))
  assert.equal(observations.some(item=>item.url==='https://cdn.example/recommended.mp4'),false)
})

test('body and source labels survive graph normalization', () => {
  const value=buildMediaDescriptor([{source:'static',url:'https://cdn.example/main.mp4',mimeType:'video/mp4',pageUrl:page,sourceLabel:'HD',quality:'高清'}])
  assert.equal(value?.sourceLabel,'HD')
})

test('external HLS audio must not be detached by making the video variant a standalone source', () => {
  const input=descriptor({videoTracks:[{kind:'video',url:'https://cdn.example/1080.m3u8',height:1080,groupId:'audio'}],audioTracks:[{kind:'audio',url:'https://cdn.example/audio.m3u8',groupId:'audio'}]})
  assert.deepEqual(withQualityVariants(input).resources?.map(item=>item.url),[input.url])
})

test('DASH representations are not playable DASH manifests', () => {
  const input=descriptor({type:'dash',url:'https://cdn.example/main.mpd',videoTracks:[{kind:'video',url:'https://cdn.example/video.mp4',height:1080}],audioTracks:[{kind:'audio',url:'https://cdn.example/audio.mp4'}]})
  assert.deepEqual(withQualityVariants(input).resources?.map(item=>item.url),[input.url])
})

test('an aborted discovery neither creates a WebView nor publishes a stale resource',async()=>{
  const abort=new AbortController(); abort.abort()
  let probes=0,emits=0
  const result=await discoverMediaDescriptor({pageUrl:page,html:'<video src="https://cdn.example/main.mp4"></video>', signal:abort.signal,observeNative:async()=>{probes++;return []}, onDescriptor:()=>{emits++}})
  assert.equal(probes,0);assert.equal(emits,0);assert.equal(result,null)
})

test('hyphenated video detail routes retain video identity instead of an image-only article',async()=>{
  const { migrateCatalogCache } = await import('../src/features/siteCatalog/cache')
  const { resolveArticleBody } = await import('../src/lib/resolveBody')
  const { Capacitor } = await import('@capacitor/core')
  const html=[1,2,3].map(id=>`<div class="thumbnail"><a href="video-${id}.htm"><div class="image" style="background-image:url('/thumb/${id}.webp')"><var class="duration">12:30</var></div></a><div class="caption title"><h5><a href="video-${id}.htm">Video ${id}</a></h5></div></div>`).join('')
  const items=extractCatalog(html,source.url).items
  assert.equal(items.length,3)
  const articles=catalogItemsToArticles(source,items,Date.now())
  assert.ok(articles.every(item=>item.contentType==='video'))
  const legacy={...articles[0],contentType:'article' as const}
  assert.equal(migrateCatalogCache(source,[legacy])[0].contentType,'video')
  const getPlatform=Capacitor.getPlatform
  const isNativePlatform=Capacitor.isNativePlatform
  const originalFetch=globalThis.fetch
  Capacitor.getPlatform=()=>'android';Capacitor.isNativePlatform=()=>false
  globalThis.fetch=async()=>new Response('',{status:403})
  try {
    const body=await resolveArticleBody(legacy,undefined,[source])
    assert.equal(body.bodySource,'video','explicit video route must retain a player even when plain HTTP extraction is blocked')
    assert.equal(/<img\b/i.test(body.contentHtml),false,'poster must not replace the player')
  }finally{Capacitor.getPlatform=getPlatform;Capacitor.isNativePlatform=isNativePlatform;globalThis.fetch=originalFetch}
})

test('quality expansion is idempotent when metadata is enriched more than once',()=>{
  const input=descriptor({videoTracks:[{kind:'video',url:'https://cdn.example/1080.m3u8',height:1080}]})
  const once=withQualityVariants(input)
  const twice=withQualityVariants(once)
  assert.deepEqual(twice.resources?.map(item=>item.url),once.resources?.map(item=>item.url))
})

test('explicit current player page precedes generic embeds without following url_next',async()=>{
  const { planSniffTargets } = await import('../src/features/mediaSniffer/targetPlanner')
  const html=`<iframe src="https://player.example/embed/backup"></iframe><script>var player_aaaa={url:'https://player.example/player/current',url_next:'https://player.example/player/next',from:'HD'};</script>`
  const targets=planSniffTargets({pageUrl:page,html,staticObservations:[]})
  assert.equal(targets[0].url,'https://player.example/player/current')
  assert.equal(targets.some(target=>target.url.endsWith('/next')),false)
})

test('a live-owned page is never opened again by the finite discovery queue',async()=>{
  let probes=0
  await discoverMediaDescriptor({pageUrl:page,html:'<video src="https://cdn.example/main.mp4"></video>',excludeRuntimeUrls:[page],observeNative:async()=>{probes++;return []}} as Parameters<typeof discoverMediaDescriptor>[0])
  assert.equal(probes,0)
})

test('explicit line buttons are discoverable even when CMS uses opaque page paths',async()=>{
  const { secondaryPlaybackUrlsInHtml } = await import('../src/features/mediaSniffer/targetPlanner')
  const html='<div class="playlist"><a href="/route?id=1">1080P</a><a href="/route?id=2">HD</a></div><section class="related"><a href="/watch/unrelated">Another film</a></section>'
  assert.deepEqual(secondaryPlaybackUrlsInHtml(html,page),['https://video.example/route?id=1','https://video.example/route?id=2'])
})

test('primary video evidence restores unknown-slug players but not editorial embedded videos',async()=>{
  const { isPrimaryVideoPage } = await import('../src/features/mediaSniffer/pageEvidence')
  assert.equal(isPrimaryVideoPage('<main><h1>Film</h1><div id="player"><video poster="/cover.jpg"></video></div></main>',page),true)
  assert.equal(isPrimaryVideoPage(`<article><p>${'An editorial article about camera sensor design. '.repeat(30)}</p><video src="/sample.mp4"></video></article>`,page),false)
  assert.equal(isPrimaryVideoPage('<main><h1>Photo essay</h1><img src="/cover.jpg"></main>',page),false)
})

test('episode navigation is not a fallback source for the current episode',async()=>{
  const { secondaryPlaybackUrlsInHtml } = await import('../src/features/mediaSniffer/targetPlanner')
  const html='<a href="/vodplay/42-1-1.html">第1集</a><a href="/vodplay/42-1-2.html">下一集</a><a href="/vodplay/42-2-1.html">高清</a>'
  assert.deepEqual(secondaryPlaybackUrlsInHtml(html,'https://video.example/vodplay/42-1-1.html'),['https://video.example/vodplay/42-2-1.html'])
})

test('template playlist discovery chooses only the selected episode on each line',async()=>{
  const { discoverCmsPlayerHints } = await import('../src/features/mediaSniffer/cmsAdapters')
  const html=`MacPlayer.PlayFrom="HD$$$高清";MacPlayer.PlayUrl="第1集$https://video.example/play/one#第2集$https://video.example/play/two$$$第1集$https://video.example/play/one-b#第2集$https://video.example/play/two-b";`
  assert.deepEqual(discoverCmsPlayerHints(html,'https://video.example/vodplay/42-1-2.html').map(item=>item.url),['https://video.example/play/two','https://video.example/play/two-b'])
})

test('advertising/tracking frames cannot consume the player discovery budget',async()=>{
  const { embeddedPageUrlsInHtml } = await import('../src/features/mediaSniffer/targetPlanner')
  const html='<iframe src="https://stats.example/pixel" width="1" height="1"></iframe><div class="advertising"><iframe src="https://random.example/frame"></iframe></div><div id="player"><iframe src="https://player.example/embed/current"></iframe></div>'
  assert.deepEqual(embeddedPageUrlsInHtml(html,page),['https://player.example/embed/current'])
})

test('each secondary player receives a bounded share instead of the first using the entire timeout',async()=>{
  const budgets:number[]=[]
  await discoverMediaDescriptor({pageUrl:page,html:'<iframe src="https://one.example/embed/1"></iframe><iframe src="https://two.example/embed/1"></iframe>',timeoutMs:8000,observeNative:async(_url,budget)=>{budgets.push(budget);return []}})
  assert.equal(budgets.length,2)
  assert.ok(budgets[0]>=1500&&budgets[0]<=4000)
})
