import { linuxDoEndpoints } from '../api/endpoints'
import { decodeCategories, decodeTagNames, decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoCategory, LinuxDoTag, LinuxDoTopicOrder, LinuxDoTopicPage } from '../types'

export interface LinuxDoTagSearchOptions {
  limit?: number
  categoryId?: number
  selectedTagIds?: Array<string | number>
  selectedTags?: string[]
  forInput?: boolean
  prioritizeRecentTags?: boolean
}

function tagKey(name: string): string {
  return name.trim().toLocaleLowerCase('zh-CN')
}

function countValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

export function sortLinuxDoTags(tags: LinuxDoTag[]): LinuxDoTag[] {
  return [...tags].sort((left, right) => {
    if (Boolean(left.disabled) !== Boolean(right.disabled)) return left.disabled ? 1 : -1
    const byCount = (right.topicCount ?? -1) - (left.topicCount ?? -1)
    if (byCount !== 0) return byCount
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
  })
}

export class LinuxDoDiscoveryService {
  private readonly api: LinuxDoApiClient
  private readonly tagCatalog = new Map<string, LinuxDoTag>()

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async categories(): Promise<LinuxDoCategory[]> {
    return decodeCategories(await this.api.getJson(linuxDoEndpoints.categories, { auth: 'optional' }))
  }

  async category(slug: string, id: number, page = 0, order: LinuxDoTopicOrder = 'activity'): Promise<LinuxDoTopicPage> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.category(slug, id, page, order), { auth: 'optional' })
    return this.decodeTopicPage(payload)
  }

  async tags(): Promise<LinuxDoTag[]> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.tags, { auth: 'optional' })
    const extras = payload?.extras
    const values: unknown[] = []

    if (Array.isArray(payload?.tags)) values.push(...payload.tags)
    for (const group of Array.isArray(extras?.tag_groups) ? extras.tag_groups : []) {
      if (Array.isArray(group?.tags)) values.push(...group.tags)
    }
    for (const category of Array.isArray(extras?.categories) ? extras.categories : []) {
      if (Array.isArray(category?.tags)) values.push(...category.tags)
    }

    const tags = sortLinuxDoTags(this.decodeTags(values))
    this.tagCatalog.clear()
    this.rememberCatalog(tags)
    return tags
  }

  async searchTags(query: string, options: LinuxDoTagSearchOptions = {}, signal?: AbortSignal): Promise<LinuxDoTag[]> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.tagSearch(query, options), { auth: 'optional', signal })
    if (!Array.isArray(payload?.results)) throw new Error('Linux.do 返回了无法识别的标签数据')
    const results = this.decodeTags(payload?.results).map((tag) => this.enrichFromCatalog(tag))
    if (!query.trim() && options.prioritizeRecentTags) return results
    return sortLinuxDoTags(results)
  }

  async tag(name: string, page = 0, order: LinuxDoTopicOrder = 'activity'): Promise<LinuxDoTopicPage> {
    const payload = await this.api.getJson<any>(linuxDoEndpoints.tag(name, page, order), { auth: 'optional' })
    return this.decodeTopicPage(payload)
  }

  private decodeTopicPage(payload: any): LinuxDoTopicPage {
    const items = decodeTopics(payload)
    const moreTopicsUrl = payload?.topic_list?.more_topics_url
    return {
      items,
      hasMore: typeof moreTopicsUrl === 'string' && moreTopicsUrl.length > 0,
    }
  }

  private rememberCatalog(tags: LinuxDoTag[]): void {
    for (const tag of tags) this.tagCatalog.set(tagKey(tag.name), tag)
  }

  private enrichFromCatalog(tag: LinuxDoTag): LinuxDoTag {
    const catalog = this.tagCatalog.get(tagKey(tag.name))
    if (!catalog) return tag
    return {
      ...tag,
      id: tag.id ?? catalog.id,
      topicCount: tag.topicCount ?? catalog.topicCount,
    }
  }

  private decodeTags(value: unknown): LinuxDoTag[] {
    if (!Array.isArray(value)) return []
    const deduped = new Map<string, LinuxDoTag>()

    for (const raw of value) {
      const tag = raw as any
      const name = decodeTagNames([raw])[0] ?? ''
      if (!name) continue
      const next: LinuxDoTag = {
        id: typeof tag?.id === 'string' || typeof tag?.id === 'number' ? tag.id : undefined,
        name,
        topicCount: countValue(tag?.count ?? tag?.topic_count ?? tag?.public_topic_count),
        disabled: Boolean(tag?.disabled),
        disabledReason: typeof tag?.title === 'string' ? tag.title : undefined,
      }

      const key = tagKey(name)
      const previous = deduped.get(key)
      if (!previous) {
        deduped.set(key, next)
        continue
      }

      const previousCount = previous.topicCount
      const nextCount = next.topicCount
      deduped.set(key, {
        ...previous,
        id: previous.id ?? next.id,
        topicCount: previousCount === undefined
          ? nextCount
          : nextCount === undefined
            ? previousCount
            : Math.max(previousCount, nextCount),
        disabled: Boolean(previous.disabled && next.disabled),
        disabledReason: previous.disabledReason ?? next.disabledReason,
      })
    }

    return Array.from(deduped.values())
  }
}
