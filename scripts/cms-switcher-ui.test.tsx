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

const presets = [
  { id: 'home', name: '国内要闻', builtin: true, active: true },
  { id: 'world', name: '全球视野', builtin: true, active: false },
]
const cms = [
  { id: 'cms-a', name: '站点甲', description: 'https://a.example.test' },
  { id: 'cms-b', name: '站点乙', description: 'https://b.example.test' },
]
let selectedCms = ''
let selectedPreset = ''
let addCalls = 0
let browseAllCalls = 0

async function render(cmsSites = cms, active = false, activeCmsId: string | null = null) {
  await act(async () => {
    root.render(
      <PresetSwitcher
        activeName={active ? '站点乙' : '国内要闻'}
        items={presets}
        onSelect={(id) => { selectedPreset = id }}
        onManage={() => undefined}
        cmsSites={cmsSites}
        cmsActive={active}
        activeCmsId={activeCmsId}
        onSelectCms={(id) => { selectedCms = id }}
        onSites={() => { browseAllCalls += 1 }}
        onAddCms={() => { addCalls += 1 }}
        variant="pill"
      />,
    )
  })
}

function button(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(text))
  assert.ok(match, 'expected button: ' + text)
  return match as HTMLButtonElement
}

async function click(element: HTMLButtonElement) {
  await act(async () => { element.click() })
}

try {
  await render([])
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  await click(document.querySelector('[role="tab"]:last-child') as HTMLButtonElement)
  assert.ok(document.body.textContent?.includes('让熟悉的网站成为你的阅读空间'))
  assert.ok(document.body.textContent?.includes('添加站点'))
  await click(button('添加站点'))
  assert.equal(addCalls, 1, '无已适配 CMS 站点时能够直达添加入口')
  assert.equal(document.querySelector('[role="dialog"]'), null)

  await render(cms, true, 'cms-b')
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim(), 'CMS 站点',
    '位于 CMS 站点阅读空间时直接打开第三类型')
  assert.equal(document.querySelector('button[aria-current="page"]')?.textContent?.includes('站点乙'), true,
    '当前 CMS 站点应有明显选中态')
  assert.ok(document.body.textContent?.includes('站点甲'))
  assert.ok(document.body.textContent?.includes('站点乙'))
  assert.equal(document.body.textContent?.includes('社区入口'), false,
    '只有 CMS 站点时不可显示空的社区入口；CMS 与社区语义必须分开')
  await click(button('站点甲'))
  assert.equal(selectedCms, 'cms-a', '点击 CMS 站点应进入独立站点，不选择资讯预设')
  assert.equal(selectedPreset, '')
  assert.equal(document.querySelector('[role="dialog"]'), null)

  await render(cms, true, 'cms-a')
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  assert.ok(document.querySelector('button[aria-current="page"]')?.textContent?.includes('站点甲'))
  await click(button('全部站点'))
  assert.equal(browseAllCalls, 1, 'CMS 聚合入口应保留在 CMS 类型下，而不是社区入口')

  await render(cms, true, 'cms-a')
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  await click(button('内置预设'))
  await click(button('全球视野'))
  assert.equal(selectedPreset, 'world', '从 CMS 回到普通资讯布局要走预设选择回调')

  // 测试 CMS 帮助说明弹窗
  await render([])
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  await click(document.querySelector('[role="tab"]:last-child') as HTMLButtonElement)
  assert.ok(document.body.textContent?.includes('了解用途与支持类型'))
  await click(button('了解用途与支持类型'))
  assert.ok(document.body.textContent?.includes('CMS 站点说明与支持类型'))
  assert.ok(document.body.textContent?.includes('什么是 CMS 独立站点空间？'))
  assert.ok(document.body.textContent?.includes('支持添加哪些类型的网站？'))
  assert.ok(document.body.textContent?.includes('影视与动漫'))
  assert.ok(document.body.textContent?.includes('MacCMS'))
  assert.ok(document.body.textContent?.includes('WordPress'))
  await click(button('我知道了'))
  assert.equal(document.body.textContent?.includes('CMS 站点说明与支持类型'), false, '点击“我知道了”后说明弹窗关闭')

  // 测试有站点时头部与底部的帮助按钮及“去添加站点”按钮
  await render(cms, true, 'cms-a')
  await click(document.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement)
  const helpBtn = document.querySelector('button[aria-label="查看 CMS 站点说明"]') as HTMLButtonElement
  assert.ok(helpBtn, 'CMS 面板中应存在感叹号帮助按钮')
  await click(helpBtn)
  assert.ok(document.body.textContent?.includes('CMS 站点说明与支持类型'))
  const prevAddCalls = addCalls
  await click(button('去添加站点'))
  assert.equal(addCalls, prevAddCalls + 1, '在说明弹窗中点击“去添加站点”应触发添加入口')

  console.log('cms switcher ui: ok')
} finally {
  await act(async () => root.unmount())
}
