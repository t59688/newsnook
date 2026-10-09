import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
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

// The content screen also imports speed-read styles; the DOM test only exercises the Dock.
registerHooks({
  load(url, context, nextLoad) {
    if (/\.css(?:[?#]|$)/.test(url)) return { format: 'module', source: 'export default ""', shortCircuit: true }
    return nextLoad(url, context)
  },
})

const { createRoot } = await import('react-dom/client')
const { ZhihuAnswerActionBar } = await import('../src/features/zhihu/ui/ZhihuContentScreen')
const root = createRoot(document.getElementById('root')!)
let upVotes = 0
let comments = 0
let nextAnswers = 0

try {
  await act(async () => {
    root.render(
      <ZhihuAnswerActionBar
        authenticated
        voteWritable
        actionBusy={false}
        voteState="neutral"
        voteCountLabel="1739"
        commentCountLabel="209"
        commentsDisabled={false}
        collectionAction={<button type="button" aria-label="收藏回答">收藏</button>}
        onUpVote={() => { upVotes += 1 }}
        onDownVote={() => undefined}
        onOpenComments={() => { comments += 1 }}
        onNextAnswer={() => { nextAnswers += 1 }}
      />,
    )
  })

  const dock = document.querySelector('nav[aria-label="回答操作"]') as HTMLElement
  assert.ok(dock, '知乎回答必须保留完整操作栏')
  assert.ok(dock.classList.contains('fixed') && dock.classList.contains('bottom-0'),
    '工具栏直接贴底固定，不再浮动留缝')
  assert.ok(dock.classList.contains('border-t'), 'Dock 用细分隔线与正文区分')
  assert.ok(!dock.classList.contains('pointer-events-none'), 'Dock 的空白区域不允许点击穿透到正文链接')
  assert.ok(!dock.classList.contains('rounded-2xl'), 'Dock 不使用悬浮圆角容器')
  assert.ok((dock.getAttribute('style') ?? '').includes('--sab'), '底部必须避让 Android 安全区')
  assert.ok(dock.querySelector('[aria-label="赞同"]'))
  assert.ok(dock.querySelector('[aria-label="反对"]'))
  assert.ok(dock.querySelector('[aria-label="收藏回答"]'))
  assert.ok(dock.querySelector('[aria-label="查看 209 条评论"]'))
  assert.ok((dock.querySelector('[aria-label="上一个回答"]') as HTMLButtonElement).disabled,
    '首个回答未提供上一个回调时按钮禁用')

  await act(async () => {
    ;(dock.querySelector('[aria-label="赞同"]') as HTMLButtonElement).click()
    ;(dock.querySelector('[aria-label="查看 209 条评论"]') as HTMLButtonElement).click()
    ;(dock.querySelector('[aria-label="下一个回答"]') as HTMLButtonElement).click()
  })
  assert.deepEqual([upVotes, comments, nextAnswers], [1, 1, 1], '原有操作不因布局改动而失效')

  const content = readFileSync('src/features/zhihu/ui/ZhihuContentScreen.tsx', 'utf8')
  assert.ok(content.includes('pb-[calc(6rem+var(--sab,0px))]'),
    '正文必须预留超过 Dock 高度的底部滚动空间，避免最后一行被遮住')

  console.log('zhihu answer dock ui: ok')
} finally {
  await act(async () => root.unmount())
}
