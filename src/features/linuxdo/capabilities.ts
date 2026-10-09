import type { LinuxDoCapabilities } from './types'

/** Linux.do uses the official discourse-boosts plugin contract. */
export function linuxDoCapabilities(): LinuxDoCapabilities {
  return {
    boost: {
      available: true,
      endpoint: '/discourse-boosts/posts/:post_id/boosts.json',
    },
    drafts: true,
    uploads: true,
    bookmarks: true,
  }
}
