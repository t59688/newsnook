import type { MouseEvent } from 'react'

import { openContentLink } from '../features/browser/browserOpen'
import { markdownToSafeHtml } from '../lib/markdown'

type Props = {
  markdown: string
  className?: string
}

/** 安全渲染 Markdown，网页链接使用应用的浏览器入口。 */
export function MarkdownBody({ markdown, className }: Props) {
  const html = markdownToSafeHtml(markdown)

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement | null)?.closest?.('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (href && openContentLink(href)) event.preventDefault()
  }

  return (
    <div
      className={['changelog-md', className].filter(Boolean).join(' ')}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
