import type { FrameworkId } from '../frameworkDetect/types'
import type { Article } from '../../lib/types'

export interface SiteFrameworkInfo {
  name: string
  categoryBadge: string
  isVideo: boolean
  badgeClass: string
}


/**
 * 提取干净优雅的站点展示域名（如 xiangguys.com）
 */
export function getSiteCleanDomain(rawUrl?: string): string {
  if (!rawUrl) return ''
  try {
    const url = new URL(rawUrl)
    return url.hostname.replace(/^www\./i, '')
  } catch {
    return rawUrl.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').replace(/\/.*$/, '')
  }
}

/**
 * 智能格式化站点展示名称，彻底规避 www. 或 4位截断碎片（如 huar）
 */
export function formatSiteDisplayName(
  source?: { name?: string; label?: string; url?: string } | null,
): string {
  if (!source) return 'CMS 站点'
  const name = (source.name || '').trim()
  const label = (source.label || '').trim()
  const domain = getSiteCleanDomain(source.url)

  // 1. 如果 label 是明确的中文或非截断名称，且不是 'www.' / '目录'
  const isLabelTruncated =
    label.toLowerCase() === 'www.' ||
    label === '目录' ||
    (name.length > label.length &&
      name.toLowerCase().startsWith(label.toLowerCase()) &&
      label.length <= 4)

  if (label && !isLabelTruncated) {
    return label
  }

  // 2. 检查 name
  if (name) {
    const cleaned = name.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '')
    if (cleaned && cleaned.toLowerCase() !== 'www.') {
      // 如果去掉了 www. 之后是域名形式，例如 xiangguys.com，如果首字母是英文，返回干净域名
      return cleaned
    }
  }

  // 3. Fallback 到纯净域名
  if (domain && domain.toLowerCase() !== 'www.') {
    return domain
  }

  return label || name || 'CMS 站点'
}

/**
 * 格式化站点品牌展示名称：去除常见顶级域名后缀并优雅首字母大写（如 huarenok.com -> Huarenok, xiangguys.com -> Xiangguys）
 */
export function formatSiteBrandName(
  source?: { name?: string; label?: string; url?: string } | null,
): string {
  const full = formatSiteDisplayName(source)
  // 如果已包含中文字符，直接返回中文名称
  if (/[\u4e00-\u9fa5]/.test(full)) return full

  // 去除常见域名后缀
  const base = full.replace(
    /\.(?:com|net|org|cn|cc|tv|me|io|xyz|app|top|site|vip|club|co|la|pro|so|in)$/i,
    '',
  )
  if (base.length >= 2) {
    return base.charAt(0).toUpperCase() + base.slice(1)
  }
  return full
}

/**
 * 获取站点框架元信息与分类标签
 */
export function getSiteFrameworkInfo(framework?: FrameworkId | string): SiteFrameworkInfo {
  const fw = (framework || '').toLowerCase()
  switch (fw) {
    case 'maccms':
      return { name: '苹果CMS', categoryBadge: '影视', isVideo: true, badgeClass: 'text-amber-500 bg-amber-500/10 border-amber-500/20' }
    case 'seacms':
      return { name: '海洋CMS', categoryBadge: '影视', isVideo: true, badgeClass: 'text-blue-500 bg-blue-500/10 border-blue-500/20' }
    case 'fyfcms':
      return { name: '飞飞CMS', categoryBadge: '影视', isVideo: true, badgeClass: 'text-rose-500 bg-rose-500/10 border-rose-500/20' }
    case 'zanpian':
      return { name: '赞片CMS', categoryBadge: '影视', isVideo: true, badgeClass: 'text-orange-500 bg-orange-500/10 border-orange-500/20' }
    case 'nnyy':
      return { name: '影院', categoryBadge: '影视', isVideo: true, badgeClass: 'text-red-500 bg-red-500/10 border-red-500/20' }
    case 'wordpress':
      return { name: 'WordPress', categoryBadge: '文章', isVideo: false, badgeClass: 'text-sky-500 bg-sky-500/10 border-sky-500/20' }
    case 'typecho':
      return { name: 'Typecho', categoryBadge: '博客', isVideo: false, badgeClass: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' }
    case 'dedecms':
      return { name: '织梦CMS', categoryBadge: '资讯', isVideo: false, badgeClass: 'text-teal-500 bg-teal-500/10 border-teal-500/20' }
    case 'discuz':
      return { name: 'Discuz!', categoryBadge: '社区', isVideo: false, badgeClass: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20' }
    default:
      return { name: 'Web 目录', categoryBadge: '目录', isVideo: false, badgeClass: 'text-paper-muted bg-paper/8 border-haze' }
  }
}

/**
 * 判断文章是否具有影视/海报特性
 */
export function isLikelyVideoArticle(article: Article, isVideoSite?: boolean): boolean {
  if (article.contentType === 'video') return true
  if (isVideoSite) return true
  const title = article.title || ''
  // 匹配诸如 (1994)、[2023]、第12集、HD、4K、中字、电影、动漫等特征
  if (/\((?:19|20)\d\d\)|\b(?:19|20)\d\d年\b/i.test(title)) return true
  if (/第[0-9一二三四五六七八九十]+[季期集话]|更新至|完结|全集|蓝光|超清|高清|TC|HD|BD|4K|1080P/i.test(title)) return true
  return false
}

/**
 * 解析海报标题中的附加元信息（年份、画质/集数/季数等微标）
 */
export function parseArticlePosterMeta(title: string): {
  cleanTitle: string
  year?: string
  badge?: string
} {
  let cleanTitle = (title || '').trim()
  let year: string | undefined
  let badge: string | undefined

  // 1. 提取年份：例如 (1994)、[2023]、【2024】、2024年 等
  const yearMatch = cleanTitle.match(/(?:[([（【])((?:19|20)\d{2})(?:[)\]）】])|(?:\b((?:19|20)\d{2})年\b)/)
  if (yearMatch) {
    year = yearMatch[1] || yearMatch[2]
    cleanTitle = cleanTitle.replace(yearMatch[0], '').trim()
  }

  // 2. 提取集数/画质/季数/更新状态等微标
  const badgeMatch = cleanTitle.match(
    /(?:更新至[0-9]+[集期话]|全[0-9]+[集期话]|第[0-9一二三四五六七八九十]+[季期集话]|完结|4K|1080P|720P|HD|BD|蓝光|超清|高清|国语|中字|抢先版|TC)/i,
  )
  if (badgeMatch && badgeMatch[0]) {
    badge = badgeMatch[0]
  }

  // 整理标题：去掉收尾破折号、冒号、多余空白
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[-_—:\s/]+|[-_—:\s/]+$/g, '').trim()

  return { cleanTitle: cleanTitle || title, year, badge }
}

/**
 * 稳重大气的原生品牌色彩方案（深度契合 NewsNook 墨砚与朱砂主视觉）
 */
const BRAND_GRADIENTS = [
  'from-cinnabar/90 to-cinnabar',
  'from-stone-700 to-zinc-900',
  'from-indigo-600 to-slate-800',
  'from-amber-600 to-orange-700',
  'from-emerald-600 to-teal-800',
  'from-rose-600 to-red-800',
]

export function getSiteAvatarMeta(seed: string): {
  gradientClass: string
  letter: string
} {
  const cleanSeed = (seed || 'Site').trim()
  let hash = 0
  for (let i = 0; i < cleanSeed.length; i++) {
    hash = (hash << 5) - hash + cleanSeed.charCodeAt(i)
    hash |= 0
  }
  const index = Math.abs(hash) % BRAND_GRADIENTS.length
  const gradientClass = BRAND_GRADIENTS[index]!

  // 提取有效首字母或首汉字
  const firstChar = cleanSeed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').charAt(0) || 'S'
  const letter = firstChar.toUpperCase()

  return { gradientClass, letter }
}
