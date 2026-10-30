import type { MediaResourceDescriptor, MediaTrack } from './types'
import { mediaDisplayText, resolvedMediaMetadata } from './metadata'

function hostname(value?: string): string {
  try { return new URL(value || '').hostname } catch { return '' }
}

export function mediaResourceFormatLabel(resource: MediaResourceDescriptor): string {
  if (resource.type === 'hls') return 'HLS'
  if (resource.type === 'dash') return 'DASH'
  const mime = resource.mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mime?.startsWith('video/')) return mime.slice(6).toUpperCase()
  return 'MP4'
}

function bitrateLabel(value?: number): string {
  if (!value || !Number.isFinite(value) || value <= 0) return ''
  return value >= 1_000_000
    ? `${Number((value / 1_000_000).toFixed(1))} Mbps`
    : `${Math.round(value / 1000)} kbps`
}

export function mediaTrackDetail(track: MediaTrack): string {
  const quality = track.height && track.height > 0
    ? `${track.height}p`
    : mediaDisplayText(track.quality)
  return [
    quality,
    bitrateLabel(track.bandwidth),
    mediaDisplayText(track.label),
    mediaDisplayText(track.codecs),
  ].filter(Boolean).join(' · ')
}

export function mediaResourceTitle(resource: MediaResourceDescriptor, ordinal = 1, fallbackTitle?: string): string {
  const resolved = resolvedMediaMetadata(resource, resource.url, ordinal)
  if (resolved.titleSource === 'generated') {
    const fallback = mediaDisplayText(fallbackTitle)
    if (fallback) return fallback
  }
  return resolved.title || `视频资源 ${String(ordinal).padStart(2, '0')}`
}

export function mediaResourceDetails(resource: MediaResourceDescriptor, fallbackTitle?: string): string[] {
  const mediaHost = hostname(resource.url) || hostname(resource.relatedUrls?.[0])
  const pageHost = hostname(resource.pageUrl)
  const playerHost = mediaDisplayText(resource.playerSource) || pageHost
  const result = [mediaResourceFormatLabel(resource)]
  if (pageHost) result.push(resource.fromIframe ? `播放器 iframe · ${playerHost || pageHost}` : `来源 · ${pageHost}`)
  if (mediaHost && mediaHost !== pageHost) result.push(`媒体源 · ${mediaHost}`)
  const fileName = mediaDisplayText(resource.fileName)
  if (fileName && fileName !== mediaResourceTitle(resource)) result.push(`文件 · ${fileName}`)
  if (resource.titleSource === 'page') result.push('页面标题')
  else if (resource.titleSource === 'filename') result.push('文件名')
  else if (resource.titleSource === 'generated' || !resource.titleSource) result.push(mediaDisplayText(fallbackTitle) ? '文章标题' : '待识别名称')
  if (resource.drm) result.push('DRM · 需原站授权')
  if (resource.isAd) result.push('疑似广告')
  return result
}

export function mediaResourceTracks(resource: MediaResourceDescriptor): string[] {
  const tracks: string[] = []
  const video = resource.videoTracks.slice(0, 4).map(mediaTrackDetail).filter(Boolean)
  if (video.length) {
    tracks.push(...video.map((detail, index) => video.length > 1 ? `画质 ${index + 1} · ${detail}` : detail))
    if (resource.videoTracks.length > video.length) tracks.push(`另有 ${resource.videoTracks.length - video.length} 档`)
  }
  const audio = resource.audioTracks.slice(0, 8)
    .map(track => mediaDisplayText(track.label) || mediaDisplayText(track.language) || mediaDisplayText(track.codecs))
    .filter((value): value is string => Boolean(value))
  if (resource.audioTracks.length) tracks.push(`音轨 · ${audio.join(' / ') || `${resource.audioTracks.length} 条`}`)
  else if (resource.hasAudio === true) tracks.push('含音频')
  else if (resource.hasAudio === false) tracks.push('无音频')
  const subtitles = resource.subtitles.slice(0, 8)
    .map(track => mediaDisplayText(track.label) || mediaDisplayText(track.language))
    .filter((value): value is string => Boolean(value))
  if (resource.subtitles.length) tracks.push(`字幕 · ${subtitles.join(' / ') || `${resource.subtitles.length} 条`}`)
  return tracks
}
