import { mediaFormatFor } from './classifier'

export type CmsPlayerHint = {
  cms: 'maccms' | 'generic-player'
  url: string
  label?: string
}

const DIRECT_MEDIA = /\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|m4s|ts)(?:$|[?#])/i
const PLAYER_PATH = /(?:^|\/)(?:play|player|embed|vodplay|video\/play)(?:\/|$)/i
const AD_PATH = /(?:^|[._\-/])(?:adserver|advertising|doubleclick|vast|preroll|midroll|postroll)(?:[._\-/]|$)/i

function decodeEmbeddedText(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&quot;/gi, '"')
    .trim()
}

function safeTarget(value: string, pageUrl: string): string | undefined {
  const decoded = decodeEmbeddedText(value).replace(/^['"\s]+|['"\s]+$/g, '')
  if (!decoded || /^(?:javascript|data|blob):/i.test(decoded)) return undefined
  try {
    const url = new URL(decoded, pageUrl)
    if (!/^https?:$/.test(url.protocol) || !url.hostname || url.href === pageUrl) return undefined
    if (AD_PATH.test(`${url.hostname}${url.pathname}`)) return undefined
    // Direct media belongs to the media graph, not a second HTML page load.
    if (mediaFormatFor(url.href) !== 'unknown' || DIRECT_MEDIA.test(url.href)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function pushHint(out: CmsPlayerHint[], value: string, pageUrl: string, cms: CmsPlayerHint['cms'], label?: string): void {
  const url = safeTarget(value, pageUrl)
  if (!url || out.some((item) => item.url === url)) return
  out.push({ cms, url, label: label?.trim() || undefined })
}

function stringField(record: unknown, keys: string[]): string | undefined {
  if (!record || typeof record !== 'object') return undefined
  const value = record as Record<string, unknown>
  for (const key of keys) {
    const candidate = value[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return undefined
}

function walkPlayerConfig(
  value: unknown,
  pageUrl: string,
  out: CmsPlayerHint[],
  cms: CmsPlayerHint['cms'],
  allowGenericUrl = false,
  depth = 0,
  seen = new Set<object>(),
): void {
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) walkPlayerConfig(item, pageUrl, out, cms, allowGenericUrl, depth + 1, seen)
    return
  }
  const record = value as Record<string, unknown>
  const keys = allowGenericUrl
    ? ['embedUrl', 'contentUrl', 'playerUrl', 'player_url', 'playUrl', 'play_url', 'playurl', 'sourceUrl', 'source_url', 'iframeUrl', 'iframe_url', 'url', 'src', 'link']
    : ['embedUrl', 'contentUrl', 'playerUrl', 'player_url', 'playUrl', 'play_url', 'playurl', 'sourceUrl', 'source_url', 'iframeUrl', 'iframe_url']
  const url = stringField(record, keys)
  const label = stringField(record, ['from', 'line', 'lineName', 'sourceName', 'qualityLabel', 'quality', 'name', 'label', 'title'])
  if (url) pushHint(out, url, pageUrl, cms, label)
  for (const [key, child] of Object.entries(record)) {
    if (/^(?:url|src|link|embedurl|contenturl|playerurl|player_url|playurl|play_url|sourceurl|source_url|iframeurl|iframe_url)$/i.test(key)) continue
    walkPlayerConfig(child, pageUrl, out, cms, allowGenericUrl, depth + 1, seen)
  }
}

function parseBalancedJson(html: string, start: number): unknown | undefined {
  if (html[start] !== '{' && html[start] !== '[') return undefined
  const open = html[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < html.length; index += 1) {
    const ch = html[index]
    if (quote) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === open) depth += 1
    else if (ch === close) depth -= 1
    if (depth !== 0) continue
    try { return JSON.parse(html.slice(start, index + 1)) } catch { return undefined }
  }
  return undefined
}

function assignedString(html: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(html)
  return match?.[2] ? decodeEmbeddedText(match[2]) : undefined
}

function discoverMacCmsPlayUrls(html: string, pageUrl: string, out: CmsPlayerHint[]): void {
  const fromValue = assignedString(html, /(?:MacPlayer\.PlayFrom|vod_play_from)\s*[:=]\s*(["'])([\s\S]*?)\1/i)
  const playValue = assignedString(html, /(?:MacPlayer\.(?:PlayUrl|Url|url)|vod_play_url)\s*[:=]\s*(["'])([\s\S]*?)\1/i)
  if (!playValue) return
  const lineLabels = (fromValue || '').split('$$$').map((item) => item.trim())
  for (const [lineIndex, line] of playValue.split('$$$').entries()) {
    const lineLabel = lineLabels[lineIndex] || undefined
    for (const episode of line.split('#')) {
      const parts = episode.split('$')
      const value = parts.length > 1 ? parts[parts.length - 1] : episode
      const urls = value.match(/https?:\/\/[^\s"'<>\\]+/gi) || []
      for (const url of urls) pushHint(out, url, pageUrl, 'maccms', lineLabel)
      if (!urls.length && /^(?:https?:)?\/\//i.test(value.trim())) {
        pushHint(out, value.trim(), pageUrl, 'maccms', lineLabel)
      }
    }
  }
}

/** Discover player pages from common CMS configuration without executing site scripts. */
export function discoverCmsPlayerHints(html: string, pageUrl: string): CmsPlayerHint[] {
  const out: CmsPlayerHint[] = []
  const isMacCms = /MacPlayer\s*\.|vod_play_(?:from|url)|player_data|maccms/i.test(html)
  const cms: CmsPlayerHint['cms'] = isMacCms ? 'maccms' : 'generic-player'
  discoverMacCmsPlayUrls(html, pageUrl, out)

  // Parse JSON script blocks with a player-related id, plus schema.org embed URLs.
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = match[1]
    const body = match[2].trim()
    if (!body || body.length > 256 * 1024) continue
    const isPlayerBlock = /\bid=["'][^"']*(?:player|play|vod)[^"']*["']/i.test(attrs)
    const isJsonLd = /type=["']application\/ld\+json["']/i.test(attrs)
    const isJson = /type=["']application\/json["']/i.test(attrs)
    if (!isPlayerBlock && !isJsonLd && !isJson) continue
    try {
      walkPlayerConfig(JSON.parse(body), pageUrl, out, isPlayerBlock ? cms : 'generic-player', isPlayerBlock)
    } catch {
      // Malformed script data is ignored; the live runtime probe remains available.
    }
  }

  // Some templates assign player_data as an object rather than a JSON script.
  for (const match of html.matchAll(/\b(player_data|playerData|player_aaaa)\s*[:=]\s*/gi)) {
    const start = match.index! + match[0].length
    const parsed = parseBalancedJson(html, start)
    if (parsed !== undefined) walkPlayerConfig(parsed, pageUrl, out, 'maccms', true)
  }
  for (const match of html.matchAll(/\b(?:data-player-url|data-play-url|data-iframe-url)\s*=\s*(["'])(.*?)\1/gi)) {
    pushHint(out, match[2], pageUrl, cms, '播放器')
  }

  // Avoid treating ordinary canonical URLs (for example Organization.url) as players.
  return out.filter((item) => {
    try {
      const url = new URL(item.url)
      return PLAYER_PATH.test(url.pathname) || Boolean(item.label)
    } catch {
      return false
    }
  }).slice(0, 8)
}

export function detectPlayerFrameworks(html: string): string[] {
  const frameworks: Array<[string, RegExp]> = [
    ['DPlayer', /\bDPlayer\b/i],
    ['ArtPlayer', /\bArtplayer\b/i],
    ['Video.js', /\bvideojs\b|video\.js/i],
    ['JW Player', /\bjwplayer\b/i],
    ['CKPlayer', /\bckplayer\b/i],
    ['MacCMS', /MacPlayer\s*\.|vod_play_(?:from|url)|maccms/i],
  ]
  return frameworks.filter(([, pattern]) => pattern.test(html)).map(([name]) => name)
}
