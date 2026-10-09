import { linuxDoEndpoints } from '../api/endpoints'
import { decodeTopics } from '../api/decode'
import type { LinuxDoApiClient } from '../api/client'
import type { LinuxDoFeedMode, LinuxDoTopicPage } from '../types'

const AUTH_REQUIRED_MODES = new Set<LinuxDoFeedMode>(['new', 'unread', 'posted', 'read', 'bookmarks'])

export class LinuxDoFeedService {
  private readonly api: LinuxDoApiClient

  constructor(api: LinuxDoApiClient) {
    this.api = api
  }

  async list(mode: LinuxDoFeedMode, page = 0): Promise<LinuxDoTopicPage> {
    const url =
      mode === 'latest'
        ? linuxDoEndpoints.latest(page)
        : mode === 'hot'
          ? linuxDoEndpoints.hot(page)
          : mode === 'top'
            ? linuxDoEndpoints.top(page)
            : mode === 'new'
              ? linuxDoEndpoints.newTopics(page)
              : mode === 'unread'
                ? linuxDoEndpoints.unread(page)
                : mode === 'posted'
                  ? linuxDoEndpoints.posted(page)
                  : mode === 'read'
                    ? linuxDoEndpoints.read(page)
                    : linuxDoEndpoints.bookmarkedTopics(page)

    const payload = await this.api.getJson<any>(url, {
      auth: AUTH_REQUIRED_MODES.has(mode) ? 'required' : 'optional',
    })
    return {
      items: decodeTopics(payload),
      hasMore: typeof payload?.topic_list?.more_topics_url === 'string' && payload.topic_list.more_topics_url.length > 0,
    }
  }
}
