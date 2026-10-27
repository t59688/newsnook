import assert from 'node:assert/strict'
import { test } from 'node:test'
import { admitObservation, mediaFormatFor } from '../src/features/mediaSniffer/classifier'
import { buildMediaDescriptor } from '../src/features/mediaSniffer/core'
import { secondaryPlaybackUrlsInHtml } from '../src/features/mediaSniffer/targetPlanner'
const page = 'https://video.example/data/current.html'

test('an empty DOM source resolved to its own HTML document is never a media candidate', () => {
  assert.equal(admitObservation({url:page,pageUrl:page,source:'dom',mediaKind:'video'}),null)
  assert.equal(buildMediaDescriptor([{url:page,pageUrl:page,source:'dom',mediaKind:'video'}]),null)
})

test('HTML responses and player wrappers cannot become video from a DOM hint or nested extension', () => {
  for (const url of ['https://video.example/play.html', 'https://video.example/player.html?url=https://cdn.example/film.mp4']) {
    assert.equal(mediaFormatFor(url,undefined,{mediaKind:'video'}),'unknown')
    assert.equal(admitObservation({url,pageUrl:page,source:'dom',mediaKind:'video'}),null)
  }
  assert.equal(admitObservation({url:'https://cdn.example/film.mp4',pageUrl:page,source:'fetch',mimeType:'text/html',statusCode:200}),null)
})

test('a server-confirmed extensionless video endpoint remains usable', () => {
  const observation={url:'https://cdn.example/stream?id=42',pageUrl:page,source:'fetch' as const,mimeType:'video/mp4',statusCode:206}
  assert.ok(admitObservation(observation))
  assert.equal(buildMediaDescriptor([observation])?.url,observation.url)
})

test('playlist tabs and recommendation poster badges never consume playback targets', () => {
  const html = `<ul><li><a href="#con_playlist_1">播放地址</a></li><li><a href="#">播放地址</a></li></ul>
  <div class="playlist"><a href="/data/current/abc.html">HD</a><a href="/data/current/def.html">720P</a></div>
  <div class="swiper-slide"><a class="video-pic" href="/data/another.html" style="background-image:url('/another.jpg')"><span>1080P</span></a><h5><a href="/data/another.html">Another film</a></h5></div>`
  assert.deepEqual(secondaryPlaybackUrlsInHtml(html,page),['https://video.example/data/current/abc.html','https://video.example/data/current/def.html'])
})
