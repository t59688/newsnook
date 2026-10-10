import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { Article } from '../src/lib/types'
import type { NewsSource } from '../src/sources/registry'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const { createRoot } = await import('react-dom/client')
const { SiteScreen } = await import('../src/screens/SiteScreen')

const root = createRoot(document.getElementById('root')!)
const originalFetch = globalThis.fetch

const site1: NewsSource = {
  id: 'site_movie',
  name: 'www.xiangguys.com',
  label: 'www.',
  url: 'https://www.xiangguys.com/',
  group: 'custom',
  kind: 'web-catalog',
  enabled: true,
}

const site2: NewsSource = {
  id: 'site_blog',
  name: 'huarenok.com',
  label: 'huar',
  url: 'https://huarenok.com/',
  group: 'custom',
  kind: 'web-catalog',
  enabled: true,
}

const cardHtml = (title: string, id: number) =>
  `<main><article><h2><a href="/posts/${id}">${title}</a></h2></article></main>`

const requests: string[] = []

try {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://app.test/').searchParams.get('url')!
    requests.push(url)
    if (url.includes('xiangguys.com')) {
      return new Response(
        cardHtml('机密重案之致命诱惑 (1994)', 1) +
          '<nav><a href="/category/action/">动作电影</a></nav><a rel="next" href="/page/2">下一页</a>',
        { headers: { 'content-type': 'text/html' } },
      )
    }
    return new Response(cardHtml('华人资讯头条', 2), {
      headers: { 'content-type': 'text/html' },
    })
  }

  let selectedSiteId = ''
  let openedArticle: Article | undefined

  await act(async () => {
    root.render(
      <SiteScreen
        sites={[{ source: site1 }, { source: site2 }]}
        readIds={new Set()}
        onSelectSite={(id) => {
          selectedSiteId = id
        }}
        onOpen={(article) => {
          openedArticle = article
        }}
      />,
    )
  })

  // 1. 验证智能提炼品牌名称，不再在顶部直接暴露长域名
  assert.ok(document.body.textContent?.includes('Xiangguys'), 'formats domain into clean brand name')

  // 2. 点击呼出站点切换抽屉
  const triggerBtn = [...document.querySelectorAll('button')].find(
    (b) =>
      b.getAttribute('aria-haspopup') === 'dialog' ||
      b.getAttribute('aria-label')?.includes('切换站点'),
  )
  assert.ok(triggerBtn, 'renders site switcher trigger')
  await act(async () => {
    triggerBtn.click()
  })

  // 3. 验证抽屉内呈现站点数量与清晰干净的域名
  assert.ok(document.body.textContent?.includes('2'), 'shows site count badge in sheet')
  assert.ok(document.body.textContent?.includes('xiangguys.com'), 'shows clean domain for site1')

  // 4. 在抽屉中找到 site2 (huarenok.com) 并点击切换
  const site2Btn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('huarenok.com'),
  )
  assert.ok(site2Btn, 'renders option button for site2 in sheet')
  await act(async () => {
    site2Btn.click()
  })
  assert.equal(selectedSiteId, site2.id, 'triggers onSelectSite for site2')
  assert.ok(requests.some((r) => r.includes('huarenok.com')), 'loads site2 catalog')

  // 5. 验证打开条目
  const articleBtn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('华人资讯头条'),
  )
  assert.ok(articleBtn, 'renders site2 article card')
  await act(async () => {
    articleBtn?.click()
  })
  assert.equal(openedArticle?.sourceId, site2.id, 'opens article from active site')
} finally {
  await act(async () => root.unmount())
  globalThis.fetch = originalFetch
}

console.log('site-ui advanced switcher tests: ok')
