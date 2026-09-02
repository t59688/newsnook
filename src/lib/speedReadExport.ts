import { speedReadBodyForExport } from '../features/speedRead/serialize'
import { markdownFileName } from './articleMarkdown'

export interface SpeedReadMarkdownInput {
  articleTitle: string
  sourceName: string
  originUrl?: string
  model?: string
  markdown: string
  exportedAt?: number
}

function yamlString(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim())
}

export function buildSpeedReadMarkdown({
  articleTitle,
  sourceName,
  originUrl,
  model,
  markdown,
  exportedAt = Date.now(),
}: SpeedReadMarkdownInput): string {
  const title = articleTitle.trim() || '一篇文章'
  const body = speedReadBodyForExport(markdown)
  const lines = [
    '---',
    `title: ${yamlString(`${title} · AI 速读`)}`,
    `source: ${yamlString(sourceName)}`,
    originUrl ? `url: ${yamlString(originUrl)}` : null,
    model ? `model: ${yamlString(model)}` : null,
    `exported_at: ${yamlString(new Date(exportedAt).toISOString())}`,
    '---',
    '',
    `# ${title}`,
    '',
    `> 来源：${sourceName}`,
    originUrl ? `> 原文：${originUrl}` : null,
    model ? `> 模型：${model}` : null,
    '',
    '## AI 速读',
    '',
    body || '_暂无速读内容_',
    '',
  ].filter((line): line is string => line != null)
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function speedReadMarkdownFileName(articleTitle: string): string {
  const base = markdownFileName(articleTitle).replace(/\.md$/i, '')
  return `${base}-speed-read.md`
}
