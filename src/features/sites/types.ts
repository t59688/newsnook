export type SiteId = 'zhihu' | 'linuxdo'

export interface SiteDescriptor {
  id: SiteId
  name: string
  description: string
  origin: string
  adapterId: string
  /** 与 NewsSource 的桥接 id；站点本身不是普通综合流信源。 */
  sourceId?: string
  capabilities: {
    publicRead: boolean
    authenticated: boolean
  }
}
