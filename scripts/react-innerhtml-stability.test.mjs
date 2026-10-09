import assert from 'node:assert/strict'

import { parseHTML } from 'linkedom'
import React, { useEffect, useMemo, useRef, useState } from 'react'

const { window } = parseHTML('<!doctype html><html><body><div id="unstable"></div><div id="stable"></div></body></html>')

globalThis.window = window
globalThis.document = window.document
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.HTMLElement = window.HTMLElement
globalThis.React = React

const { createRoot } = await import('react-dom/client')

function Probe({ stable }) {
  const ref = useRef(null)
  const [, setTick] = useState(0)
  const html = '<div data-probe="shell"><span>STATIC</span></div>'
  const memoizedMarkup = useMemo(() => ({ __html: html }), [html])
  const markup = stable ? memoizedMarkup : { __html: html }

  useEffect(() => {
    const shell = ref.current?.querySelector('[data-probe="shell"]')
    if (!shell) throw new Error('probe shell missing')
    shell.innerHTML = '<b>PLAYER_HOST</b>'
    // Simulate an unrelated ZhihuContentScreen state update such as
    // answer-neighbor/vote/loading state completing after the video portal mounts.
    setTick((value) => value + 1)
  }, [])

  return React.createElement('div', {
    ref,
    dangerouslySetInnerHTML: markup,
  })
}

const unstableRoot = createRoot(document.getElementById('unstable'))
unstableRoot.render(React.createElement(Probe, { stable: false }))
await new Promise((resolve) => setTimeout(resolve, 30))

const unstableHtml = document.getElementById('unstable')?.innerHTML ?? ''
assert.match(
  unstableHtml,
  /STATIC/,
  'React 19 regression premise changed: a fresh dangerouslySetInnerHTML object should overwrite imperative children on unrelated rerender',
)

const stableRoot = createRoot(document.getElementById('stable'))
stableRoot.render(React.createElement(Probe, { stable: true }))
await new Promise((resolve) => setTimeout(resolve, 30))

const stableHtml = document.getElementById('stable')?.innerHTML ?? ''
assert.match(
  stableHtml,
  /PLAYER_HOST/,
  'memoized dangerouslySetInnerHTML object must preserve the imperative/portal host across unrelated rerenders',
)
assert.doesNotMatch(
  stableHtml,
  /STATIC/,
  'stable markup must not let React restore the static fallback over the mounted player',
)

unstableRoot.unmount()
stableRoot.unmount()

console.log('react-innerhtml-stability: ok')
