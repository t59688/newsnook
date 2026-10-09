import type { SiteDescriptor, SiteId } from '../../features/sites/types'

/**
 * 独立站点工作区注册表。
 * 与 SOURCES 分开：站点入口描述 UI/adapter，NewsSource 只负责公共 Article 桥接。
 */
export const SITES: readonly SiteDescriptor[] = [
  {
    id: 'zhihu',
    name: '知乎',
    description: '推荐、热榜、问题与回答的专属阅读工作区',
    origin: 'https://www.zhihu.com',
    adapterId: 'zhihu',
    sourceId: 'zhihu-community',
    capabilities: {
      publicRead: true,
      // 只有 source-only 协议证据，尚未完成 NewsNook 授权账号实网闭环。
      authenticated: false,
    },
  },
  {
    id: 'linuxdo',
    name: 'Linux.do',
    description: 'Discourse 社区专属工作区 · 信息流、主题、分类、标签与互动',
    origin: 'https://linux.do',
    adapterId: 'linuxdo',
    capabilities: {
      publicRead: true,
      authenticated: true,
    },
  },
] as const

export function findSite(id: string | null | undefined): SiteDescriptor | undefined {
  return SITES.find((site) => site.id === id)
}

export function isSiteId(id: string | null | undefined): id is SiteId {
  return Boolean(findSite(id))
}
