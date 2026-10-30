import type { MediaMetadata, MediaTitleSource } from './types'

const TITLE_RANK: Record<MediaTitleSource, number> = { player: 5, structured: 4, filename: 3, page: 2, generated: 1 }

/** Reject addresses/credentials rather than trying to redact an arbitrary title. */
export function mediaDisplayText(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 512) return undefined
  const text = value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!text || /(?:https?:|blob:|data:|www\.|[?#=]|(?:token|signature|cookie|authorization|bearer)\s*[:=])/i.test(text)) return undefined
  return text.slice(0, 160)
}

export function readableMediaFileName(value: string): string | undefined {
  try {
    const raw = new URL(value).pathname.split('/').pop() || ''
    const decoded = decodeURIComponent(raw).replace(/\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv|m4s|m4a|mp3|aac|ogg|opus)$/i, '')
    const name = decoded
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
      .replace(/[a-z0-9_-]{24,}/gi, ' ')
      .replace(/(?:^|[ _.-])\d{6,}(?=$|[ _.-])/g, ' ')
      .replace(/[_.-]+/g, ' ').trim()
    if (/^(?:index|master|playlist|manifest|video|audio|stream|videoplayback|play|file|\d+)(?:\s*\d*p?)?$/i.test(name)) return undefined
    return mediaDisplayText(name)
  } catch { return undefined }
}

export function mergeMediaMetadata(target: MediaMetadata, incoming: MediaMetadata): MediaMetadata {
  const result = { ...target }
  const pageTitle = mediaDisplayText(incoming.pageTitle || (incoming.titleSource === 'page' ? incoming.title : undefined))
  if (pageTitle) result.pageTitle = pageTitle
  const title = mediaDisplayText(incoming.title)
  const source = incoming.titleSource
  if (title && source && source !== 'page' && (source !== 'generated' || !target.title) && (TITLE_RANK[source] || 0) >= (TITLE_RANK[target.titleSource || 'generated'] || 0)) {
    result.title = title
    result.titleSource = source
  }
  if (incoming.fileName) result.fileName = mediaDisplayText(incoming.fileName)
  if (incoming.playerSource) result.playerSource = mediaDisplayText(incoming.playerSource)
  if (incoming.fromIframe) result.fromIframe = true
  if (incoming.contentId) result.contentId = mediaDisplayText(incoming.contentId)
  if (incoming.isAd) result.isAd = true
  return result
}

export function resolvedMediaMetadata(metadata: MediaMetadata, url: string, ordinal: number): MediaMetadata {
  const result = mergeMediaMetadata({}, metadata)
  result.fileName = readableMediaFileName(url) || mediaDisplayText(result.fileName)
  if (!result.title || result.titleSource === 'generated') {
    const pageTitle = mediaDisplayText(result.pageTitle)
    result.title = result.fileName || pageTitle || `视频资源 ${String(ordinal).padStart(2, '0')}`
    result.titleSource = result.fileName ? 'filename' : pageTitle ? 'page' : 'generated'
  }
  return result
}
