import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

import { speedReadBodyForExport } from '../features/speedRead/serialize'
import { log } from './logger'
import type { Article } from './types'

export interface ArticleMarkdownInput {
  article: Article
  title: string
  html: string
  originUrl?: string
  speedReadMarkdown?: string
  exportedAt?: number
}

export type MarkdownExportResult = 'shared' | 'downloaded' | 'cancelled'

function fallbackBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.href) {
    return window.location.href
  }
  return 'https://newsnook.local/'
}

function safeHttpUrl(value: string | null | undefined, baseUrl?: string): string {
  if (!value) return ''
  try {
    const url = new URL(value, baseUrl || fallbackBaseUrl())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function markdownLabel(value: string): string {
  return value.replace(/[\[\]]/g, '').replace(/[\r\n]+/g, ' ').trim()
}

function headingText(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/^\s*#+\s*/, '').trim()
}

function inlineText(node: Node, baseUrl?: string): string {
  if (node.nodeType === 3) return node.textContent || ''
  if (node.nodeType !== 1) return ''

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return ''
  if (tag === 'br') return '\n'
  if (tag === 'img') {
    const src = safeHttpUrl(element.getAttribute('src'), baseUrl)
    if (!src) return ''
    return `![${markdownLabel(element.getAttribute('alt') || '')}](${src})`
  }

  const children = Array.from(element.childNodes).map((child) => inlineText(child, baseUrl)).join('')
  if (tag === 'strong' || tag === 'b') return children.trim() ? `**${children.trim()}**` : ''
  if (tag === 'em' || tag === 'i') return children.trim() ? `_${children.trim()}_` : ''
  if (tag === 'code' && element.parentElement?.tagName.toLowerCase() !== 'pre') {
    const content = children.replace(/`/g, '\\`').trim()
    return content ? `\`${content}\`` : ''
  }
  if (tag === 'a') {
    const href = safeHttpUrl(element.getAttribute('href'), baseUrl)
    const label = markdownLabel(children) || href
    return href ? `[${label}](${href})` : children
  }
  return children
}

function listMarkdown(list: HTMLElement, baseUrl?: string, depth = 0): string {
  const ordered = list.tagName.toLowerCase() === 'ol'
  const items = Array.from(list.children).filter((child) => child.tagName.toLowerCase() === 'li')
  return items
    .map((item, index) => {
      const clone = item.cloneNode(true) as HTMLElement
      const nested = Array.from(clone.children).filter((child) => {
        const tag = child.tagName.toLowerCase()
        return tag === 'ul' || tag === 'ol'
      }) as HTMLElement[]
      nested.forEach((child) => child.remove())
      const prefix = ordered ? `${index + 1}. ` : '- '
      const base = `${'  '.repeat(depth)}${prefix}${inlineText(clone, baseUrl).replace(/\s+/g, ' ').trim()}`
      const nestedText = nested
        .map((child) => listMarkdown(child, baseUrl, depth + 1))
        .filter(Boolean)
        .join('\n')
      return nestedText ? `${base}\n${nestedText}` : base
    })
    .join('\n')
}

function tableMarkdown(table: HTMLElement, baseUrl?: string): string {
  const rows = Array.from(table.querySelectorAll('tr'))
    .map((row) =>
      Array.from(row.children)
        .filter((cell) => /^(?:TH|TD)$/.test(cell.tagName))
        .map((cell) => inlineText(cell, baseUrl).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()),
    )
    .filter((cells) => cells.length > 0)
  if (!rows.length) return ''

  const width = Math.max(...rows.map((row) => row.length))
  const normalized = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, width - row.length)).fill(''),
  ])
  const firstRowHasHeader = Boolean(table.querySelector('tr')?.querySelector('th'))
  const header = firstRowHasHeader ? normalized[0] : Array(width).fill('')
  const bodyRows = firstRowHasHeader ? normalized.slice(1) : normalized
  const separator = Array(width).fill('---')
  return [header, separator, ...bodyRows]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

function blockMarkdown(node: Node, baseUrl?: string): string {
  if (node.nodeType === 3) return node.textContent || ''
  if (node.nodeType !== 1) return ''

  const element = node as HTMLElement
  const tag = element.tagName.toLowerCase()
  if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') return ''
  if (tag === 'ul' || tag === 'ol') return `${listMarkdown(element, baseUrl)}\n\n`
  if (tag === 'table') return `${tableMarkdown(element, baseUrl)}\n\n`
  if (tag === 'pre') {
    const code = element.textContent || ''
    const fence = code.includes('```') ? '````' : '```'
    return `${fence}\n${code.replace(/\s+$/, '')}\n${fence}\n\n`
  }
  if (tag === 'blockquote') {
    const content = Array.from(element.childNodes)
      .map((child) => blockMarkdown(child, baseUrl))
      .join('')
      .trim()
    if (!content) return ''
    return `${content.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`
  }
  if (tag === 'hr') return '---\n\n'
  if (/^h[1-6]$/.test(tag)) {
    const sourceLevel = Number(tag.slice(1))
    const level = Math.min(Math.max(sourceLevel + 1, 3), 6)
    return `${'#'.repeat(level)} ${headingText(inlineText(element, baseUrl))}\n\n`
  }
  if (tag === 'p') return `${inlineText(element, baseUrl).trim()}\n\n`
  if (tag === 'figure') {
    const content = Array.from(element.childNodes)
      .map((child) => blockMarkdown(child, baseUrl))
      .join('')
      .trim()
    return content ? `${content}\n\n` : ''
  }
  if (tag === 'figcaption') {
    const text = inlineText(element, baseUrl).replace(/\s+/g, ' ').trim()
    return text ? `_${text}_\n\n` : ''
  }
  if (tag === 'img') return `${inlineText(element, baseUrl)}\n\n`
  if (tag === 'br') return '\n'

  return Array.from(element.childNodes)
    .map((child) => blockMarkdown(child, baseUrl))
    .join('')
}

export function htmlToMarkdown(html: string, baseUrl?: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  const markdown = Array.from(root.childNodes)
    .map((child) => blockMarkdown(child, baseUrl))
    .join('')
  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim())
}

function embeddedSpeedRead(markdown: string | undefined): string {
  const value = markdown?.trim()
  if (!value) return ''
  const body = speedReadBodyForExport(value).trim()
  if (!body) return ''
  return body.replace(/^##\s+/gm, '### ')
}

export function buildArticleMarkdown({
  article,
  title,
  html,
  originUrl,
  speedReadMarkdown,
  exportedAt = Date.now(),
}: ArticleMarkdownInput): string {
  const sourceUrl = safeHttpUrl(originUrl || article.originUrl)
  const body = htmlToMarkdown(html, sourceUrl || undefined)
  const summary = embeddedSpeedRead(speedReadMarkdown)
  const cleanTitle = headingText(title || article.title) || '一篇文章'
  const publishedAt = Number.isFinite(article.publishedAt)
    ? new Date(article.publishedAt).toISOString()
    : ''
  const lines = [
    '---',
    `title: ${yamlString(cleanTitle)}`,
    `source: ${yamlString(article.sourceName)}`,
    sourceUrl ? `url: ${yamlString(sourceUrl)}` : null,
    publishedAt ? `published_at: ${yamlString(publishedAt)}` : null,
    article.hasRealDate ? null : 'published_at_approximate: true',
    `exported_at: ${yamlString(new Date(exportedAt).toISOString())}`,
    '---',
    '',
    `# ${cleanTitle}`,
    '',
    `> 来源：${article.sourceName}`,
    sourceUrl ? `> 原文：${sourceUrl}` : null,
    '',
    summary ? '## AI 速读' : null,
    summary || null,
    summary ? '' : null,
    '## 正文',
    '',
    body || '_正文为空_',
    '',
  ].filter((line): line is string => line != null)
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function markdownFileName(title: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  return `${base || 'newsnook-article'}.md`
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || /cancel/i.test(error.message))
}

export async function exportMarkdownFile(
  markdown: string,
  fileName: string,
  title: string,
): Promise<MarkdownExportResult> {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  }

  try {
    await Filesystem.writeFile({
      path: fileName,
      data: markdown,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache })
    await Share.share({
      title,
      dialogTitle: '导出 Markdown',
      files: [uri],
    })
    return 'shared'
  } catch (error) {
    if (isCancellation(error)) return 'cancelled'
    log.reader.warn('markdown export failed', error)
    throw error
  }
}
