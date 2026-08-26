import type { ProxyMode, ProxyPrefs, ProxyProtocol } from './types.ts'

export const DEFAULT_PROXY_PREFS: ProxyPrefs = {
  mode: 'auto',
  proxyUrl: '',
  customBypassDomains: [],
  customProxyDomains: [],
}

/** 默认判定为需要代理的国际媒体与海外科技服务域名 */
export const DEFAULT_INTERNATIONAL_DOMAINS = [
  'bbci.co.uk',
  'bbc.co.uk',
  'bbc.com',
  'dw.com',
  'scmp.com',
  'theguardian.com',
  'npr.org',
  'france24.com',
  'aljazeera.com',
  'news.google.com',
  'google.com',
  'googleapis.com',
  'translate.goog',
  'arstechnica.com',
  'technologyreview.com',
  'theverge.com',
  'techcrunch.com',
  'wired.com',
  'ycombinator.com',
  'hnrss.org',
  'openai.com',
  'deepmind.google',
  'huggingface.co',
  'pytorch.org',
  'marktechpost.com',
  'lastweekin.ai',
  'jack-clark.net',
  'sebastianraschka.com',
  'lilianweng.github.io',
  'simonwillison.net',
  'interconnects.ai',
  'arena.ai',
  'anthropic.com',
  'claude.com',
  'nytimes.com',
  'reuters.com',
  'bloomberg.com',
  'wsj.com',
  'washingtonpost.com',
  'cnn.com',
  'economist.com',
  'apnews.com',
] as const

/** 默认判定为国际源的注册 ID 列表 */
export const DEFAULT_INTERNATIONAL_SOURCE_IDS = new Set<string>([
  'bbc-zh',
  'bbc-zh-china',
  'bbc-zh-world',
  'bbc-world',
  'gnews-world',
  'gnews-business',
  'gnews-tech',
  'gnews-sports',
  'gnews-ent',
  'gnews-science',
  'gnews-health',
  'dw-top',
  'scmp-china',
  'scmp-news',
  'npr',
  'guardian-world',
  'france24',
  'aljazeera',
  'arstechnica',
  'mittr',
  'verge',
  'techcrunch',
  'wired',
  'hn',
  'openai-news',
  'google-ai',
  'deepmind',
  'huggingface',
  'pytorch',
  'mittr-ai',
  'verge-ai',
  'ieee-ai',
  'venturebeat-ai',
  'marktechpost',
  'lastweek-ai',
  'import-ai',
  'ahead-of-ai',
  'lil-log',
  'simonw',
  'interconnects',
  'arena',
  'anthropic',
  'claude-blog',
  'claude-customers',
  'claude-academy-use-cases',
  'claude-academy-tutorials',
  'openai-cookbook',
])

export function proxyModeLabel(mode: ProxyMode): string {
  switch (mode) {
    case 'auto':
      return '智能分流'
    case 'always':
      return '全局代理'
    case 'off':
      return '直连关闭'
  }
}

export function proxyProtocolLabel(protocol: ProxyProtocol): string {
  switch (protocol) {
    case 'http':
      return 'HTTP 代理'
    case 'https':
      return 'HTTPS 代理'
    case 'socks5':
    case 'socks5h':
      return 'SOCKS5 代理'
    case 'web':
      return 'Web 反向代理'
    default:
      return '未知类型'
  }
}

export function normalizeProxyPrefs(raw: unknown): ProxyPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PROXY_PREFS
  const input = raw as Partial<ProxyPrefs>
  const mode: ProxyMode =
    input.mode === 'always' || input.mode === 'off' || input.mode === 'auto'
      ? input.mode
      : DEFAULT_PROXY_PREFS.mode

  const proxyUrl = typeof input.proxyUrl === 'string' ? input.proxyUrl.trim() : ''

  const customBypassDomains = Array.isArray(input.customBypassDomains)
    ? input.customBypassDomains
        .filter((d): d is string => typeof d === 'string' && Boolean(d.trim()))
        .map((d) => d.trim().toLowerCase())
    : []

  const customProxyDomains = Array.isArray(input.customProxyDomains)
    ? input.customProxyDomains
        .filter((d): d is string => typeof d === 'string' && Boolean(d.trim()))
        .map((d) => d.trim().toLowerCase())
    : []

  return {
    mode,
    proxyUrl,
    customBypassDomains: [...new Set(customBypassDomains)],
    customProxyDomains: [...new Set(customProxyDomains)],
  }
}
