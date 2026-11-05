/**
 * Conservative content-link -> subscription-target discovery.
 *
 * Only identities encoded in the URL or explicit author metadata are trusted.
 * A content id (BV/answer/status id) must never be treated as a creator id.
 * This layer resolves identities; it never fetches or saves subscriptions.
 */
import { twitterProfileRssHubRoute, TWITTER_RESERVED_PATHS } from '../rsshub/twitter'

export interface ContentSubscriptionTarget {
  profileUrl: string
  routePath?: string
  title: string
  entity: 'publisher' | 'channel'
  source: 'post' | 'profile'
}

type ContentLinkResolver = (url: URL) => ContentSubscriptionTarget | null

const WEIBO_HOSTS = new Set(['weibo.com', 'www.weibo.com', 'm.weibo.cn'])
const TWITTER_HOSTS = new Set(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'])
const UID = /^\d{6,20}$/
const WEIBO_BID = /^[a-z\d]{7,20}$/i
const X_HANDLE = /^[A-Za-z\d_]{1,15}$/
const X_STATUS = /^\d{6,25}$/

function weiboTarget(url: URL): ContentSubscriptionTarget | null {
  if (!WEIBO_HOSTS.has(url.hostname.toLowerCase())) return null
  const segments = url.pathname.split('/').filter(Boolean)
  let uid: string | undefined
  let source: ContentSubscriptionTarget['source'] = 'profile'
  if (segments.length === 2 && ['u', 'profile'].includes(segments[0]) && UID.test(segments[1])) {
    uid = segments[1]
  } else if (segments.length === 1 && UID.test(segments[0])) {
    uid = segments[0]
  } else if (segments.length === 2 && UID.test(segments[0]) && WEIBO_BID.test(segments[1])) {
    uid = segments[0]
    source = 'post'
  }
  if (!uid) return null
  return {
    profileUrl: 'https://weibo.com/u/' + uid,
    routePath: '/weibo/user/' + uid,
    title: '微博博主 · ' + uid,
    entity: 'publisher',
    source,
  }
}

function twitterTarget(url: URL): ContentSubscriptionTarget | null {
  if (!TWITTER_HOSTS.has(url.hostname.toLowerCase())) return null
  const profile = twitterProfileRssHubRoute(url.toString())
  if (profile) return {
    profileUrl: 'https://x.com/' + profile.handle,
    routePath: profile.routePath,
    title: 'X / Twitter · @' + profile.handle,
    entity: 'publisher', source: 'profile',
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if (!(parts.length === 3 || parts.length === 5) ||
    !X_HANDLE.test(parts[0]) || TWITTER_RESERVED_PATHS.has(parts[0].toLowerCase()) ||
    parts[1] !== 'status' || !X_STATUS.test(parts[2]) ||
    (parts.length === 5 && !(['photo', 'video'].includes(parts[3]) && /^\d{1,2}$/.test(parts[4])))) return null
  const handle = parts[0]
  return {
    profileUrl: 'https://x.com/' + handle,
    routePath: '/twitter/user/' + handle,
    title: 'X / Twitter · @' + handle,
    entity: 'publisher', source: 'post',
  }
}

const CONTENT_LINK_RESOLVERS: readonly ContentLinkResolver[] = [weiboTarget, twitterTarget]

/** Resolve an author from the *actual* URL structure, with no network or guesses. */
export function resolveContentSubscriptionTarget(input: string): ContentSubscriptionTarget | null {
  let url: URL
  try { url = new URL(input) } catch { return null }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null
  for (const resolve of CONTENT_LINK_RESOLVERS) {
    const result = resolve(url)
    if (result) return result
  }
  return null
}

const AUTHOR_FAMILIES: readonly (readonly string[])[] = [
  ['weibo.com', 'weibo.cn'],
  ['x.com', 'twitter.com'],
  ['bilibili.com'],
  ['zhihu.com'],
  ['youtube.com', 'youtu.be'],
]
const MAX_HTML = 512_000
const MAX_AUTHOR_URLS = 3
const MAX_STRUCTURED_SCRIPTS = 8
const MAX_STRUCTURED_SCRIPT = 64_000
const NON_PUBLIC_DOMAIN = /(?:^localhost$|\.(?:localhost|local|internal|test|invalid|example|onion|lan)$)/i
const IP_ADDRESS_HOST = /^(?:\d{1,3}\.){3}\d{1,3}$/
const CONTENT_TYPES = new Set([
  'Article', 'NewsArticle', 'BlogPosting', 'VideoObject', 'SocialMediaPosting',
  'DiscussionForumPosting', 'Answer',
])

function hostFamily(hostname: string): string {
  const host = hostname.toLowerCase()
  for (const sites of AUTHOR_FAMILIES) {
    if (sites.some((site) => host === site || host.endsWith('.' + site))) return sites[0]
  }
  // For unknown websites, do not infer registrable domains using a naive suffix
  // heuristic (e.g. co.uk); trust only the same hostname with optional www.
  return host.replace(/^www\./, '')
}

function collectStructuredAuthors(raw: unknown, add: (candidate: unknown) => void): void {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: raw, depth: 0 }]
  let visited = 0
  while (queue.length && visited++ < 40) {
    const { value, depth } = queue.shift()!
    if (depth > 4 || !value || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, 12).map((item) => ({ value: item, depth: depth + 1 })))
      continue
    }
    const node = value as Record<string, unknown>
    const types = [node['@type']].flat().filter((type): type is string => typeof type === 'string')
    if (types.some((type) => CONTENT_TYPES.has(type.split(/[\/#]/).at(-1) ?? ''))) {
      for (const role of ['author', 'creator']) {
        const author = node[role]
        const people = Array.isArray(author) ? author.slice(0, 4) : [author]
        for (const person of people) {
          if (typeof person === 'string') add(person)
          else if (person && typeof person === 'object' && !Array.isArray(person)) {
            const obj = person as Record<string, unknown>
            add(obj.url)
            add(obj['@id'])
          }
        }
      }
    }
    for (const field of ['@graph', 'mainEntity', 'itemListElement', 'hasPart', 'acceptedAnswer', 'suggestedAnswer']) {
      if (node[field]) queue.push({ value: node[field], depth: depth + 1 })
    }
  }
}

/**
 * Inspect explicit author URLs in a page already fetched by RSS discovery.
 * No scripts execute; metadata never becomes a feed unless Radar verifies a route.
 * Whitelist same-site author URLs to prevent third-party/profile SSRF expansion.
 */
export function extractPageAuthorUrls(html: string, sourceUrl: string): string[] {
  if (!html || typeof DOMParser === 'undefined') return []
  let source: URL
  try { source = new URL(sourceUrl) } catch { return [] }
  let document: Document
  try { document = new DOMParser().parseFromString(html.slice(0, MAX_HTML), 'text/html') } catch { return [] }
  const authors: string[] = []
  const add = (raw: unknown) => {
    if (authors.length >= MAX_AUTHOR_URLS || typeof raw !== 'string' || raw.length > 400) return
    let target: URL
    try { target = new URL(raw, source) } catch { return }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return
    if (target.username || target.password || target.port || !target.hostname.includes('.') ||
      IP_ADDRESS_HOST.test(target.hostname) || NON_PUBLIC_DOMAIN.test(target.hostname)) return
    if (hostFamily(target.hostname) !== hostFamily(source.hostname)) return
    if (target.pathname === '/' || target.pathname === source.pathname) return
    if (target.search || target.hash) return
    target.hash = ''
    if (!authors.includes(target.href)) authors.push(target.href)
  }
  for (const link of [...document.querySelectorAll('link[rel~="author"][href], a[rel~="author"][href]')].slice(0, 12)) {
    add(link.getAttribute('href'))
  }
  for (const meta of [...document.querySelectorAll('meta[property="article:author"][content], meta[property="video:actor"][content]')].slice(0, 8)) {
    add(meta.getAttribute('content'))
  }
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, MAX_STRUCTURED_SCRIPTS)) {
    const value = script.textContent ?? ''
    if (!value || value.length > MAX_STRUCTURED_SCRIPT) continue
    try { collectStructuredAuthors(JSON.parse(value), add) } catch { /* untrusted structured data */ }
  }
  return authors
}
