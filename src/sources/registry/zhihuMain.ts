import type { NewsSource } from './model'

/** Authenticated Zhihu main-site feed. Transport is handled by features/zhihu. */
export const ZHIHU_MAIN_SOURCE: NewsSource = {
  id: 'zhihu-main',
  name: '知乎',
  label: '知乎',
  group: 'special',
  kind: 'zhihu-main',
  url: 'https://www.zhihu.com/api/v3/feed/topstory/recommend?desktop=true&limit=20',
  siteUrl: 'https://www.zhihu.com/',
  enabled: false,
}
