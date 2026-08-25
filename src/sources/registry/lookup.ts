/**
 * 源查找与自定义源工具：按 id 查源、代理路径、UA 选择、
 * 自建源 id 生成与公众号合集链接归一。
 */

import { md5Hex } from '../../lib/hash'
import { BROWSER_UA, CATALOG_PAGE_SIZE, type NewsSource } from './model'
import { SOURCES } from './builtinSources'

/** 公众号公开合集（appmsgalbum）分享链接；biz 参数有 __biz / biz 两种写法 */
export function isWechatAlbumUrl(url: string): boolean {
  try {
    const parsed = new URL(url.trim())
    if (parsed.hostname !== 'mp.weixin.qq.com') return false
    if (!parsed.pathname.startsWith('/mp/appmsgalbum')) return false
    const biz = parsed.searchParams.get('__biz') || parsed.searchParams.get('biz')
    return Boolean(biz && parsed.searchParams.get('album_id'))
  } catch {
    return false
  }
}

/**
 * 公众号合集链接归一成 JSON 列表入口：
 * 去掉分享参数与 #wechat_redirect，补 f=json / count，保证列表请求拿到结构化数据。
 */
export function normalizeWechatAlbumUrl(url: string): string {
  if (!isWechatAlbumUrl(url)) return url
  const parsed = new URL(url.trim())
  const biz = parsed.searchParams.get('__biz') || parsed.searchParams.get('biz') || ''
  const albumId = parsed.searchParams.get('album_id') || ''
  const search = new URLSearchParams({
    action: 'getalbum',
    __biz: biz,
    album_id: albumId,
    count: String(CATALOG_PAGE_SIZE),
    f: 'json',
  })
  return `https://mp.weixin.qq.com/mp/appmsgalbum?${search.toString()}`
}

export function proxyPathFor(id: string): string {
  return `/api/feed/${id}`
}

export function userAgentFor(source: NewsSource): string {
  return source.userAgent ?? BROWSER_UA
}

export function makeCustomSourceId(url: string): string {
  const clean = url.trim().toLowerCase().replace(/\/+$/, '')
  return `custom_${md5Hex(clean).slice(0, 10)}`
}

export function isCustomSourceId(id: string): boolean {
  return id.startsWith('custom_')
}

export function findSource(id: string, extraSources?: NewsSource[]): NewsSource | undefined {
  if (extraSources?.length) {
    const extra = extraSources.find((s) => s.id === id)
    if (extra) return extra
  }
  return SOURCES.find((s) => s.id === id)
}
