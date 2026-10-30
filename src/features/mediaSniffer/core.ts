import { XMLParser } from 'fast-xml-parser'
import { parseMediaApiBody, observeMediaApiPayload } from './apiParser'
import { mediaDisplayText } from './metadata'
import { parseHTML } from 'linkedom'
import { playerDeclarationsInHtml } from './playerConfig'
import { regexMatches } from '../../lib/regexMatches'

import {
  DIRECT_MEDIA_EXT,
  MANIFEST_MIMES,
  admitObservation,
  isHttpUrl,
  isImageUrl,
  mediaFingerprint,
  mediaFormatFor,
  mimeFromUrl,
  normalizedMime,
} from './classifier'
import { buildMediaGraph, descriptorFromAsset, selectPlayableAsset } from './graph'
import type {
  MediaCandidate,
  MediaDescriptor,
  MediaFormat,
  MediaObservation,
  MediaObservationSource,
  MediaTrack,
} from './types'

export {
  mediaFormatFor,
  mediaFingerprint,
  isByteRangeResource,
  isHttpUrl,
  logicalMediaUrl,
  normalizedMime,
} from './classifier'

const AUDIO_EXT = /\.(?:m4a|aac|mp3|ogg|opus)(?:$|[?#])/i
const AUDIO_CODEC = /(?:^|[\s,"'])(?:mp4a|aac|opus|vorbis|ac-3|ec-3)(?:[.\s,"']|$)/i
const VIDEO_CODEC = /(?:^|[\s,"'])(?:avc1|av01|hvc1|hev1|vp0?9|vp8)(?:[.\s,"']|$)/i

function observationScore(observation: MediaObservation, format: MediaFormat): number {
  const mime = normalizedMime(observation.mimeType) || mimeFromUrl(observation.url || '')
  let score = 0
  if (format === 'hls' || format === 'dash') score += 140
  else if (format === 'progressive' || format === 'video-track' || format === 'audio-track') score += 50
  else if (format === 'segment') score += 10
  else if (format === 'blob') score -= 100

  if (mime.startsWith('video/')) score += 70
  else if (mime.startsWith('audio/')) score += 60
  else if (MANIFEST_MIMES.has(mime)) score += 80

  if (observation.source === 'dom') score += 100
  else if (observation.source === 'mse') score += 80
  else if (observation.source === 'fetch' || observation.source === 'xhr') score += 35
  else if (observation.source === 'network') score += 25
  else if (observation.source === 'performance') score += 15
  else if (observation.source === 'static') score += 20

  if (observation.hasAudio === true && observation.hasVideo === true) score += 100
  else if (observation.hasAudio === false && observation.hasVideo === true) score -= 20

  const range = Object.entries(observation.requestHeaders ?? {}).some(
    ([key]) => key.toLowerCase() === 'range',
  )
  if (range) score += 10
  if (observation.statusCode && observation.statusCode >= 400) score -= 80
  return score
}

function mediaKindFor(observation: MediaObservation): MediaCandidate['mediaKind'] {
  if (observation.mediaKind) return observation.mediaKind
  const mime = normalizedMime(observation.mimeType) || mimeFromUrl(observation.url || '')
  if (mime.startsWith('audio/') || (observation.url && AUDIO_EXT.test(observation.url))) return 'audio'
  if (mime.startsWith('video/') || (observation.url && DIRECT_MEDIA_EXT.test(observation.url))) return 'video'
  return 'unknown'
}

export function collectMediaCandidates(observations: MediaObservation[]): MediaCandidate[] {
  const grouped = new Map<string, MediaCandidate>()
  for (const raw of observations) {
    const observation = admitObservation(raw)
    if (!observation) continue
    const originalUrl = observation.url?.trim()
    if (!originalUrl || (!isHttpUrl(originalUrl) && !originalUrl.startsWith('blob:'))) continue
    const format = mediaFormatFor(
      originalUrl,
      observation.mimeType,
      observation.mediaKind ? { mediaKind: observation.mediaKind } : undefined,
    )
    if (format === 'unknown' || format === 'blob') continue
    const fingerprint = mediaFingerprint(originalUrl)
    const score = observationScore(observation, format)
    const existing = grouped.get(fingerprint)
    if (!existing) {
      grouped.set(fingerprint, {
        originalUrl,
        fingerprint,
        pageUrl: observation.pageUrl,
        format,
        mediaKind: mediaKindFor(observation),
        mimeType: observation.mimeType,
        hasAudio: observation.hasAudio,
        hasVideo: observation.hasVideo,
        width: observation.width,
        height: observation.height,
        bitrate: observation.bitrate,
        score,
        sources: [observation.source],
        requestHeaders: observation.requestHeaders,
      })
      continue
    }
    const previousScore = existing.score
    existing.score = Math.max(previousScore, score) + 10
    if (existing.mediaKind === 'unknown') existing.mediaKind = mediaKindFor(observation)
    if (observation.hasAudio !== undefined) existing.hasAudio = observation.hasAudio
    if (observation.hasVideo !== undefined) existing.hasVideo = observation.hasVideo
    if (observation.width) existing.width = observation.width
    if (observation.height) existing.height = observation.height
    if (observation.bitrate) existing.bitrate = observation.bitrate
    if (!existing.sources.includes(observation.source)) existing.sources.push(observation.source)
    if (score >= previousScore && observation.requestHeaders) {
      existing.requestHeaders = observation.requestHeaders
    }
  }

  const candidates = Array.from(grouped.values())
  const hasCompleteResource = candidates.some((item) => item.format !== 'segment' && item.score >= 50)
  return candidates
    .filter((item) => item.score >= 45 && (!hasCompleteResource || item.format !== 'segment'))
    .sort((left, right) => right.score - left.score)
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value, baseUrl).href
  } catch {
    return undefined
  }
}

function hlsAttributeMap(line: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const body = line.slice(line.indexOf(':') + 1)
  for (const match of regexMatches(body, /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi)) {
    attributes[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '')
  }
  return attributes
}

export function parseHlsManifest(text: string, manifestUrl: string): Pick<MediaDescriptor, 'videoTracks' | 'audioTracks' | 'subtitles' | 'drm' | 'drmKeySystems'> {
  const lines = text.slice(0, 524288).split(/\r?\n/).slice(0, 8192).map((line) => line.trim()).filter(Boolean)
  const videoTracks: MediaTrack[] = []
  const audioTracks: MediaTrack[] = []
  const subtitles: MediaTrack[] = []
  let drm = false
  const drmKeySystems = new Set<string>()

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (videoTracks.length + audioTracks.length + subtitles.length >= 512) break
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = hlsAttributeMap(line)
      const resolution = attrs.RESOLUTION?.match(/(\d+)x(\d+)/i)
      const url = absoluteUrl(lines[index + 1]?.startsWith('#') ? undefined : lines[index + 1], manifestUrl)
      videoTracks.push({
        kind: 'video',
        url,
        bandwidth: numberValue(attrs.BANDWIDTH),
        width: resolution ? Number(resolution[1]) : undefined,
        height: resolution ? Number(resolution[2]) : undefined,
        codecs: attrs.CODECS,
        groupId: attrs.AUDIO,
        quality: attrs.NAME || (resolution ? `${resolution[2]}p` : undefined),
        ...(attrs.NAME ? { label: mediaDisplayText(attrs.NAME) } : {}),
        ...(attrs.SUBTITLES ? { subtitleGroupId: attrs.SUBTITLES } : {}),
      })
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = hlsAttributeMap(line)
      const track: MediaTrack = {
        kind: attrs.TYPE === 'SUBTITLES' ? 'subtitle' : 'audio',
        url: absoluteUrl(attrs.URI, manifestUrl),
        language: attrs.LANGUAGE,
        groupId: attrs['GROUP-ID'],
        ...(attrs.NAME ? { label: mediaDisplayText(attrs.NAME) } : {}),
      }
      if (track.kind === 'subtitle') subtitles.push(track)
      else if (attrs.TYPE === 'AUDIO') audioTracks.push(track)
    } else if (line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) {
      const attrs = hlsAttributeMap(line)
      const keyFormat = attrs.KEYFORMAT?.toLowerCase()
      if (keyFormat && keyFormat !== 'identity') { drm = true; drmKeySystems.add(keyFormat) }
    }
  }

  return { videoTracks, audioTracks, subtitles, drm, drmKeySystems: [...drmKeySystems] }
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function xmlText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && '#text' in value) return String(value['#text'])
  return ''
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function parseDashManifest(text: string, manifestUrl: string): Pick<MediaDescriptor, 'videoTracks' | 'audioTracks' | 'subtitles' | 'drm' | 'drmKeySystems'> {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  if (text.length > 524288) return { videoTracks: [], audioTracks: [], subtitles: [], drm: false, drmKeySystems: [] }
  const root = parser.parse(text) as Record<string, unknown>
  const mpd = root.MPD as Record<string, unknown> | undefined
  const periods = arrayOf(mpd?.Period as Record<string, unknown> | Record<string, unknown>[] | undefined)
  const videoTracks: MediaTrack[] = []
  const audioTracks: MediaTrack[] = []
  const subtitles: MediaTrack[] = []
  let drm = false
  const drmKeySystems = new Set<string>()

  for (const period of periods.slice(0, 32)) {
    const sets = arrayOf(period.AdaptationSet as Record<string, unknown> | Record<string, unknown>[] | undefined)
    for (const set of sets.slice(0, 128)) {
      if (set.ContentProtection) {
        drm = true
        for (const protection of arrayOf(set.ContentProtection as Record<string, unknown> | Record<string, unknown>[])) {
          const scheme = protection['@_schemeIdUri']
          if (typeof scheme === 'string' && scheme.length <= 128) drmKeySystems.add(scheme)
        }
      }
      const mime = String(set['@_mimeType'] ?? '')
      const contentType = String(set['@_contentType'] ?? '')
      const defaultKind: MediaTrack['kind'] =
        contentType === 'audio' || mime.startsWith('audio/')
          ? 'audio'
          : contentType === 'text' || contentType === 'subtitle' || mime.startsWith('text/') || mime.includes('ttml') || /stpp|wvtt/i.test(String(set['@_codecs'] || ''))
            ? 'subtitle'
            : 'video'
      const representations = arrayOf(set.Representation as Record<string, unknown> | Record<string, unknown>[] | undefined)
      for (const representation of representations.slice(0, 256)) {
        if (videoTracks.length + audioTracks.length + subtitles.length >= 512) break
        if (representation.ContentProtection) {
          drm = true
          for (const protection of arrayOf(representation.ContentProtection as Record<string, unknown> | Record<string, unknown>[])) {
            const scheme = protection['@_schemeIdUri']
            if (typeof scheme === 'string' && scheme.length <= 128) drmKeySystems.add(scheme)
          }
        }
        const repMime = String(representation['@_mimeType'] ?? mime)
        const repCodecs = String(representation['@_codecs'] ?? set['@_codecs'] ?? '')
        const kind = repMime.startsWith('audio/') ? 'audio'
          : repMime.startsWith('text/') || /ttml|vtt/i.test(repMime) || /stpp|wvtt/i.test(repCodecs) ? 'subtitle' : defaultKind
        let base = manifestUrl
        for (const node of [mpd, period, set, representation]) {
          const value = xmlText(node?.BaseURL)
          if (value) base = absoluteUrl(value, base) || base
        }
        const track: MediaTrack = {
          kind,
          url: absoluteUrl(base, manifestUrl),
          bandwidth: numberValue(representation['@_bandwidth']),
          width: numberValue(representation['@_width'] ?? set['@_width']),
          height: numberValue(representation['@_height'] ?? set['@_height']),
          codecs: String(representation['@_codecs'] ?? set['@_codecs'] ?? '') || undefined,
          language: mediaDisplayText(String(representation['@_lang'] ?? set['@_lang'] ?? '')),
          id: mediaDisplayText(String(representation['@_id'] ?? '')),
          label: mediaDisplayText(xmlText(representation.Label) || String(representation['@_label'] ?? '') || xmlText(set.Label) || String(set['@_label'] ?? '')),
        }
        if (kind === 'video') videoTracks.push(track)
        else if (kind === 'audio') audioTracks.push(track)
        else subtitles.push(track)
      }
    }
  }
  return { videoTracks, audioTracks, subtitles, drm, drmKeySystems: [...drmKeySystems] }
}

export function buildMediaDescriptor(
  observations: MediaObservation[],
  manifests: ReadonlyMap<string, string> = new Map(),
): MediaDescriptor | null {
  const assets = buildMediaGraph(observations, manifests)
  const playable = selectPlayableAsset(assets)
  const chosen = playable ?? assets.find((item) => item.drm) ?? null
  if (!chosen) return null
  const primary = descriptorFromAsset(chosen)
  if (!primary) return null

  // Keep every playable candidate so the UI can recover from a bad primary
  // choice (for example a site that exposes both a preroll and the article
  // video). The selected content is always first; ad-marked candidates stay
  // visible but are never preferred by selectPlayableAsset.
  const resources = assets
    .map((asset) => descriptorFromAsset(asset))
    .filter((resource): resource is NonNullable<typeof resource> => Boolean(resource))
    .sort((left, right) => {
      if (left.id === primary.id) return -1
      if (right.id === primary.id) return 1
      return Number(Boolean(left.isAd)) - Number(Boolean(right.isAd)) || right.score - left.score
    })

  return {
    ...primary,
    resources,
  }
}

function resolvedUrl(value: string, pageUrl: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/&amp;/g, '&')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('javascript:')) return undefined
  try {
    const url = new URL(trimmed, pageUrl).href
    return isHttpUrl(url) ? url : undefined
  } catch {
    return undefined
  }
}

function addStaticObservation(
  observations: MediaObservation[],
  value: string,
  pageUrl: string,
  mimeType?: string,
  mediaKind?: MediaObservation['mediaKind'],
  hints?: Pick<MediaObservation, 'hasAudio' | 'hasVideo' | 'width' | 'height' | 'bitrate' | 'codecs'>,
): void {
  const url = resolvedUrl(value, pageUrl)
  if (!url) return
  const format = mediaFormatFor(url, mimeType, mediaKind ? { mediaKind } : undefined)
  if (format === 'unknown') return
  observations.push({ url, pageUrl, source: 'static', mimeType, mediaKind, ...hints })
}

function positiveNumber(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : undefined
}

function addStructuredPayloadObservation(
  value: Record<string, unknown>,
  pageUrl: string,
  observations: MediaObservation[],
): void {
  const mediaUrl = [
    value.url,
    value.contentUrl,
    value.playbackUrl,
    value.src,
    value.baseUrl,
    value.base_url,
    value.playurl,
    value.play_url,
    value.backupUrl,
    value.backup_url,
    value.manifestUrl,
  ]
    .find((item): item is string => typeof item === 'string' && item.trim().length > 0)
  if (!mediaUrl) return
  if (isImageUrl(mediaUrl)) return

  const mimeType = [value.mimeType, value.contentType, value.mime]
    .find((item): item is string => typeof item === 'string')
  const codecText = `${mimeType || ''} ${typeof value.codecs === 'string' ? value.codecs : ''}`
  const width = positiveNumber(value.width)
  const height = positiveNumber(value.height)
  const bitrate = positiveNumber(value.bitrate)
  const hasVideoSignal = Boolean(
    value.qualityLabel
    || normalizedMime(mimeType).startsWith('video/')
    || VIDEO_CODEC.test(codecText)
    || (typeof mediaUrl === 'string' && (
      /\.m3u8(?:$|[?#])/i.test(mediaUrl)
      || /\.mpd(?:$|[?#])/i.test(mediaUrl)
      || DIRECT_MEDIA_EXT.test(mediaUrl)
    )),
  )
  const hasAudioSignal = Boolean(
    value.audioQuality || value.audioSampleRate || value.audioChannels ||
    normalizedMime(mimeType).startsWith('audio/') || AUDIO_CODEC.test(codecText),
  )
  const mediaKind = normalizedMime(mimeType).startsWith('audio/')
    ? 'audio'
    : hasVideoSignal
      ? 'video'
      : undefined

  addStaticObservation(observations, mediaUrl, pageUrl, mimeType, mediaKind, {
    hasAudio: hasAudioSignal ? true : hasVideoSignal && value.qualityLabel ? false : undefined,
    hasVideo: hasVideoSignal || undefined,
    width,
    height,
    bitrate,
    codecs: typeof value.codecs === 'string' && value.codecs.trim() ? value.codecs : undefined,
  })
}

function walkPayload(value: unknown, pageUrl: string, observations: MediaObservation[], seen: Set<object>, depth: number, budget: { nodes: number }): void {
  if (++budget.nodes > 4096 || depth > 12 || observations.length >= 512 || seen.size >= 4096) return
  if (typeof value === 'string') {
    // A raw HTML/JSON string is a container, not a media URL. Treating the
    // whole string as an observation turns the document into an encoded URL
    // (for example `https://page/%3C!DOCTYPE...`) and can win candidate
    // selection before the real video source is seen. Keep direct media URL
    // payloads working, but only admit container strings through URL matches.
    const directValue = value.trim()
    if (isHttpUrl(directValue) && mediaFormatFor(directValue) !== 'unknown') {
      addStaticObservation(observations, directValue, pageUrl)
    }
    for (const match of regexMatches(value.slice(0, 1048576), /https?:\\?\/\\?\/[^\s"'<>]+/gi)) {
      addStaticObservation(observations, match[0].replace(/\\\//g, '/'), pageUrl)
    }
    return
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 512)) walkPayload(item, pageUrl, observations, seen, depth + 1, budget)
  } else {
    addStructuredPayloadObservation(value as Record<string, unknown>, pageUrl, observations)
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 512)) {
      if (/^(?:url_next|next|nextUrl|next_url|playlist|related|recommendations?|ads?|advertising|poster|thumbnail|image|logo)$/i.test(key)) continue
      walkPayload(item, pageUrl, observations, seen, depth + 1, budget)
    }
  }
}

export function observeMediaInPayload(payload: unknown, pageUrl: string): MediaObservation[] {
  const observations = typeof payload === 'string'
    ? parseMediaApiBody(payload, pageUrl, 'static')
    : observeMediaApiPayload(payload, pageUrl, 'static')
  walkPayload(payload, pageUrl, observations, new Set(), 0, { nodes: 0 })
  return observations
}

function jsonObjectsAfterAssignment(html: string, name: string): unknown[] {
  const result: unknown[] = []
  const assignment = new RegExp(`\\b${name}\\s*=\\s*`, 'gi')

  while (assignment.exec(html) && result.length < 16) {
    const start = assignment.lastIndex
    if (html[start] !== '{') continue

    let depth = 0
    let quote = ''
    let escaped = false
    for (let index = start; index < html.length; index += 1) {
      const character = html[index]
      if (quote) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = ''
        continue
      }
      if (character === '"' || character === "'") {
        quote = character
        continue
      }
      if (character === '{') depth += 1
      else if (character === '}') depth -= 1
      if (depth !== 0) continue

      try {
        result.push(JSON.parse(html.slice(start, index + 1)))
      } catch {
        // 非 JSON 的同名脚本变量交给运行时嗅探处理。
      }
      assignment.lastIndex = index + 1
      break
    }
  }
  return result
}

function decodeBase64Text(value: string): string | undefined {
  try {
    const compact = value
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const normalized = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')
    return atob(normalized)
  } catch {
    return undefined
  }
}

function decodePercentText(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function macCmsPlaybackUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  if (typeof record.url !== 'string' || !record.url.trim()) return undefined

  const encrypt = Number(record.encrypt)
  if (encrypt === 2) {
    const decoded = decodeBase64Text(record.url)
    return decoded ? decodePercentText(decoded) : undefined
  }
  return encrypt === 1 ? decodePercentText(record.url) : record.url
}

export function observeMediaInHtml(html: string, pageUrl: string): MediaObservation[] {
  html = html.slice(0, 1048576)
  const observations = playerDeclarationsInHtml(html, pageUrl)
    .flatMap(item => item.observation ? [item.observation] : [])
  const attribute = (tag: string, name: string): string | undefined =>
    tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
      ?.slice(1)
      .find((value): value is string => value !== undefined)

  for (const match of regexMatches(html, /<(video|audio|source)\b[^>]*>/gi)) {
    const tag = match[0]
    const mimeType = attribute(tag, 'type')
    const mediaKind = match[1].toLowerCase() === 'audio' ? 'audio' : undefined
    for (const name of ['src', 'data-src', 'data-video-src', 'data-url', 'data-original']) {
      const value = attribute(tag, name)
      if (value) addStaticObservation(observations, value, pageUrl, mimeType, mediaKind)
    }
  }
  for (const match of regexMatches(html, /<meta\b[^>]*>/gi)) {
    const tag = match[0]
    const property = (attribute(tag, 'property') || attribute(tag, 'name') || '').toLowerCase()
    if (!/^(?:og:video(?::url|:secure_url)?|twitter:player:stream)$/.test(property)) continue
    const value = attribute(tag, 'content')
    if (value) addStaticObservation(observations, value, pageUrl)
  }
  for (const match of regexMatches(html, /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      observations.push(...observeMediaInPayload(JSON.parse(match[1]), pageUrl))
    } catch {
      // 单个无效 JSON-LD 不影响其他信号。
    }
  }
  for (const payload of jsonObjectsAfterAssignment(html, 'player_aaaa')) {
    const value = macCmsPlaybackUrl(payload)
    if (value) {
      addStaticObservation(observations, value, pageUrl)
      if (payload && typeof payload === 'object') {
        const record = payload as Record<string, unknown>
        observations.push(...parseMediaApiBody(JSON.stringify({ ...record, url: value }), pageUrl, 'static'))
      }
    }
  }
  const { document } = parseHTML(html)
  const pageTitle = mediaDisplayText(document.querySelector('meta[property="og:title"]')?.getAttribute('content'))
    || mediaDisplayText(document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'))
    || mediaDisplayText(document.title || document.querySelector('title')?.textContent)
  return observations.slice(0, 512).map(observation => ({ ...observation, pageTitle }))
}

export function bestMediaUrlInPayload(payload: unknown, pageUrl: string): string | undefined {
  return collectMediaCandidates(observeMediaInPayload(payload, pageUrl))[0]?.originalUrl
}

export function bestPosterUrlInPayload(payload: unknown, pageUrl: string): string | undefined {
  const candidates: Array<{ url: string; score: number }> = []
  const seen = new Set<object>()
  const walk = (value: unknown, key: string, depth: number): void => {
    if (depth > 10) return
    if (typeof value === 'string') {
      const url = resolvedUrl(value, pageUrl)
      if (!url) return
      let score = 0
      if (/poster|cover|thumbnail/i.test(key)) score += 100
      else if (/image|img|pic/i.test(key)) score += 60
      if (/\.(?:avif|webp|jpe?g|png)(?:$|[?#])/i.test(url)) score += 20
      if (score) candidates.push({ url, score })
      return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key, depth + 1))
    } else {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, item]) =>
        walk(item, childKey, depth + 1),
      )
    }
  }
  walk(payload, '', 0)
  return candidates.sort((left, right) => right.score - left.score)[0]?.url
}

export function mergeObservationSources(
  ...groups: MediaObservation[][]
): MediaObservation[] {
  const merged = groups.flat()
  const expanded: MediaObservation[] = []
  for (const observation of merged) {
    expanded.push(observation)
    if (!observation.url || observation.source === 'static' || observation.source === 'dom') continue
    for (const nestedUrl of nestedRequestUrls(observation.url)) {
      expanded.push({
        ...observation,
        url: nestedUrl,
        mimeType: undefined,
        mediaKind: undefined,
      })
    }
  }
  return expanded
}

/** Some player endpoints wrap the real signed media URL in `url=`/`src=`.
 * Treat that inner URL as a sibling observation, matching the request-task
 * expansion used by youtoo without changing the original playback URL. */
export function nestedRequestUrls(value: string): string[] {
  try {
    const wrapper = new URL(value)
    const result: string[] = []
    const seen = new Set<string>()
    for (const [key, candidate] of wrapper.searchParams) {
      if (!/^(?:url|src|source|file|video|video_url|playurl|play_url|media|media_url)$/i.test(key)) continue
      let decoded = candidate.trim()
      for (let pass = 0; pass < 2 && !/^https?:\/\//i.test(decoded); pass += 1) {
        try {
          decoded = decodeURIComponent(decoded)
        } catch {
          break
        }
      }
      if (!/^https?:\/\//i.test(decoded) || decoded === value || seen.has(decoded)) continue
      seen.add(decoded)
      result.push(decoded)
    }
    return result
  } catch {
    return []
  }
}

export type { MediaObservationSource }
