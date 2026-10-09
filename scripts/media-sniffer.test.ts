import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import { parseMediaApiBody } from '../src/features/mediaSniffer/apiParser'
import {
  bestMediaUrlInPayload,
  buildMediaDescriptor,
  collectMediaCandidates,
  mediaFingerprint,
  observeMediaInHtml,
  observeMediaInPayload,
  parseDashManifest,
  parseHlsManifest,
  mediaFormatFor,
  mergeObservationSources,
  nestedRequestUrls,
} from '../src/features/mediaSniffer/core'
import { logicalMediaUrl, admitObservation as classifyObservation } from '../src/features/mediaSniffer/classifier'
import {
  admitSessionObservation,
  buildMediaGraph,
  descriptorFromAsset,
  selectPlayableAsset,
  synthesizeDashMpd,
} from '../src/features/mediaSniffer/graph'
import { originOf, playbackHeadersForTarget } from '../src/features/mediaSniffer/originHeaders'
import { observationsWithoutSessionNonce, nativePreparePlaybackUrl, collectPlaybackOrigins } from '../src/features/mediaSniffer/native'
import type { MediaObservation } from '../src/features/mediaSniffer/types'
import { shouldBridgeNativePlayback } from '../src/features/mediaSniffer/playback'
import {
  discoverMediaDescriptor,
  embeddedPageUrlsInHtml,
  mediaDescriptorHtml,
  runtimeProbePageUrl,
} from '../src/features/mediaSniffer/service'
import {
  planSniffTargets,
  secondaryPlaybackUrlsInHtml,
} from '../src/features/mediaSniffer/targetPlanner'
import { nnyyPlayApiUrls } from '../src/features/mediaSniffer/nnyyPlay'

const pageUrl = 'https://news.example/articles/42'

{
  assert.deepEqual(
    embeddedPageUrlsInHtml(
      '<iframe src="/player/42"></iframe><iframe data-src="https://video.example/embed/7?x=1&amp;y=2"></iframe>',
      pageUrl,
    ),
    [
      'https://news.example/player/42',
      'https://video.example/embed/7?x=1&y=2',
    ],
    '正文播放器 iframe 应作为独立运行时探测目标，而不是只加载文章外层页面',
  )
}

{
  const original = 'https://www.youtube.com/embed/M7lc1UVf-VE?start=3'
  const probe = new URL(runtimeProbePageUrl(original))
  assert.equal(probe.searchParams.get('start'), '3')
  assert.equal(probe.searchParams.get('autoplay'), '1')
  assert.equal(probe.searchParams.get('mute'), '1')
  assert.equal(
    runtimeProbePageUrl('https://video.example/player/42?token=signed'),
    'https://video.example/player/42?token=signed',
    '未知站点不得擅自改写签名播放器 URL',
  )
}

{
  const nested = 'https://cdn.example/master.m3u8?token=keep'
  const wrapper = `https://player.example/proxy?url=${encodeURIComponent(nested)}`
  assert.deepEqual(nestedRequestUrls(wrapper), [nested])
  assert.equal(
    buildMediaDescriptor(mergeObservationSources([{
      url: wrapper,
      pageUrl,
      source: 'network',
    }]))?.url,
    nested,
    '网络请求包装的 url= 媒体地址应像 youtoo 一样拆出并参与候选判定',
  )
}

{
  let emitted: string | undefined
  const observation: MediaObservation = {
    url: 'https://cdn.example/live.m3u8',
    pageUrl,
    source: 'network',
    mimeType: 'application/vnd.apple.mpegurl',
  }
  const descriptor = await discoverMediaDescriptor({
    pageUrl,
    runtime: true,
    onDescriptor: (value) => { emitted = value.url },
    observeNative: async (_url, _timeout, _referrer, onObservation) => {
      onObservation?.(observation)
      await new Promise((resolve) => setTimeout(resolve, 20))
      return [observation]
    },
  })
  assert.equal(emitted, observation.url, '原生单条可靠命中应在最终 sniff Promise 前增量发布')
  assert.equal(descriptor?.url, observation.url)
}

{
  const emittedHeaders: Array<Record<string, string> | undefined> = []
  const descriptor = await discoverMediaDescriptor({
    pageUrl,
    html: '<video src="https://cdn.example/video.mp4"></video>',
    runtime: true,
    onDescriptor: (value) => { emittedHeaders.push(value.requestHeaders) },
    observeNative: async (_url, _timeout, _referrer, onObservation) => {
      const observation: MediaObservation = {
        url: 'https://cdn.example/video.mp4',
        pageUrl,
        source: 'network',
        mimeType: 'video/mp4',
        requestHeaders: {
          Referer: pageUrl,
          'User-Agent': 'NewsNook',
        },
      }
      onObservation?.(observation)
      return [observation]
    },
  })
  assert.equal(emittedHeaders.length, 2, '同 URL 在运行时补齐请求头后应被视为新 descriptor')
  assert.equal(emittedHeaders[0], undefined)
  assert.equal(emittedHeaders[1]?.Referer, pageUrl)
  assert.equal(descriptor?.requestHeaders?.Referer, pageUrl)
}

{
  assert.equal(
    shouldBridgeNativePlayback({ format: 'progressive' }),
    false,
    '公开 MP4 应交给 WebView 原生网络栈持续处理 Range 请求',
  )
  assert.equal(
    shouldBridgeNativePlayback({ format: 'progressive', forceBridge: true }),
    true,
    '直连失败后可切换到带会话头的流式桥接',
  )
  assert.equal(
    shouldBridgeNativePlayback({ format: 'dash' }),
    true,
    'DASH 清单与分片需要共享原生播放会话',
  )
  assert.equal(
    shouldBridgeNativePlayback({ format: 'hls' }),
    true,
    'HLS 分片与密钥需要共享原生播放会话以保持 Cookie/Referer',
  )
  assert.equal(
    shouldBridgeNativePlayback({ format: 'progressive', headers: { Referer: pageUrl } }),
    true,
    '显式请求头必须由原生桥接补齐',
  )
}

{
  const muxed = 'https://cdn.example/videoplayback?id=42&mime=video%2Fmp4'
  const ranged = `${muxed}&range=0-524287`
  assert.equal(mediaFormatFor(muxed), 'progressive', '查询参数 MIME 应识别无扩展名媒体')
  assert.equal(mediaFormatFor(ranged), 'segment', '带 URL byte range 的响应只是分片，不能冒充完整视频')
  assert.equal(
    buildMediaDescriptor([{ url: ranged, pageUrl, source: 'network' }]),
    null,
    '只有媒体分片时必须继续嗅探或降级，不能交给播放器后播放一秒即中断',
  )
  assert.equal(
    buildMediaDescriptor([{
      url: 'https://cdn.example/videoplayback?id=private-transport',
      pageUrl,
      source: 'fetch',
      mimeType: 'application/vnd.example-private-stream',
    }]),
    null,
    '私有传输协议不能伪装成 MP4；必须保留原播放器降级路径',
  )
}

{
  const m4sVideo = 'https://upos.example/video.m4s?cdnid=1'
  const m4sAudio = 'https://upos.example/audio.m4s'
  assert.equal(
    mediaFormatFor(m4sVideo, 'video/mp4'),
    'video-track',
    '.m4s 有 video MIME 时是完整 Representation，不是垃圾分片',
  )
  assert.equal(mediaFormatFor(m4sAudio, 'audio/mp4'), 'audio-track')
  assert.equal(
    mediaFormatFor(m4sVideo),
    'video-track',
    '无 MIME 的 .m4s 不得仅因扩展名变成 segment',
  )
  assert.equal(
    logicalMediaUrl('https://cdn.example/videoplayback?id=42&mime=video%2Fmp4&range=0-524287'),
    'https://cdn.example/videoplayback?id=42&mime=video%2Fmp4',
  )
  assert.equal(
    logicalMediaUrl('https://cdn.example/videoplayback?id=42&mime=video%2Fmp4&range=0-524287&expire=1800000000&sig=keep'),
    'https://cdn.example/videoplayback?id=42&mime=video%2Fmp4&expire=1800000000&sig=keep',
    '逻辑轨只移除分片定位参数，必须保留 CDN 签名和过期上下文',
  )
}

{
  // Fixture 06 (HLS 三域名头隔离) and 09/10 (Cookie/Bearer same vs cross origin):
  // covered by playbackHeadersForTarget — Cookie/Authorization stay on exact origin;
  // captured Range is never copied into playback headers.
  const pageUrl = 'https://news.example/articles/42'
  const videoOrigin = 'https://v1.cdn.example'
  const captured = {
    'https://news.example': {
      cookie: 'sid=1',
      authorization: 'Bearer secret',
      referer: pageUrl,
      'user-agent': 'NewsNook',
    },
    [videoOrigin]: { referer: pageUrl, 'user-agent': 'NewsNook' },
  }
  const same = playbackHeadersForTarget({
    targetUrl: 'https://news.example/play.m3u8',
    pageUrl,
    capturedByOrigin: captured,
  })
  assert.equal(same.cookie, 'sid=1')
  assert.equal(same.authorization, 'Bearer secret')
  const cross = playbackHeadersForTarget({
    targetUrl: `${videoOrigin}/seg.ts`,
    pageUrl,
    capturedByOrigin: captured,
  })
  assert.equal(cross.cookie, undefined)
  assert.equal(cross.authorization, undefined)
  assert.equal(cross.referer, pageUrl, '跨域 CDN 有捕获到的真实 Referer 时应保留，而非回退到站点根路径')
  const crossNoCapturedReferer = playbackHeadersForTarget({
    targetUrl: `${videoOrigin}/seg.ts`,
    pageUrl,
    capturedByOrigin: {
      'https://news.example': captured['https://news.example'],
      [videoOrigin]: { 'user-agent': 'NewsNook' },
    },
  })
  assert.equal(crossNoCapturedReferer.referer, 'https://news.example/', '跨域 CDN 未捕获 Referer 时回退到页面 origin')
  assert.equal(originOf('https://v1.cdn.example:443/a'), 'https://v1.cdn.example')
  const ranged = playbackHeadersForTarget({
    targetUrl: 'https://news.example/play.m3u8',
    pageUrl,
    capturedByOrigin: {
      'https://news.example': { range: 'bytes=0-1', authorization: 'Bearer secret', 'user-agent': 'NewsNook' },
    },
  })
  assert.equal(ranged.range, undefined, '播放头不得复制网页捕获的 Range')
  const html = mediaDescriptorHtml(
    {
      type: 'progressive',
      url: 'https://cdn.example/v.mp4',
      pageUrl,
      score: 1,
      videoTracks: [],
      audioTracks: [],
      subtitles: [],
      drm: false,
      drmKeySystems: [],
      requestHeaders: {
        Referer: pageUrl,
        cookie: 'sid=1',
        Authorization: 'Bearer secret',
      },
    },
    { title: 'clip' },
  )
  assert.equal(html.includes('sid=1'), false, 'data-media-headers 不得序列化 Cookie')
  assert.equal(html.includes('Bearer'), false, 'data-media-headers 不得序列化 Authorization')
  assert.equal(html.includes('Referer'), true)
}

{
  const muxedUrl = 'https://cdn.example/play?id=muxed&mime=video%2Fmp4'
  const adaptiveUrl = 'https://cdn.example/play?id=video-only&mime=video%2Fmp4'
  const observations = observeMediaInPayload({
    streamingData: {
      formats: [{
        url: muxedUrl,
        mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
        qualityLabel: '360p',
        audioQuality: 'AUDIO_QUALITY_LOW',
        width: 640,
        height: 360,
        bitrate: 720000,
      }],
      adaptiveFormats: [{
        url: adaptiveUrl,
        mimeType: 'video/mp4; codecs="avc1.640028"',
        qualityLabel: '1080p',
        width: 1920,
        height: 1080,
        bitrate: 4500000,
      }],
    },
  }, pageUrl)
  const descriptor = buildMediaDescriptor(observations)
  assert.equal(descriptor?.url, muxedUrl, '完整音视频资源应优先于更高清的无声自适应轨道')
  assert.equal(descriptor?.hasAudio, true)
}

{
  const adUrl = 'https://s1.kwai.net/bs2/ad-i18n-dsp/preroll.mp4'
  const contentUrl = 'https://la.btc620.com/mp43/879782.mp4?st=signed&e=1800000000'
  const descriptor = buildMediaDescriptor([
    { url: adUrl, pageUrl, source: 'dom', mimeType: 'video/mp4', hasAudio: true, hasVideo: true },
    { url: contentUrl, pageUrl, source: 'dom', mimeType: 'video/mp4', hasAudio: true, hasVideo: true },
  ])
  assert.equal(descriptor?.url, contentUrl, '广告预热视频不得覆盖正文视频')
  assert.equal(descriptor?.resources?.length, 2, '播放器应保留正文和广告两个可选资源')
  assert.equal(descriptor?.resources?.[0]?.isAd, false)
  assert.equal(descriptor?.resources?.[1]?.isAd, true)
}

{
  const signed = 'https://cdn.example/master.m3u8?token=secret&expires=1800000000&lang=zh'
  assert.equal(
    mediaFingerprint(signed),
    'https://cdn.example/master.m3u8?lang=zh',
    '指纹可忽略临时授权参数，但播放 URL 不应被修改',
  )
  const observations: MediaObservation[] = [
    { url: 'https://cdn.example/segment-001.ts', pageUrl, source: 'network' },
    { url: signed, pageUrl, source: 'network' },
    { url: 'https://cdn.example/fallback.mp4', pageUrl, source: 'dom' },
  ]
  const candidates = collectMediaCandidates(observations)
  assert.equal(candidates[0].originalUrl, signed, '完整清单必须优先于单文件和分片')
  assert.ok(!candidates.some((item) => item.format === 'segment'), '发现完整媒体后不展示分片')
}

{
  const hls = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="zh",URI="audio/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",URI="subs/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=3200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac",SUBTITLES="subs"
video/1080.m3u8`
  const parsed = parseHlsManifest(hls, 'https://cdn.example/master.m3u8')
  assert.deepEqual(parsed.videoTracks[0], {
    kind: 'video',
    url: 'https://cdn.example/video/1080.m3u8',
    bandwidth: 3200000,
    width: 1920,
    height: 1080,
    codecs: 'avc1.640028,mp4a.40.2',
    groupId: 'aac',
  })
  assert.equal(parsed.audioTracks[0].url, 'https://cdn.example/audio/index.m3u8')
  assert.equal(parsed.subtitles[0].language, 'en')
  assert.equal(parsed.drm, false)
}

{
  const dash = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed" />
      <Representation bandwidth="5000000" width="1920" height="1080" codecs="avc1.640028"><BaseURL>video/1080.m4s</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio" lang="zh"><Representation bandwidth="128000" codecs="mp4a.40.2" /></AdaptationSet>
  </Period>
</MPD>`
  const parsed = parseDashManifest(dash, 'https://cdn.example/manifest.mpd')
  assert.equal(parsed.videoTracks[0].height, 1080)
  assert.equal(parsed.videoTracks[0].url, 'https://cdn.example/video/1080.m4s')
  assert.equal(parsed.audioTracks[0].language, 'zh')
  assert.equal(parsed.drm, true, 'ContentProtection 必须进入 DRM 状态')
}

{
  const payload = {
    data: {
      arbitrary: {
        preferred: 'https://video.example/1080.mp4?signature=keep-me',
        fallback: 'https://video.example/720.mp4',
      },
    },
  }
  assert.equal(
    bestMediaUrlInPayload(payload, pageUrl),
    'https://video.example/1080.mp4?signature=keep-me',
    'JSON 发现不得依赖站点字段名，并保留签名参数',
  )
}

{
  const html = `<html><head><meta property="og:video" content="/watch?id=42"></head><body>
    <video data-src="/media/live" type="application/vnd.apple.mpegurl"></video>
  </body></html>`
  const observations = observeMediaInHtml(html, pageUrl)
  const descriptor = buildMediaDescriptor(observations)
  assert.equal(descriptor?.type, 'hls')
  assert.equal(descriptor?.url, 'https://news.example/media/live')
}

{
  const encoded = 'JTY4JTc0JTc0JTcwJTczJTNBJTJGJTJGJTYzJTY0JTZFJTMxJTM2JTJFJTMxJTMxJTc5JTc1JTZFJTJFJTczJTcwJTYxJTYzJTY1JTJGJTQ3JTQxJTU2JTMxJTJGJTMzJTMzJTM3JTMzJTM0JTM4JTJGJTMzJTMzJTM3JTMzJTM0JTM4JTJFJTZEJTMzJTc1JTM4'
  const html = `<script>var player_aaaa={"encrypt":2,"vod_data":{"vod_name":"fixture"},"url":"${encoded}","from":"dplayer"}</script>`
  const descriptor = buildMediaDescriptor(observeMediaInHtml(html, pageUrl))
  assert.equal(descriptor?.type, 'hls')
  assert.equal(
    descriptor?.url,
    'https://cdn16.11yun.space/GAV1/337348/337348.m3u8',
    'MacCMS player_aaaa 的二次编码播放地址应在静态嗅探阶段解开',
  )
}

{
  const descriptor = buildMediaDescriptor([
    { url: 'https://cdn.example/play?id=42', pageUrl, source: 'xhr', mimeType: 'video/mp4', statusCode: 206 },
    { pageUrl, source: 'mse', drmKeySystem: 'com.widevine.alpha' },
  ])
  assert.equal(descriptor?.type, 'progressive')
  assert.equal(descriptor?.drm, true)
  assert.deepEqual(descriptor?.drmKeySystems, ['com.widevine.alpha'])
}

{
  const descriptor = buildMediaDescriptor([
    { url: 'https://cdn.example/podcast.mp3', pageUrl, source: 'dom', mimeType: 'audio/mpeg', mediaKind: 'audio' },
  ])
  assert.equal(descriptor, null, '音频候选不能被误交给视频播放器')
}

{
  const assets = buildMediaGraph([
    {
      url: 'https://cdn.example/play?id=42',
      pageUrl,
      source: 'network',
      mimeType: 'video/mp4',
    },
  ])
  assert.equal(assets.length, 1)
  const descriptor = buildMediaDescriptor([
    { url: 'https://cdn.example/play?id=42', pageUrl, source: 'network', mimeType: 'video/mp4' },
  ])
  assert.equal(descriptor?.type, 'progressive')
  assert.equal(descriptor?.url, 'https://cdn.example/play?id=42')
}

{
  const body = JSON.stringify({ playurl: 'https://cdn.example/live/master.m3u8?token=1' })
  const parsed = parseMediaApiBody(body, pageUrl, 'fetch')
  const descriptor = buildMediaDescriptor(parsed)
  assert.equal(descriptor?.type, 'hls')
  assert.equal(descriptor?.url, 'https://cdn.example/live/master.m3u8?token=1')
}

{
  const body = JSON.stringify({
    dash: {
      video: [{
        baseUrl: 'https://upos.example/video.m4s',
        mimeType: 'video/mp4',
        width: 1920,
        height: 1080,
        bandwidth: 4500000,
        codecs: 'avc1.640028',
      }],
      audio: [{
        baseUrl: 'https://upos.example/audio.m4s',
        mimeType: 'audio/mp4',
        bandwidth: 128000,
        codecs: 'mp4a.40.2',
      }],
    },
  })
  const parsed = parseMediaApiBody(body, pageUrl, 'xhr')
  const assets = buildMediaGraph(parsed)
  assert.equal(assets.length, 1, 'B站式 dash.video+audio 必须同一 asset')
  assert.equal(assets[0].videos.length, 1)
  assert.equal(assets[0].audios.length, 1)
  const xml = synthesizeDashMpd(assets[0].videos[0], assets[0].audios[0])
  assert.match(xml, /video\.m4s/)
  assert.match(xml, /audio\.m4s/)
  assert.equal(assets[0].videos[0].codecs, 'avc1.640028')
  assert.equal(assets[0].audios[0].codecs, 'mp4a.40.2')
  assert.match(xml, /codecs="avc1.640028"/)
  assert.match(xml, /codecs="mp4a.40.2"/)
  const descriptor = descriptorFromAsset(assets[0], () => 'blob:nn-mpd')
  assert.equal(descriptor?.type, 'dash')
  assert.equal(descriptor?.url, 'blob:nn-mpd')
}

{
  const parsed = parseMediaApiBody(
    JSON.stringify({ playurl: 'https://cdn.example/play?id=42' }),
    pageUrl,
    'fetch',
  )
  assert.equal(parsed.length, 0, '无 MIME/扩展名的 playurl 在 Classifier Gate 下不直接入库')
}

{
  const observation: MediaObservation = {
    url: 'https://upos.example/video.m4s',
    pageUrl,
    source: 'network',
    mimeType: 'video/mp4',
  }
  const assets = buildMediaGraph([observation])
  assert.equal(selectPlayableAsset(assets), null, '未配对 video-track 不能进入可播集合')
  const descriptor = buildMediaDescriptor([observation])
  assert.equal(
    descriptor,
    null,
    '单条 .m4s + video/mp4 不得产出可播的非 DRM descriptor',
  )
}

{
  const assets = buildMediaGraph([
    { url: 'https://cdn.example/ad.mp4', pageUrl, source: 'network', mimeType: 'video/mp4', width: 640, height: 360 },
    { url: 'https://cdn.example/master.m3u8', pageUrl, source: 'network' },
  ])
  assert.equal(assets.length, 2)
  assert.equal(selectPlayableAsset(assets)?.manifest?.url, 'https://cdn.example/master.m3u8')
}

{
  const assets = buildMediaGraph([
    { url: 'https://cdn.example/a.mp4', pageUrl, source: 'dom', mimeType: 'video/mp4' },
    { url: 'https://cdn.example/b.mp4', pageUrl, source: 'dom', mimeType: 'video/mp4' },
  ])
  assert.equal(assets.length, 2)
}

{
  const network = new Set(['https://cdn.example/real.mp4'])
  assert.equal(
    admitSessionObservation(
      { url: 'https://evil.example/ad.mp4', pageUrl, source: 'dom', sessionNonce: 'abc' },
      'abc',
      network,
    ),
    false,
  )
  assert.equal(
    admitSessionObservation(
      { url: 'https://cdn.example/real.mp4', pageUrl, source: 'dom', sessionNonce: 'nope' },
      'abc',
      network,
    ),
    false,
  )
  assert.equal(
    admitSessionObservation(
      { url: 'https://cdn.example/real.mp4', pageUrl, source: 'network' },
      'abc',
      network,
    ),
    true,
  )
  assert.equal(
    admitSessionObservation(
      { url: 'https://evil.example/iframe-only.mp4', pageUrl, source: 'static', fromIframe: true },
      undefined,
      network,
    ),
    false,
    'iframe 转发且未出现在网络集合中的 URL 必须丢弃',
  )
  assert.equal(
    admitSessionObservation(
      { url: 'https://cdn.example/real.mp4', pageUrl, source: 'dom', fromIframe: true },
      undefined,
      network,
    ),
    true,
    'iframe 转发但已在网络集合中的 URL 可以保留',
  )
  const iframePage = 'https://player.example/ec?episode=1'
  const inlineManifest = 'https://cdn.example/live/index.m3u8'
  const iframeNetwork = new Set([iframePage])
  assert.equal(
    admitSessionObservation(
      { url: inlineManifest, pageUrl: iframePage, source: 'static', fromIframe: true },
      undefined,
      iframeNetwork,
    ),
    true,
    '已加载 iframe 文档中的 inline HLS 地址不要求自身先产生网络请求',
  )
  assert.equal(
    admitSessionObservation(
      { url: inlineManifest, pageUrl: iframePage, source: 'dom', fromIframe: true },
      undefined,
      iframeNetwork,
    ),
    true,
    '已加载 iframe 中 DOM/播放器声明的 HLS 在预告片结束前也应保留',
  )
  assert.equal(
    admitSessionObservation(
      { url: 'https://cdn.example/preroll.mp4', pageUrl: iframePage, source: 'dom', fromIframe: true, mimeType: 'video/mp4' },
      undefined,
      iframeNetwork,
    ),
    false,
    'iframe DOM 里的 progressive 仍要求真实网络命中，避免把预告片配置当正文',
  )
  const graph = buildMediaGraph([
    { url: 'https://cdn.example/real.mp4', pageUrl, source: 'network', mimeType: 'video/mp4' },
    { url: 'https://evil.example/iframe-only.mp4', pageUrl, source: 'static', fromIframe: true, mimeType: 'video/mp4' },
    { url: iframePage, pageUrl, source: 'network', mimeType: 'text/html' },
    { url: inlineManifest, pageUrl: iframePage, source: 'static', fromIframe: true },
  ])
  assert.equal(
    graph.some((asset) => asset.videos.some((track) => track.url.includes('evil.example'))),
    false,
    'Graph 不得把未出现在网络集合中的 iframe 转发 URL 收成资产',
  )
  assert.equal(
    graph.some((asset) => asset.manifest?.url === inlineManifest),
    true,
    '已加载 iframe 文档中的 inline HLS 地址应进入媒体图',
  )
}

{
  const iframePage = 'https://player.example/ec?episode=1'
  const adUrl = 'https://static.example/uploads/haigou/haigou.mp4'
  const contentUrl = 'https://cdn.example/show/index.m3u8'
  const descriptor = buildMediaDescriptor([
    { url: adUrl, pageUrl: iframePage, source: 'network', mimeType: 'video/mp4', mediaKind: 'video' },
    { url: contentUrl, pageUrl: iframePage, source: 'dom', fromIframe: true },
    { url: iframePage, pageUrl, source: 'network' },
  ])
  assert.equal(descriptor?.type, 'hls', '预告片 progressive 不得压过 iframe 中声明的正片 HLS')
  assert.equal(descriptor?.url, contentUrl)
  assert.equal(descriptor?.resources?.length, 2)
}

{
  const leftover: MediaObservation = {
    url: 'https://cdn.example/master.m3u8',
    pageUrl,
    source: 'fetch',
    sessionNonce: 'native-session',
  }
  assert.equal(
    buildMediaGraph([leftover]).length,
    0,
    'Graph 不得吞带 leftover sessionNonce 的探针观察',
  )
  const stripped = observationsWithoutSessionNonce([leftover])
  assert.equal('sessionNonce' in stripped[0], false)
  assert.equal(
    selectPlayableAsset(buildMediaGraph(stripped))?.manifest?.url,
    'https://cdn.example/master.m3u8',
    'native 剥掉 nonce 后 Graph 应摄入 fetch 清单',
  )
  const jsonBody = observationsWithoutSessionNonce([{
    url: 'https://api.example/playurl',
    pageUrl,
    source: 'fetch',
    bodyText: '{"url":"https://cdn.example/from-json.m3u8"}',
    sessionNonce: 'native-session',
  }])
  assert.equal(
    selectPlayableAsset(buildMediaGraph(jsonBody))?.manifest?.url,
    'https://cdn.example/from-json.m3u8',
    '剥掉 nonce 的 fetch JSON bodyText 应展开为 HLS',
  )
}

{
  const base = 'https://cdn.example/videoplayback?id=42&mime=video%2Fmp4'
  const descriptor = buildMediaDescriptor([
    { url: `${base}&range=0-1000`, pageUrl, source: 'network', mimeType: 'video/mp4' },
    { url: `${base}&range=1001-2000`, pageUrl, source: 'network', mimeType: 'video/mp4' },
  ])
  assert.equal(descriptor?.url, base)
  assert.equal(descriptor?.type, 'progressive')
}

{
  const youtubeVideo = 'https://r1---sn.googlevideo.com/videoplayback?id=v&itag=137&mime=video%2Fmp4&rn=1&rbuf=0&range=0-524287&expire=1800000000&sig=keep-video'
  const youtubeAudio = 'https://r1---sn.googlevideo.com/videoplayback?id=a&itag=140&mime=audio%2Fmp4&rn=2&rbuf=0&range=0-524287&expire=1800000000&sig=keep-audio'
  const assets = buildMediaGraph([
    { url: youtubeVideo, pageUrl, source: 'network', mimeType: 'video/mp4' },
    { url: youtubeVideo.replace('rn=1', 'rn=3').replace('range=0-524287', 'range=524288-1048575'), pageUrl, source: 'network', mimeType: 'video/mp4' },
    { url: youtubeAudio, pageUrl, source: 'network', mimeType: 'audio/mp4' },
    { url: youtubeAudio.replace('rn=2', 'rn=4').replace('range=0-524287', 'range=524288-1048575'), pageUrl, source: 'network', mimeType: 'audio/mp4' },
  ])
  assert.equal(assets.length, 1, 'YouTube 分段请求应按 transport 参数归并成一个音视频资产')
  assert.equal(assets[0].videos.length, 1)
  assert.equal(assets[0].audios.length, 1)
  assert.match(assets[0].videos[0].url, /sig=keep-video/)
}

{
  const youtubeVideo = 'https://r1---sn.googlevideo.com/videoplayback?id=v&itag=137&mime=video%2Fmp4&range=0-524287&expire=1800000000&sig=keep-video'
  const youtubeAudio = 'https://r1---sn.googlevideo.com/videoplayback?id=a&itag=140&mime=audio%2Fmp4&range=0-524287&expire=1800000000&sig=keep-audio'
  const descriptor = buildMediaDescriptor([
    { url: youtubeVideo, pageUrl, source: 'network', mimeType: 'video/mp4' },
    { url: youtubeAudio, pageUrl, source: 'network', mimeType: 'audio/mp4' },
  ])
  assert.equal(descriptor?.type, 'dash', '真机安静窗口可能每条自适应轨只看到一个 range 请求，也应形成可播放资产')
  assert.match(descriptor?.relatedUrls?.join('|') || '', /expire=1800000000/)
  assert.match(descriptor?.relatedUrls?.join('|') || '', /sig=keep-video/)
}

{
  const calls: string[] = []
  const html = '<video src="https://cdn.example/preview.mp4"></video><iframe src="https://player.example/ad"></iframe><iframe src="https://player.example/real"></iframe>'
  await discoverMediaDescriptor({
    pageUrl,
    html,
    runtime: true,
    timeoutMs: 6000,
    observeNative: async (url) => {
      calls.push(url)
      if (url.includes('/ad')) {
        return [{ url: 'https://cdn.example/ad.mp4', pageUrl: url, source: 'network', mimeType: 'video/mp4' }]
      }
      if (url.includes('/real')) {
        return [{ url: 'https://cdn.example/master.m3u8', pageUrl: url, source: 'network' }]
      }
      return [{ url: 'https://cdn.example/preview.mp4', pageUrl: url, source: 'network', mimeType: 'video/mp4' }]
    },
  })
  assert.ok(calls.some((item) => item.includes('/ad')))
  assert.ok(calls.some((item) => item.includes('/real')))
  assert.ok(calls.some((item) => item === pageUrl || item.includes('articles/42')))
}

{
  assert.equal(
    nativePreparePlaybackUrl({
      url: 'blob:https://localhost/synthetic-mpd',
      sourcePage: pageUrl,
    }),
    pageUrl,
    'blob: 合成 MPD 不得作为 preparePlayback 的播放地址',
  )
  assert.deepEqual(
    collectPlaybackOrigins({
      url: 'blob:https://localhost/synthetic-mpd',
      sourcePage: pageUrl,
      extraUrls: ['https://upos.example/video.m4s'],
    }),
    ['https://news.example', 'https://upos.example'],
  )
}

{
  const proxySource = readFileSync(
    join(process.cwd(), 'android/app/src/main/java/com/aizeek/newsnook/LocalStreamProxy.java'),
    'utf8',
  )
  assert.match(
    proxySource,
    /URLDecoder\.decode\(\s*value\s*,\s*"UTF-8"\s*\)/,
    'LocalStreamProxy 必须用 URLDecoder.decode(String, String)；decode(String, Charset) 在 API 33 才有，Android 12 会 NoSuchMethodError 崩进程',
  )
  assert.doesNotMatch(
    proxySource,
    /URLDecoder\.decode\([^;]*StandardCharsets/,
    '不得把 Charset 传给 URLDecoder.decode，core-oj 在 minSdk 24 设备上没有该重载',
  )
}

{
  const payload = JSON.stringify({
    video_plays: [{ play_data: 'https://cdn.example/stream/index.m3u8', src_site: 'lz' }],
  })
  const observations = parseMediaApiBody(payload, 'https://nnyy.in/dianying/1.html', 'fetch')
  assert.equal(
    bestMediaUrlInPayload(JSON.parse(payload), 'https://nnyy.in/dianying/1.html'),
    'https://cdn.example/stream/index.m3u8',
    'nnyy play_data should be recognized as media URL',
  )
  assert.ok(observations.some((item) => item.url?.includes('.m3u8')))

  const detailHtml = `<script>
    var url = '/_gp/{0}/{1}'.replace('{0}', '20252607').replace('{1}', ep_slug);
    on_ep('hd');
  </script>`
  assert.deepEqual(
    nnyyPlayApiUrls(detailHtml, 'https://nnyy.in/dianying/20252607.html'),
    ['https://nnyy.in/_gp/20252607/hd'],
  )
}

// ==================== Classifier Gate ====================

{
  assert.equal(
    classifyObservation({
      url: 'https://cdn.example/static/favicon.png',
      pageUrl: 'https://news.example/v/1',
      source: 'static',
      mediaKind: 'video',
      hasVideo: true,
      width: 192,
      height: 192,
    }),
    null,
  )
  assert.equal(
    classifyObservation({
      url: 'https://cdn.example/theme/common.css',
      pageUrl: 'https://news.example/v/1',
      source: 'performance',
    }),
    null,
  )
  assert.ok(
    classifyObservation({
      url: 'https://cdn.example/live/master.m3u8',
      pageUrl: 'https://news.example/v/1',
      source: 'network',
      mimeType: 'application/vnd.apple.mpegurl',
    }),
  )
  const logoOnly = parseMediaApiBody(
    '{"logo":{"url":"https://x.com/a.png","width":192}}',
    pageUrl,
    'fetch',
  )
  assert.equal(logoOnly.length, 0, 'JSON 仅含 logo png 的 url 字段不应产生 observation')
}

// ==================== 图片 URL 守卫（favicon/logo 误报回归） ====================

{
  assert.equal(
    mediaFormatFor('https://vod.example/static/favicon/favicon.png', undefined, { mediaKind: 'video' }),
    'unknown',
    '宽度/高度启发式不得把图片 URL 分类成视频（favicon/logo 误报）',
  )
  assert.equal(
    mediaFormatFor('https://vod.example/pic/cover.png?v=1', undefined, { mediaKind: 'video' }),
    'unknown',
    '带查询串的图片 URL 同样排除',
  )
  assert.equal(
    mediaFormatFor('https://vod.example/logo.png', 'video/mp4'),
    'progressive',
    '显式视频 MIME 仍优先于扩展名',
  )
  assert.equal(
    mediaFormatFor('https://vod.example/clip.mp4', undefined, { mediaKind: 'video' }),
    'progressive',
    '非图片 URL 的视频提示保持原有行为',
  )
}

// ==================== 播放页跟随（generic playback path） ====================

const maccmsDetailUrl = 'https://vod.example/voddetail/42.html'
const maccmsDetailHtml = `<!DOCTYPE html>
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"示例影院","url":"https://vod.example/","logo":{"@type":"ImageObject","url":"https://vod.example/static/favicon/favicon.png","width":192,"height":192}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"VideoObject","name":"某剧","embedUrl":"https://vod.example/vodplay/42-1-1.html","thumbnailUrl":"https://vod.example/pic/42.png"}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie","name":"某剧","potentialAction":{"@type":"WatchAction","target":{"@type":"EntryPoint","urlTemplate":"https://vod.example/vodplay/42-1-1.html"}},"url":"https://vod.example/voddetail/42.html"}</script>
</head><body>
<a href="/vodplay/42-1-1.html">立即播放</a>
<a href="/vodplay/42-1-2.html">第2集</a>
<a href="https://other.example/vodplay/99-1-1.html">外站</a>
</body></html>`

{
  assert.deepEqual(
    secondaryPlaybackUrlsInHtml(maccmsDetailHtml, maccmsDetailUrl),
    [
      'https://vod.example/vodplay/42-1-1.html',
      'https://vod.example/vodplay/42-1-2.html',
    ],
    'JSON-LD embedUrl/WatchAction 优先且去重，正文同站 generic playback path 链接兜底，外站不跟随',
  )
  const targets = planSniffTargets({
    pageUrl: maccmsDetailUrl,
    html: maccmsDetailHtml,
    staticObservations: [],
    totalTimeoutMs: 9000,
  })
  assert.deepEqual(
    targets.map((target) => target.url),
    [
      'https://vod.example/vodplay/42-1-1.html',
      'https://vod.example/vodplay/42-1-2.html',
    ],
  )
  assert.equal(targets[0]?.budgetMs, 9000, '首个播放目标应获得完整探测预算')
  assert.equal(targets[1]?.budgetMs, 9000, '后续目标由编排层按剩余时间动态截断')
  const observations = observeMediaInHtml(maccmsDetailHtml, maccmsDetailUrl)
  assert.equal(
    buildMediaDescriptor(observations),
    null,
    '详情页只有 JSON-LD logo（192x192）时不得产出可播放媒体',
  )
}

{
  const probed: Array<{ url: string; timeoutMs: number; referrer?: string }> = []
  const observation: MediaObservation = {
    url: 'https://cdn.example/master.m3u8',
    pageUrl: 'https://vod.example/vodplay/42-1-1.html',
    source: 'network',
    mimeType: 'application/vnd.apple.mpegurl',
  }
  const descriptor = await discoverMediaDescriptor({
    pageUrl: maccmsDetailUrl,
    html: maccmsDetailHtml,
    runtime: true,
    timeoutMs: 9000,
    observeNative: async (url, timeoutMs, referrer) => {
      probed.push({ url, timeoutMs, referrer })
      return [observation]
    },
  })
  assert.equal(probed.length, 2, '详情页自身无媒体时按队列探测同站播放页，不再浪费窗口加载无播放器的详情页')
  assert.equal(probed[0]?.url, 'https://vod.example/vodplay/42-1-1.html')
  assert.equal(probed[0]?.timeoutMs, 9000, '首个播放目标应获得完整嗅探预算')
  assert.equal(probed[0]?.referrer, maccmsDetailUrl, '播放页请求应携带详情页作为 Referer')
  assert.equal(descriptor?.url, observation.url)
}

{
  const probed: string[] = []
  const html = '<video src="https://cdn.example/a.m3u8"></video><a href="/vodplay/1-1-1.html">播放</a>'
  await discoverMediaDescriptor({
    pageUrl: 'https://vod.example/voddetail/1.html',
    html,
    runtime: true,
    timeoutMs: 6000,
    observeNative: async (url) => {
      probed.push(url)
      return []
    },
  })
  assert.deepEqual(
    probed,
    ['https://vod.example/voddetail/1.html'],
    '页面自身已声明媒体时保持原有行为：探测页面本身，不跟随播放页',
  )
}

{
  const playerHtml = '<script>window.HR_P2P={"channel_key":"https://cdn.example/live/index.m3u8","region":"US"}</script>'
  const observations = observeMediaInHtml(playerHtml, 'https://player.example/ec')
  assert.ok(
    observations.some((item) => item.url === 'https://cdn.example/live/index.m3u8'),
    '播放器脚本中的 channel_key 清单 URL 必须进入静态观察路径',
  )
}

{
  const parsed = parseMediaApiBody(JSON.stringify({
    format: 'hls',
    url: 'https://cdn.example/live/master',
    backup_urls: ['https://backup.example/live/master.m3u8', 'https://backup.example/live/alt.m3u8'],
  }), pageUrl, 'fetch')
  assert.equal(parsed.length, 3, '播放器 API 的 format 与 backup_urls 应全部进入观察图')
  assert.ok(parsed.every((item) => item.mimeType === 'application/vnd.apple.mpegurl' || item.url?.endsWith('.m3u8')))
}

{
  const wrapped = `https://player.example/proxy?url=${encodeURIComponent('https://cdn.example/signed/master.m3u8?token=1')}`
  const parsed = parseMediaApiBody(JSON.stringify({ url: wrapped }), pageUrl, 'fetch')
  assert.deepEqual(parsed.map((item) => item.url), ['https://cdn.example/signed/master.m3u8?token=1'], 'API 包装 URL 应展开内部媒体地址')
}

{
  const targets = planSniffTargets({
    pageUrl: 'https://news.example/article/1',
    html: '<iframe src="https://player.example/embed/1"></iframe>',
    staticObservations: [],
    totalTimeoutMs: 6000,
  })
  assert.deepEqual(targets, [{
    url: 'https://player.example/embed/1',
    referrer: 'https://news.example/article/1',
    budgetMs: 6000,
  }], '无 JSON-LD 播放页时 iframe 也应成为独立嗅探目标')
}

{
  const pageUrl = 'https://vod.example/vodplay/1-1-1.html'
  const html = `<script type="application/ld+json">{"@type":"VideoObject","embedUrl":"https://canonical.example/vodplay/1-1-1.html"}</script>
    <iframe src="/Player/ec?episode=1-1-1"></iframe>
    <a href="/vodplay/'+U+'">模板占位</a>
    <a href="/vodplay/1-1-2.html">下一集</a>`
  const targets = planSniffTargets({
    pageUrl,
    html,
    staticObservations: [],
    totalTimeoutMs: 9000,
  })
  assert.deepEqual(
    targets.map((target) => target.url),
    [
      'https://vod.example/Player/ec?episode=1-1-1',
      'https://canonical.example/vodplay/1-1-1.html',
      'https://vod.example/vodplay/1-1-2.html',
    ],
    '存在 iframe 播放器时必须优先探测 iframe；模板占位链接不能污染嗅探队列',
  )
}

{
  const html = '<meta property="og:url" content="https://redirected.example/vodplay/1-1-1.html"><iframe src="/Player/ec?episode=1-1-1"></iframe>'
  assert.deepEqual(
    embeddedPageUrlsInHtml(html, 'https://original.example/vodplay/1-1-1.html'),
    ['https://redirected.example/Player/ec?episode=1-1-1'],
    '页面发生域名重定向时，相对 iframe 必须按 HTML 的有效站点基址解析',
  )
}

console.log('media-sniffer tests passed')
