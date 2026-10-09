import { decodeTagNames } from '../api/decode'
import { linuxDoEndpoints } from '../api/endpoints'
import type { LinuxDoApiClient } from '../api/client'

export interface LinuxDoComposerTemplate {
  id: number
  title: string
  slug: string
  content: string
  tags: string[]
  usages: number
}

export type LinuxDoTemplateVariableKey =
  | 'my_username'
  | 'my_name'
  | 'chat_channel_name'
  | 'chat_channel_url'
  | 'chat_thread_name'
  | 'chat_thread_url'
  | 'context_title'
  | 'context_url'
  | 'topic_title'
  | 'topic_url'
  | 'original_poster_username'
  | 'original_poster_name'
  | 'reply_to_username'
  | 'reply_to_name'
  | 'last_poster_username'
  | 'reply_to_or_last_poster_username'

export type LinuxDoTemplateVariables = Partial<Record<LinuxDoTemplateVariableKey, string>>

export interface LinuxDoResolvedTemplate {
  title: string
  content: string
}

const ALLOWED_VARIABLES: readonly LinuxDoTemplateVariableKey[] = [
  'my_username',
  'my_name',
  'chat_channel_name',
  'chat_channel_url',
  'chat_thread_name',
  'chat_thread_url',
  'context_title',
  'context_url',
  'topic_title',
  'topic_url',
  'original_poster_username',
  'original_poster_name',
  'reply_to_username',
  'reply_to_name',
  'last_poster_username',
  'reply_to_or_last_poster_username',
]

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return 0
}

function decodeTemplate(value: unknown): LinuxDoComposerTemplate | undefined {
  const item = value as Record<string, unknown> | undefined
  const id = typeof item?.id === 'number' ? item.id : Number(item?.id)
  if (!Number.isFinite(id) || id <= 0) return undefined
  const title = typeof item?.title === 'string' ? item.title.trim() : ''
  const content = typeof item?.content === 'string' ? item.content : ''
  if (!title || !content) return undefined
  return {
    id,
    title,
    slug: typeof item?.slug === 'string' && item.slug ? item.slug : 'topic',
    content,
    tags: decodeTagNames(item?.tags),
    usages: numberValue(item?.usages),
  }
}

export function filterLinuxDoTemplates(
  templates: LinuxDoComposerTemplate[],
  query: string,
  selectedTag: string,
): LinuxDoComposerTemplate[] {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return templates
    .map((template) => {
      let score = 2
      if (needle) {
        const title = template.title.toLocaleLowerCase('zh-CN')
        const content = template.content.toLocaleLowerCase('zh-CN')
        score = title.includes(needle) ? 2 : content.includes(needle) ? 1 : 0
      }
      return { template, score }
    })
    .filter(({ template, score }) => {
      if (!score) return false
      if (selectedTag === '*') return true
      if (selectedTag === '__none__') return template.tags.length === 0
      return template.tags.includes(selectedTag)
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.template.usages !== right.template.usages) return right.template.usages - left.template.usages
      return left.template.title.localeCompare(right.template.title, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
    .map(({ template }) => template)
}

export function collectLinuxDoTemplateTags(templates: LinuxDoComposerTemplate[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const template of templates) {
    for (const tag of template.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base' }))
}

function replaceInText(input: string, variables: LinuxDoTemplateVariables): string {
  let output = input
  for (const key of ALLOWED_VARIABLES) {
    const value = variables[key]?.trim()
    if (value) {
      output = output.replace(new RegExp('%\\{' + key + '(?:,fallback:[^}]*)?\\}', 'g'), () => value)
      continue
    }
    output = output.replace(new RegExp('%\\{' + key + ',fallback:([^}]*)\\}', 'g'), '$1')
    output = output.replace(new RegExp('%\\{' + key + '\\}', 'g'), '')
  }
  return output
}

export function resolveLinuxDoTemplate(
  template: Pick<LinuxDoComposerTemplate, 'title' | 'content'>,
  variables: LinuxDoTemplateVariables,
): LinuxDoResolvedTemplate {
  return {
    title: replaceInText(template.title, variables),
    content: replaceInText(template.content, variables),
  }
}

export class LinuxDoTemplateService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(options: { signal?: AbortSignal } = {}): Promise<LinuxDoComposerTemplate[]> {
    const payload = await this.api.getJson<{ templates?: unknown[] }>(linuxDoEndpoints.templates, {
      auth: 'required',
      signal: options.signal,
    })
    return (Array.isArray(payload?.templates) ? payload.templates : [])
      .map(decodeTemplate)
      .filter((template): template is LinuxDoComposerTemplate => Boolean(template))
  }

  async recordUse(templateId: number): Promise<void> {
    await this.api.postForm(linuxDoEndpoints.templateUse(templateId), {}, { auth: 'required' })
  }
}
