import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
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
const { PresetSwitcher } = await import('../src/components/PresetSwitcher')

const root = createRoot(document.getElementById('root')!)
let manageCalls = 0
let selected = ''
let siteSelected = ''

const builtins = [
  { id: 'cn', name: '中国资讯', description: '国内要闻与公共议题', builtin: true, active: true },
  { id: 'world', name: '全球视野', description: '国际新闻与全球评论', builtin: true, active: false },
]
const sites = [
  { id: 'zhihu', name: '知乎', description: '推荐、热榜、问题与回答', active: false },
  { id: 'linuxdo', name: 'Linux.do', description: '技术交流与开源分享', active: false },
]

async function render(items = builtins, siteItems = sites) {
  await act(async () => {
    root.render(
      <PresetSwitcher
        activeName="中国资讯"
        items={items}
        onSelect={(id) => { selected = id }}
        onManage={() => { manageCalls += 1 }}
        siteItems={siteItems}
        onSelectSite={(id) => { siteSelected = id }}
        variant="pill"
      />,
    )
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  assert.ok(button, `button containing "${text}" must exist`)
  return button as HTMLButtonElement
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
  })
}

try {
  await render()
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)

  assert.ok(document.body.textContent?.includes('切换布局'))
  assert.ok(document.body.textContent?.includes('内置预设'))
  assert.ok(document.body.textContent?.includes('自定义'))
  assert.ok(document.body.textContent?.includes('社区入口'))
  assert.ok(document.body.textContent?.includes('中国资讯'))
  assert.ok(document.body.textContent?.includes('全球视野'))
  assert.ok(document.body.textContent?.includes('知乎'))
  assert.ok(document.body.textContent?.includes('Linux.do'))
  const zhihuLogo = document.querySelector('svg[data-community-logo="zhihu"]')
  const linuxDoLogo = document.querySelector('svg[data-community-logo="linuxdo"]')
  assert.ok(zhihuLogo, 'Zhihu community must render its brand SVG')
  assert.ok(linuxDoLogo, 'LINUX DO community must render its official SVG')
  assert.equal(zhihuLogo.getAttribute('viewBox'), '0 0 28 28')
  assert.equal(linuxDoLogo.getAttribute('viewBox'), '0 0 28 28')
  assert.equal(zhihuLogo.getAttribute('data-community-logo-body-size'), '24')
  assert.equal(zhihuLogo.getAttribute('data-community-logo-glyph'), 'zhi')
  assert.equal(zhihuLogo.querySelector('path')?.getAttribute('fill'), '#0F88EB')
  assert.equal(linuxDoLogo.getAttribute('data-community-logo-body-size'), '24')
  assert.equal(zhihuLogo.getAttribute('width'), linuxDoLogo.getAttribute('width'))
  assert.equal(zhihuLogo.getAttribute('height'), linuxDoLogo.getAttribute('height'))
  assert.ok(document.querySelectorAll('[role="tab"]').length === 2, 'upper section must have exactly two preset tabs')
  assert.ok(document.querySelectorAll('svg').length >= 8, 'major switcher controls/cards must use icons')

  await click(buttonWithText('自定义'))
  assert.ok(document.body.textContent?.includes('还没有自定义预设'))
  assert.ok(document.body.textContent?.includes('新建预设'))

  await click(buttonWithText('新建预设'))
  assert.equal(manageCalls, 1, 'empty-state CTA should open preset management')

  await render()
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  await click(buttonWithText('全球视野'))
  assert.equal(selected, 'world')

  await render()
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  await click(buttonWithText('知乎'))
  assert.equal(siteSelected, 'zhihu', 'community entry must switch site workspace, not preset')

  await render(builtins, [])
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  assert.ok(!document.body.textContent?.includes('社区入口'), 'empty web site list must hide the community section')
  assert.ok(!document.body.textContent?.includes('知乎'), 'web switcher must not expose the Zhihu workspace entry')
  assert.ok(!document.body.textContent?.includes('Linux.do'), 'web switcher must not expose the Linux.do workspace entry')

  const customItems = [
    ...builtins.map((item) => ({ ...item, active: false })),
    { id: 'mine', name: '我的晨读', description: '我的自定义布局', builtin: false, active: true },
  ]
  await render(customItems)
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  assert.equal(
    document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(),
    '自定义',
    'active custom preset should open on the custom tab',
  )
  assert.ok(document.body.textContent?.includes('我的晨读'))

  console.log('preset-switcher-ui: ok')
} finally {
  await act(async () => root.unmount())
}
