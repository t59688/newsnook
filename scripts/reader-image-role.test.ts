import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import {
  classifyLoadedImage,
  inferImageDisplayRole,
  normalizeContentImages,
} from '../src/lib/normalizeImages'
import {
  imageReferer,
  initialListImageUrl,
  normalizeListImageUrl,
} from '../src/lib/imageProxy'

function imgFrom(html: string): Element {
  const { document } = parseHTML(`<div id="r">${html}</div>`)
  const img = document.querySelector('img')
  assert.ok(img, 'expected img')
  return img
}

{
  const role = inferImageDisplayRole(
    imgFrom('<img src="https://cdn.example/logo.png" width="40" height="40" alt="网易财经" />'),
  )
  assert.equal(role, 'badge', 'explicit small width/height attrs should be badge')
}

{
  const raw = 'http://dingyue.ws.126.net/2026/0918/cover.jpg'
  assert.equal(normalizeListImageUrl(raw), 'https://dingyue.ws.126.net/2026/0918/cover.jpg')
  assert.equal(
    initialListImageUrl(raw, false),
    '/api/image?url=https%3A%2F%2Fdingyue.ws.126.net%2F2026%2F0918%2Fcover.jpg',
  )
  assert.equal(initialListImageUrl(raw, true), 'https://dingyue.ws.126.net/2026/0918/cover.jpg')
  assert.equal(imageReferer(raw), 'https://www.163.com/')
  assert.equal(
    normalizeListImageUrl('//cms-bucket.ws.126.net/cover.png'),
    'https://cms-bucket.ws.126.net/cover.png',
  )
  assert.equal(
    initialListImageUrl('https://img.ithome.com/news/photo.png', false),
    'https://img.ithome.com/news/photo.png',
    '普通图床应继续直连，仅加载失败时由 InkImage 代理重试',
  )

  const bilibiliCover =
    'https://i1.hdslb.com/bfs/archive/6bf5b54e994bf040700c9d2bb6e9728b5a05d5a8.jpg'
  assert.equal(
    initialListImageUrl(bilibiliCover, false),
    bilibiliCover,
    'Bilibili 图片继续直连优先；失败后 InkImage 再走 /api/image，避免强制所有用户绕 Cloudflare',
  )
  assert.equal(initialListImageUrl(bilibiliCover, true), bilibiliCover)
  assert.equal(imageReferer(bilibiliCover), 'https://www.bilibili.com/')
}

{
  const role = inferImageDisplayRole(
    imgFrom(
      '<img src="https://cdn.example/logo.png" style="width: 36px; height: 36px;" alt="网易财经" />',
    ),
  )
  assert.equal(role, 'badge', 'small inline style size should be badge')
}

{
  const role = inferImageDisplayRole(
    imgFrom('<img src="https://cdn.example/vip_badge.png" alt="认证" />'),
  )
  assert.equal(role, 'badge', 'verified/vip badge URL should be badge')
}

{
  const role = inferImageDisplayRole(
    imgFrom(
      '<img src="https://cdn.example/photo.jpg" width="800" height="450" alt="现场图" />',
    ),
  )
  assert.equal(role, 'content', 'large content photo attrs should stay content')
}

{
  assert.equal(classifyLoadedImage(24, 24), 'badge')
  assert.equal(classifyLoadedImage(16, 16), 'badge')
  assert.equal(classifyLoadedImage(4, 4), 'decorative')
  assert.equal(classifyLoadedImage(200, 200), 'badge', 'square medium logo should be badge')
  assert.equal(classifyLoadedImage(960, 540), 'content')
  assert.equal(classifyLoadedImage(640, 640), 'content', 'large square photos stay content')
}

{
  const html = normalizeContentImages(
    '<p><img src="/avatar/logo.png" style="width:32px;height:32px" alt="网易财经" /></p>',
    'https://news.example/a',
  )
  assert.match(html, /data-reader-role="badge"/, 'normalize should stamp badge role')
}

{
  const html = normalizeContentImages(
    '<p><img src="https://cdn.example/wide.jpg" width="1200" height="800" alt="配图" /></p>',
    'https://news.example/a',
  )
  assert.doesNotMatch(html, /data-reader-role="badge"/, 'content images must not be stamped badge')
}

{
  const html = normalizeContentImages(
    '<p><img data-src="https://mmbiz.qpic.cn/mmbiz_png/demo/640?wx_fmt=png" /></p>',
    'https://www.jiqizhixin.com/articles/x',
  )
  assert.match(
    html,
    /referrerpolicy="no-referrer"/,
    'WeChat CDN images need no-referrer to skip hotlink placeholder',
  )
}

console.log('reader-image-role.test.ts: ok')
