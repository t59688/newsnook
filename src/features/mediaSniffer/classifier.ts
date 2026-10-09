import type { MediaFormat, MediaObservation } from './types'

export const MANIFEST_MIMES = new Map<string, MediaFormat>([
  ['application/vnd.apple.mpegurl', 'hls'],
  ['application/x-mpegurl', 'hls'],
  ['audio/mpegurl', 'hls'],
  ['application/dash+xml', 'dash'],
])

export const DIRECT_MEDIA_EXT = /\.(?:mp4|m4v|webm|mov|flv|mkv|m4a|aac|mp3|ogg|opus)(?:$|[?#])/i
const HLS_EXT = /\.m3u8(?:$|[?#])/i
const DASH_EXT = /\.mpd(?:$|[?#])/i
const M4S_EXT = /\.m4s(?:$|[?#])/i
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?)(?:$|[?#])/i
const STATIC_ASSET_EXT = /\.(?:css|js|mjs|map|woff2?|ttf|otf|eot)(?:$|[?#])/i
const VIDEO_CODEC = /(?:^|[\s,"'])(?:avc1|av01|hvc1|hev1|vp0?9|vp8)(?:[.\s,"']|$)/i
const AUDIO_CODEC = /(?:^|[\s,"'])(?:mp4a|aac|opus|vorbis|ac-3|ec-3)(?:[.\s,"']|$)/i
const MEDIA_QUERY_HINT_KEY = /^is(?:video|music)$/i
const VOLATILE_QUERY_KEY = /^(?:token|auth|authorization|signature|sig|expires?|expiry|e|hdnts|policy|key-pair-id|x-amz-.+)$/i
// YouTube/googlevideo and similar chunk transports vary these fields on every
// request. They are safe to remove only from the internal grouping key.
const TRANSPORT_QUERY_KEY = /^(?:range|bytes|rn|rbuf|begin|end|alr|cpn|mt|ip|ipbits|mm|mn|ms|mv|mvi|pl|ei|cver|mh|expire|fvip|initcwndbps|lmt|source|requiressl|sp|sparams|ns|gir|keepalive|fexp|c|n|lsparams|lsig)$/i
// The playback URL must keep authorization/signature context. Only remove
// selectors that identify one byte/chunk request; removing expire/sig/n/etc.
// produces a URL that no longer authorizes playback on the CDN.
const PLAYBACK_RANGE_QUERY_KEY = /^(?:range|bytes|rn|rbuf|begin|end|alr)$/i
const MIME_QUERY_KEY = /^(?:mime|mime-type|mimetype|content-type|content_type|type)$/i
const FORMAT_QUERY_KEY = /^(?:format|fmt|container|ext)$/i

// Keep this deliberately narrow: an ad candidate should lose to the actual
// content, but must remain available in the resource picker when it is the
// only source the page exposes.  These markers cover VAST/preroll URLs and
// the common ad-CDN path conventions without treating every short `ad` token
// as an advertisement.
const AD_MEDIA_MARKER = /(?:^|[._\-/])(?:ad|ads|advert|advertising|adserver|adbreak|preroll|midroll|postroll|vast|doubleclick|commercial)(?:[._\-/]|$)/i
const AD_QUERY_MARKER = /(?:^|[?&_=])(?:ad|ads|advert|advertising|adserver|adbreak|preroll|midroll|postroll|vast|commercial)(?:[._\-/]|$|[&=])/i

export function isLikelyAdMediaUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return AD_MEDIA_MARKER.test(`${url.hostname}${url.pathname}`)
      || AD_QUERY_MARKER.test(url.search)
  } catch {
    return AD_MEDIA_MARKER.test(value) || AD_QUERY_MARKER.test(value)
  }
}

export function normalizedMime(value?: string): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() || ''
}

export function mimeFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const [key, rawValue] of parsed.searchParams) {
      const value = rawValue.trim().toLowerCase().replace(/^['"]|['"]$/g, '')
      if (MIME_QUERY_KEY.test(key) && /^(?:video|audio)\/[a-z0-9.+-]+$/i.test(value)) {
        return value
      }
      if (MIME_QUERY_KEY.test(key) && MANIFEST_MIMES.has(value)) return value
      if (FORMAT_QUERY_KEY.test(key)) {
        if (value === 'm3u8' || value === 'hls') return 'application/vnd.apple.mpegurl'
        if (value === 'mpd' || value === 'dash') return 'application/dash+xml'
        if (/^(?:mp4|m4v|webm|mov|flv|mkv)$/.test(value)) return `video/${value === 'm4v' ? 'mp4' : value}`
        if (/^(?:m4a|aac|mp3|ogg|opus)$/.test(value)) return `audio/${value === 'm4a' ? 'mp4' : value}`
      }
    }
  } catch {
    // URL extension and explicit MIME checks still apply.
  }
  return ''
}

export function isByteRangeResource(url: string): boolean {
  try {
    const parsed = new URL(url)
    const range = parsed.searchParams.get('range') || parsed.searchParams.get('bytes') || ''
    return /^(?:bytes=)?\d+-\d+$/i.test(range.trim())
  } catch {
    return false
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 图片 URL：任何启发式信号都不应把它当作可播放媒体。 */
export function isImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url)
}

/** 静态资源（图片、样式、脚本、字体）：不可播放。path 在 query 前判定。 */
export function isStaticAssetUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? url
  return IMAGE_EXT.test(path) || STATIC_ASSET_EXT.test(path)
}

/** 与 Android probe 脚本共用的 URL 形态启发式（单源文档化）。 */
export function looksMediaUrl(url: string): boolean {
  if (!url) return false
  if (url.startsWith('blob:')) return true
  return HLS_EXT.test(url)
    || DASH_EXT.test(url)
    || DIRECT_MEDIA_EXT.test(url)
    || M4S_EXT.test(url)
    || /\.(?:ts|cmfv|cmfa)(?:$|[?#])/i.test(url)
}

/** fetch/xhr body 是否像播放器 JSON，避免对任意 JSON 做深度 walk。 */
export function looksLikePlayerJson(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  return /"(?:url|playurl|play_url|manifestUrl|hlsmanifesturl|dashmanifesturl|manifest_url|video_url|media_url|backupUrl|backup_url|file)"\s*:/i.test(trimmed)
    || /"(?:video|audio|stream|streams|playinfo|player)"\s*:/i.test(trimmed)
}

function hasMediaQueryHint(url: string): boolean {
  try {
    const parsed = new URL(url)
    for (const [key, raw] of parsed.searchParams) {
      const value = raw.trim().toLowerCase()
      if (MEDIA_QUERY_HINT_KEY.test(key) && value === 'true') return true
      if (MIME_QUERY_KEY.test(key) && /^(?:video|audio)\//.test(value)) return true
    }
  } catch {
    // fall through
  }
  return false
}

function hasStrongMediaSignal(obs: MediaObservation, url: string): boolean {
  const mime = normalizedMime(obs.mimeType) || mimeFromUrl(url)
  if (mime.startsWith('video/') || mime.startsWith('audio/') || MANIFEST_MIMES.has(mime)) return true
  if (HLS_EXT.test(url) || DASH_EXT.test(url) || DIRECT_MEDIA_EXT.test(url)) return true
  if (obs.quality) return true
  if (obs.hasVideo === true || obs.hasAudio === true) return true
  const codecText = `${mime} ${obs.codecs || ''}`
  if (VIDEO_CODEC.test(codecText) || AUDIO_CODEC.test(codecText)) return true
  if (obs.source === 'dom') return true
  return false
}

/** 统一分类门控：任意 observation 入库前的权威语义。 */
export function admitObservation(obs: MediaObservation): MediaObservation | null {
  const url = obs.url?.trim()
  if (!url) {
    if (obs.drmKeySystem || obs.mseMimeType) return obs
    return null
  }
  if (isStaticAssetUrl(url)) return null

  const format = mediaFormatFor(
    url,
    obs.mimeType,
    obs.mediaKind ? { mediaKind: obs.mediaKind } : undefined,
  )
  if (format === 'blob' && obs.source !== 'dom' && obs.source !== 'mse') return null
  if (format === 'unknown') {
    if (obs.source !== 'dom' && !hasMediaQueryHint(url)) return null
  }

  if (obs.source === 'performance' && !looksMediaUrl(url)) return null
  if (obs.source === 'static' && !hasStrongMediaSignal(obs, url)) return null
  return obs
}

export function logicalMediaUrl(url: string): string {
  try {
    const parsed = new URL(url)
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (PLAYBACK_RANGE_QUERY_KEY.test(key)) parsed.searchParams.delete(key)
    }
    return parsed.href
  } catch {
    return url
  }
}

export function mediaFormatFor(
  url: string,
  mimeType?: string,
  hints?: { mediaKind?: 'video' | 'audio' },
): MediaFormat {
  const mime = normalizedMime(mimeType) || mimeFromUrl(url)
  const byMime = MANIFEST_MIMES.get(mime)
  if (byMime) return byMime
  if (url.startsWith('blob:')) return 'blob'
  if (HLS_EXT.test(url)) return 'hls'
  if (DASH_EXT.test(url)) return 'dash'
  if (isByteRangeResource(url)) return 'segment'
  if (mime.startsWith('audio/') || hints?.mediaKind === 'audio') {
    if (M4S_EXT.test(url) || mime === 'audio/mp4') return 'audio-track'
    if (mime.startsWith('audio/') || DIRECT_MEDIA_EXT.test(url)) return 'progressive'
  }
  if (mime.startsWith('video/') || hints?.mediaKind === 'video') {
    if (M4S_EXT.test(url)) return 'video-track'
    // Heuristic video hints (width/height in structured payloads) must not turn
    // image URLs — favicons, logos, posters — into playable progressive video.
    if (!mime.startsWith('video/') && IMAGE_EXT.test(url)) return 'unknown'
    return 'progressive'
  }
  if (M4S_EXT.test(url) || /\.(?:cmfv)(?:$|[?#])/i.test(url)) return 'video-track'
  if (/\.(?:cmfa)(?:$|[?#])/i.test(url)) return 'audio-track'
  if (DIRECT_MEDIA_EXT.test(url)) return 'progressive'
  if (/\.(?:ts)(?:$|[?#])/i.test(url)) return 'segment'
  return 'unknown'
}

/** 播放 URL 原样保留；仅内部指纹移除常见临时授权参数并排序。 */
export function mediaFingerprint(originalUrl: string): string {
  try {
    const url = new URL(originalUrl)
    const stable = Array.from(url.searchParams.entries())
      .filter(([key]) => !VOLATILE_QUERY_KEY.test(key))
      .filter(([key]) => !TRANSPORT_QUERY_KEY.test(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        `${leftKey}=${leftValue}`.localeCompare(`${rightKey}=${rightValue}`),
      )
    url.search = ''
    for (const [key, value] of stable) url.searchParams.append(key, value)
    url.hash = ''
    return url.href
  } catch {
    return originalUrl
  }
}
