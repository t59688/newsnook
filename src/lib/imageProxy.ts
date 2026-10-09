const NETEASE_HOST_RE = /(?:^|\.)(?:126\.net|163\.com|netease\.com)$/i
const WECHAT_IMAGE_HOST_RE = /(?:^|\.)(?:mmbiz\.qpic\.cn|mmecoa\.qpic\.cn|qlogo\.cn)$/i
const BILIBILI_IMAGE_HOST_RE = /(?:^|\.)hdslb\.com$/i

function httpUrl(raw: string): URL | null {
  try {
    const value = raw.trim()
    const parsed = new URL(value.startsWith('//') ? `https:${value}` : value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
  } catch {
    return null
  }
}

export function isNeteaseImageUrl(raw: string): boolean {
  const parsed = httpUrl(raw)
  return Boolean(parsed && NETEASE_HOST_RE.test(parsed.hostname))
}

/** 网易列表接口仍会返回 http 图链；统一升级，避免 HTTPS WebView 的混合内容拦截。 */
export function normalizeListImageUrl(raw: string): string {
  const parsed = httpUrl(raw)
  if (!parsed) return raw
  if (parsed.protocol === 'http:' && NETEASE_HOST_RE.test(parsed.hostname)) {
    parsed.protocol = 'https:'
  }
  return parsed.href
}

export function imageProxyUrl(raw: string): string {
  return `/api/image?url=${encodeURIComponent(normalizeListImageUrl(raw))}`
}

/** Web 对已知必拦直链的网易图片直接代理；其他图床保留客户端直连，失败后再代理。 */
export function initialListImageUrl(raw: string, native: boolean): string {
  const normalized = normalizeListImageUrl(raw)
  return !native && isNeteaseImageUrl(normalized) ? imageProxyUrl(normalized) : normalized
}

/** 原生 HTTP 重试时复刻源站所需的防盗链来源。微信图床必须不带 Referer。 */
export function imageReferer(raw: string): string | undefined {
  const parsed = httpUrl(raw)
  if (!parsed) return undefined
  if (NETEASE_HOST_RE.test(parsed.hostname)) return 'https://www.163.com/'
  if (WECHAT_IMAGE_HOST_RE.test(parsed.hostname)) return undefined
  if (BILIBILI_IMAGE_HOST_RE.test(parsed.hostname)) return 'https://www.bilibili.com/'
  if (/(?:^|\.)zhimg\.com$/i.test(parsed.hostname)) return 'https://www.zhihu.com/'
  return `${parsed.origin}/`
}
