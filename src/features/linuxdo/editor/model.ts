import type { LinuxDoDraftData } from '../draft/service'

export type ComposerSelection = { start: number; end: number }

export interface ComposerEdit {
  value: string
  selection: ComposerSelection
}

export type ComposerCommand =
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'link'
  | 'quote'
  | 'code'
  | 'bullet-list'
  | 'ordered-list'

export type ComposerSnippetKind =
  | 'quote-post'
  | 'preformatted'
  | 'table'
  | 'toc'
  | 'scrolling'
  | 'mermaid'
  | 'chart'
  | 'details'
  | 'graphviz'
  | 'datetime'
  | 'math'
  | 'footnote'
  | 'spoiler'
  | 'poll'
  | 'line-break'

export interface ComposerSnippetContext {
  now?: Date
  topicId?: number
  postNumber?: number
  username?: string
  quotedRaw?: string
}

export interface ComposerValidationInput {
  mode: 'create' | 'reply' | 'edit'
  title: string
  raw: string
}

export interface ComposerValidation {
  canSubmit: boolean
  titleCount: number
  bodyCount: number
  titleRemaining: number
  bodyRemaining: number
}

export interface ComposerDraftInput {
  mode: 'create' | 'reply' | 'edit'
  title: string
  raw: string
  categoryId?: number
  tags: string[]
  postId?: number
  replyToPostNumber?: number
}

const TITLE_MIN = 6
const BODY_MIN = 20

function clampSelection(raw: string, selection: ComposerSelection): ComposerSelection {
  const start = Math.max(0, Math.min(raw.length, selection.start))
  const end = Math.max(start, Math.min(raw.length, selection.end))
  return { start, end }
}

function replaceSelection(
  raw: string,
  selection: ComposerSelection,
  replacement: string,
  selectedStart = 0,
  selectedEnd = replacement.length,
): ComposerEdit {
  const range = clampSelection(raw, selection)
  return {
    value: raw.slice(0, range.start) + replacement + raw.slice(range.end),
    selection: {
      start: range.start + selectedStart,
      end: range.start + selectedEnd,
    },
  }
}

function wrap(
  raw: string,
  selection: ComposerSelection,
  prefix: string,
  suffix: string,
  placeholder: string,
): ComposerEdit {
  const range = clampSelection(raw, selection)
  const selected = raw.slice(range.start, range.end) || placeholder
  return replaceSelection(raw, range, prefix + selected + suffix, prefix.length, prefix.length + selected.length)
}

function prefixLines(raw: string, selection: ComposerSelection, prefix: (index: number) => string): ComposerEdit {
  const range = clampSelection(raw, selection)
  const lineStart = raw.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1
  const nextLine = raw.indexOf('\n', range.end)
  const lineEnd = nextLine === -1 ? raw.length : nextLine
  const source = raw.slice(lineStart, lineEnd) || '列表项'
  const lines = source.split('\n')
  const prefixes = lines.map((_, index) => prefix(index))
  const replacement = lines.map((line, index) => prefixes[index] + line).join('\n')
  return {
    value: raw.slice(0, lineStart) + replacement + raw.slice(lineEnd),
    selection: {
      start: lineStart + prefixes[0].length,
      end: lineStart + replacement.length,
    },
  }
}

export function applyComposerCommand(
  raw: string,
  selection: ComposerSelection,
  command: ComposerCommand,
): ComposerEdit {
  if (command === 'heading') return prefixLines(raw, selection, () => '## ')
  if (command === 'quote') return prefixLines(raw, selection, () => '> ')
  if (command === 'bullet-list') return prefixLines(raw, selection, () => '- ')
  if (command === 'ordered-list') return prefixLines(raw, selection, (index) => `${index + 1}. `)
  if (command === 'bold') return wrap(raw, selection, '**', '**', '粗体文字')
  if (command === 'italic') return wrap(raw, selection, '_', '_', '斜体文字')
  if (command === 'strike') return wrap(raw, selection, '~~', '~~', '删除文字')
  if (command === 'code') return wrap(raw, selection, '`', '`', '代码')

  const range = clampSelection(raw, selection)
  const label = raw.slice(range.start, range.end) || '链接文字'
  const replacement = `[${label}](https://)`
  const urlStart = replacement.indexOf('https://')
  return replaceSelection(raw, range, replacement, urlStart, urlStart + 'https://'.length)
}

function dateTimeSnippet(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `[date=${value.year}-${value.month}-${value.day} time=${value.hour}:${value.minute}:${value.second} timezone="Asia/Shanghai"]`
}

function snippet(kind: ComposerSnippetKind, context: ComposerSnippetContext): { source: string; marker: string } {
  if (kind === 'quote-post') {
    const quoted = context.quotedRaw?.trim() || '引用内容'
    if (context.topicId && context.postNumber && context.username) {
      return {
        source: `[quote="${context.username}, post:${context.postNumber}, topic:${context.topicId}"]\n${quoted}\n[/quote]`,
        marker: quoted,
      }
    }
    return { source: `> ${quoted.replace(/\n/g, '\n> ')}`, marker: quoted }
  }

  const snippets: Record<Exclude<ComposerSnippetKind, 'quote-post' | 'datetime'>, { source: string; marker: string }> = {
    preformatted: { source: '```text\n预格式化文本\n```', marker: '预格式化文本' },
    table: { source: '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n| 内容 | 内容 | 内容 |', marker: '列 1' },
    toc: { source: '<div data-theme-toc="true"></div>', marker: '<div data-theme-toc="true"></div>' },
    scrolling: { source: '[wrap=scroll]\n滚动内容\n[/wrap]', marker: '滚动内容' },
    mermaid: { source: '```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```', marker: 'graph TD' },
    chart: { source: '[chart type="bar" title="示例图表" xAxisTitle="项目"]\n项目 | 数量\n项目 A | 12\n项目 B | 18\n[/chart]', marker: '示例图表' },
    details: { source: '[details="摘要"]\n详细内容\n[/details]', marker: '详细内容' },
    graphviz: { source: '[graphviz engine=dot]\ndigraph G {\n  A -> B;\n}\n[/graphviz]', marker: 'digraph G' },
    math: { source: '$$\nE = mc^2\n$$', marker: 'E = mc^2' },
    footnote: { source: '这里需要一条脚注[^1]。\n\n[^1]: 脚注内容', marker: '脚注内容' },
    spoiler: { source: '[spoiler]需要隐藏的内容[/spoiler]', marker: '需要隐藏的内容' },
    poll: { source: '[poll type=regular results=always public=true chartType=bar]\n* 选项 1\n* 选项 2\n[/poll]', marker: '选项 1' },
    'line-break': { source: '<br>', marker: '<br>' },
  }
  if (kind === 'datetime') {
    const source = dateTimeSnippet(context.now ?? new Date())
    return { source, marker: source }
  }
  return snippets[kind]
}

export function insertComposerSnippet(
  raw: string,
  selection: ComposerSelection,
  kind: ComposerSnippetKind,
  context: ComposerSnippetContext = {},
): ComposerEdit {
  const range = clampSelection(raw, selection)
  const item = snippet(kind, context)
  const before = raw.slice(0, range.start)
  const after = raw.slice(range.end)
  const leading = before && !before.endsWith('\n') ? '\n\n' : ''
  const trailing = after && !after.startsWith('\n') ? '\n\n' : ''
  const replacement = leading + item.source + trailing
  const markerStart = replacement.indexOf(item.marker)
  return replaceSelection(
    raw,
    range,
    replacement,
    Math.max(0, markerStart),
    Math.max(0, markerStart) + item.marker.length,
  )
}

export function insertComposerText(raw: string, selection: ComposerSelection, text: string): ComposerEdit {
  return replaceSelection(raw, selection, text, text.length, text.length)
}

export function insertComposerBlock(raw: string, selection: ComposerSelection, text: string): ComposerEdit {
  const range = clampSelection(raw, selection)
  const block = text.trimEnd()
  const before = raw.slice(0, range.start)
  const after = raw.slice(range.end)
  const leading = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trailing = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  const replacement = leading + block + trailing
  const caret = leading.length + block.length
  return replaceSelection(raw, range, replacement, caret, caret)
}

export function normalizeComposerTag(value: string): string {
  return value
    .trim()
    .replace(/^#+/, '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s_]+/g, '-')
    .replace(/[/?#[\]@!$&'()*+,;=%\\`^|{}"<>]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function characterCount(value: string): number {
  return Array.from(value.trim()).length
}

export function validateComposer(input: ComposerValidationInput): ComposerValidation {
  const titleCount = characterCount(input.title)
  const bodyCount = characterCount(input.raw)
  const titleRemaining = input.mode === 'create' ? Math.max(0, TITLE_MIN - titleCount) : 0
  const bodyRemaining = Math.max(0, BODY_MIN - bodyCount)
  return {
    canSubmit: titleRemaining === 0 && bodyRemaining === 0,
    titleCount,
    bodyCount,
    titleRemaining,
    bodyRemaining,
  }
}

export function buildComposerDraftData(input: ComposerDraftInput): LinuxDoDraftData {
  const creatingTopic = input.mode === 'create'
  return {
    reply: input.raw,
    action: input.mode === 'create' ? 'createTopic' : input.mode,
    title: creatingTopic ? input.title : undefined,
    categoryId: creatingTopic ? input.categoryId : undefined,
    tags: creatingTopic ? input.tags : undefined,
    postId: input.postId,
    reply_to_post_number: input.replyToPostNumber,
  }
}
