import type { ZhihuApiClient } from '../api/client'
import { decodeZhihuContentDetail, type ZhihuContentDetail } from '../api/decode'
import { ZhihuApiError } from '../api/errors'
import { zhihuEntityUrl } from '../api/endpoints'
import type { ZhihuEntityRef } from '../types'

function operationFor(ref: ZhihuEntityRef): string | null {
  switch (ref.kind) {
    case 'answer': return 'answer.read'
    case 'article': return 'article.read'
    case 'question': return 'question.read'
    case 'pin': return 'pin.read'
    case 'people': return 'people.read'
    default: return null
  }
}

export interface ZhihuVideoPlayback {
  url: string
  urls: string[]
  bitrate?: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function decodeVideoPlayback(value: unknown): ZhihuVideoPlayback | null {
  const root = asRecord(value)
  const videoPlay = asRecord(root?.video_play)
  const playlist = asRecord(videoPlay?.playlist)
  const mp4 = Array.isArray(playlist?.mp4) ? playlist.mp4 : []
  const candidates: ZhihuVideoPlayback[] = []
  for (const entry of mp4) {
    const item = asRecord(entry)
    if (!item) continue
    const urls = Array.isArray(item.url)
      ? item.url.map(asString).filter((url): url is string => Boolean(url))
      : []
    if (urls.length === 0) continue
    const bitrate = typeof item.bitrate === 'number' && Number.isFinite(item.bitrate)
      ? item.bitrate
      : typeof item.bitrate === 'string' && Number.isFinite(Number(item.bitrate))
        ? Number(item.bitrate)
        : undefined
    candidates.push({
      url: urls[0]!,
      urls,
      ...(bitrate !== undefined ? { bitrate } : {}),
    })
  }
  candidates.sort((left, right) => (right.bitrate ?? 0) - (left.bitrate ?? 0))
  return candidates[0] ?? null
}

export class ZhihuContentService {
  private readonly api: Pick<ZhihuApiClient, 'getJson' | 'postJsonWithHeaders'>

  constructor(api: Pick<ZhihuApiClient, 'getJson' | 'postJsonWithHeaders'>) {
    this.api = api
  }

  async read(ref: ZhihuEntityRef, signal?: AbortSignal): Promise<ZhihuContentDetail> {
    const operation = operationFor(ref)
    const url = zhihuEntityUrl(ref)
    if (!operation || !url) throw new ZhihuApiError('unsupported', `暂不支持读取 ${ref.kind}`)
    const raw = await this.api.getJson(operation, url, signal)
    return decodeZhihuContentDetail(raw)
  }

  async readVideo(videoId: string, contentRef: ZhihuEntityRef, signal?: AbortSignal): Promise<ZhihuVideoPlayback | null> {
    const id = videoId.trim()
    if (!id) return null
    if (!['answer', 'article', 'pin', 'question'].includes(contentRef.kind)) return null
    const raw = await this.api.postJsonWithHeaders(
      'video.play-info',
      `https://www.zhihu.com/api/v4/video/play_info?r=${encodeURIComponent(id)}`,
      {
        'x-app-za': 'OS=webplayer',
        'x-referer': '',
      },
      {
        content_id: contentRef.id,
        content_type_str: contentRef.kind,
        video_id: id,
        scene_code: 'answer_detail_web',
        is_only_video: true,
      },
      signal,
    )
    return decodeVideoPlayback(raw)
  }
}
